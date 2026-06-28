/**
 * retriever Pattern
 *
 * A low-latency alternative to a tool-calling `simpleLoop`: instead of an LLM
 * loop deciding which DB tool to call (often >30s for a Neo4j loop), the
 * retriever forms ONE search query from context and fans it out to one or more
 * injected DB **backends**, returning normalized matches-with-references (or
 * none) for a downstream `synthesizer`.
 *
 * Typical composition (the query is pre-compacted by `compactIntent`):
 *
 *   harness(
 *     router(),
 *     routes({
 *       retriever: chain(compactIntent(), retriever({ backends: [redisBackend] })),
 *       neo4j: simpleLoop(neo4jController, tools.neo4j),
 *       web:   simpleLoop(webController, tools.web),
 *     }),
 *     synthesizer(),
 *   )
 *
 * Framework-pure: the concrete backends (redis vector, Supabase, …) are app-side
 * and injected via config, so this file has no app dependencies. Each backend
 * self-describes its `type` and owns its query transform — a `vector` backend
 * embeds internally (local) or sends text for server-side embedding (Supabase).
 *
 * Query source: the previous pattern's compacted `scope.data.intent` if present,
 * else the last user message; optionally widened with the last-N user turns.
 * The matches are written to `scope.data.matches` AND emitted as a `tool_result`
 * event so the synthesizer consumes them via `view.fromLastPattern()`.
 */

import { assertServerOnImport } from '../assert.server'
import type {
  PatternScope,
  EventView,
  ConfiguredPattern,
  PatternConfig,
  UserMessageEventData,
  ToolResultEventData,
  ErrorEventData,
} from '../types'
import { trackEvent, resolveConfig } from '../context.server'
import { getErrorHint } from '../error-hints'

assertServerOnImport()

// ============================================================================
// Public contract — the backend interface + result shape
// ============================================================================

/** A normalized retrieval result. `score` is a distance (lower = closer) when
 *  the backend reports one; cross-backend comparability is best-effort. */
export interface RetrievalHit {
  /** Which backend produced this hit (e.g. 'redis', 'supabase'). */
  backend: string
  /** Stable id/reference for the match within its backend. */
  id: string
  /** The matched text. */
  content: string
  /** Optional human-facing source label (filename, table, url, …). */
  source?: string
  /** Distance (lower = closer) when available. */
  score?: number
  metadata?: Record<string, unknown>
}

/**
 * A retrieval backend. The retriever fans the query out to each. Backends own
 * their query transform: `vector` backends embed (locally or server-side),
 * others (future: keyword/web/graph) use the text directly.
 */
export interface RetrieverBackend {
  name: string
  type: 'vector' | 'keyword' | 'graph' | 'web'
  search(
    query: { text: string; intent?: string },
    opts: { k: number },
  ): Promise<RetrievalHit[]>
}

export interface RetrieverConfig extends PatternConfig {
  /** DB backends to query (injected by the agent at construction). */
  backends: RetrieverBackend[]
  /** Max hits to return (per backend cap + final cap). Default 5. */
  k?: number
  /** When there's no compacted intent, build the query from the last N user
   *  turns instead of just the last message. Default: last message only. */
  turnWindow?: number
}

export interface RetrieverData {
  /** Set by an upstream `compactIntent`/`router`; preferred query source. */
  intent?: string
  /** Output: the normalized matches (also emitted as a tool_result). */
  matches?: RetrievalHit[]
}

/** Marker the resolved config carries so `pattern-capabilities` can answer
 *  "does this harness contain a retriever wired to backend X" without running
 *  it (mirrors the code-mode `dynamicToolPattern` probe). */
export interface RetrieverConfigMarker extends PatternConfig {
  backendKinds?: string[]
}

// ============================================================================
// Pattern
// ============================================================================

export function retriever<T extends RetrieverData>(
  config: RetrieverConfig,
): ConfiguredPattern<T> {
  const { backends = [], k = 5, turnWindow, ...patternConfig } = config
  const backendKinds = backends.map((b) => b.name)

  const resolved = resolveConfig('retriever', { patternId: 'retriever', ...patternConfig })
  // Stamp the backend kinds onto the resolved config for static introspection.
  ;(resolved as RetrieverConfigMarker).backendKinds = backendKinds

  const fn = async (scope: PatternScope<T>, view: EventView): Promise<PatternScope<T>> => {
    try {
      const intent = (scope.data as RetrieverData).intent
      const lastUser = view.fromAll().ofType('user_message').last(1).get()[0]
      const lastText = lastUser ? (lastUser.data as UserMessageEventData).content : ''

      let text = intent ?? ''
      if (!text) {
        if (turnWindow && turnWindow > 0) {
          const recent = view
            .fromLastNTurns(turnWindow)
            .ofType('user_message')
            .get()
            .map((e) => (e.data as UserMessageEventData).content)
            .filter(Boolean)
          text = (recent.length ? recent.join('\n') : lastText).trim()
        } else {
          text = lastText
        }
      }

      if (!text || backends.length === 0) {
        scope.data = { ...scope.data, matches: [] }
        emitMatches(scope, [], backendKinds, text, resolved.trackHistory)
        return scope
      }

      // Fan out to all backends concurrently; a failing backend yields [] and an
      // error event rather than sinking the whole retrieval.
      const perBackend = await Promise.all(
        backends.map(async (b) => {
          try {
            return await b.search({ text, intent }, { k })
          } catch (err) {
            trackEvent(
              scope,
              'error',
              {
                error: `retriever backend "${b.name}": ${err instanceof Error ? err.message : String(err)}`,
                severity: resolved.errorSeverity,
              } as ErrorEventData,
              true,
            )
            return [] as RetrievalHit[]
          }
        }),
      )

      // Merge, closest-first (hits without a score sort last), capped at k.
      const matches = perBackend
        .flat()
        .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity))
        .slice(0, k)

      scope.data = { ...scope.data, matches }
      emitMatches(scope, matches, backendKinds, text, resolved.trackHistory)
      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      trackEvent(
        scope,
        'error',
        { error: msg, severity: resolved.errorSeverity, hint: getErrorHint(msg) } as ErrorEventData,
        true,
      )
      return scope
    }
  }

  return { name: 'retriever', fn, config: resolved, estimateTurns: () => 0 }
}

/** Emit the retrieval as a `tool_result` so the synthesizer reads it via
 *  `view.fromLastPattern()` (same channel a simpleLoop tool call uses). */
function emitMatches<T>(
  scope: PatternScope<T>,
  matches: RetrievalHit[],
  backendKinds: string[],
  query: string,
  trackHistory: Parameters<typeof trackEvent>[3],
): void {
  trackEvent(
    scope,
    'tool_result',
    {
      tool: 'retriever',
      result: { matches, backends: backendKinds, query },
      success: true,
      summary: matches.length
        ? `${matches.length} match(es) from ${backendKinds.join(', ') || 'no backends'}`
        : 'no matches',
    } as ToolResultEventData,
    trackHistory,
  )
}
