/**
 * retriever Pattern Tests
 *
 * The retriever forms ONE query (compacted intent → last message → last-N
 * turns), fans it out to injected backends, merges hits closest-first capped at
 * k, sets `scope.data.matches`, and emits a `tool_result` for the synthesizer.
 * Backends are mocked — this is the framework-pure pattern, no app deps.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  ContextEvent,
  EventType,
  UnifiedContext,
  ToolResultEventData,
} from '../../../../lib/harness-patterns'
import type {
  RetrieverBackend,
  RetrievalHit,
} from '../../../../lib/harness-patterns/patterns/retriever.server'

vi.mock('../../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
  assertServer: vi.fn(),
}))

type Ev = { type: EventType; ts: number; patternId: string; data: unknown }

function ctxOf(events: Ev[]): UnifiedContext<Record<string, unknown>> {
  const lastUser = events.filter((e) => e.type === 'user_message').slice(-1)[0]
  return {
    sessionId: 'test',
    createdAt: 1,
    events: events as ContextEvent[],
    status: 'running',
    data: {},
    input: lastUser ? (lastUser.data as { content: string }).content : '',
  }
}

const PATTERN_ID = 'retriever'

async function load() {
  const { retriever } = await import(
    '../../../../lib/harness-patterns/patterns/retriever.server'
  )
  const { createScope } = await import('../../../../lib/harness-patterns/context.server')
  const { createEventView } = await import('../../../../lib/harness-patterns/patterns')
  return { retriever, createScope, createEventView }
}

/** A mock backend that records the query it received and returns canned hits. */
function mockBackend(
  name: string,
  hits: RetrievalHit[],
  opts: { type?: RetrieverBackend['type']; throws?: Error } = {},
): RetrieverBackend & { calls: Array<{ text: string; intent?: string; k: number }> } {
  const calls: Array<{ text: string; intent?: string; k: number }> = []
  return {
    name,
    type: opts.type ?? 'vector',
    calls,
    async search({ text, intent }, { k }) {
      calls.push({ text, intent, k })
      if (opts.throws) throw opts.throws
      return hits
    },
  }
}

function hit(backend: string, id: string, score: number): RetrievalHit {
  return { backend, id, content: `content-${id}`, source: `${id}.txt`, score }
}

const userMsg = (content: string, ts = 1): Ev => ({
  type: 'user_message',
  ts,
  patternId: 'harness',
  data: { content },
})

async function run(
  scopeData: Record<string, unknown>,
  events: Ev[],
  config: Parameters<Awaited<ReturnType<typeof load>>['retriever']>[0],
) {
  const { retriever, createScope, createEventView } = await load()
  const pattern = retriever(config)
  const scope = createScope(PATTERN_ID, scopeData)
  const view = createEventView(ctxOf(events), pattern.config.viewConfig, PATTERN_ID)
  const result = await pattern.fn(scope, view)
  return { pattern, result }
}

function toolResults(events: ContextEvent[]): ToolResultEventData[] {
  return events
    .filter((e) => e.type === 'tool_result')
    .map((e) => e.data as ToolResultEventData)
}

describe('retriever', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports a factory that returns a zero-turn ConfiguredPattern', async () => {
    const { retriever } = await load()
    const pattern = retriever({ backends: [], patternId: PATTERN_ID })
    expect(pattern.name).toBe('retriever')
    expect(pattern.config.patternId).toBe('retriever')
    expect(pattern.estimateTurns?.({} as never)).toBe(0)
  })

  it('stamps backendKinds on its resolved config (the seam pattern-capabilities reads)', async () => {
    const { retriever } = await load()
    const pattern = retriever({
      backends: [mockBackend('redis', []), mockBackend('supabase', [])],
      patternId: PATTERN_ID,
    })
    expect((pattern.config as { backendKinds?: string[] }).backendKinds).toEqual([
      'redis',
      'supabase',
    ])
  })

  it('queries with the compacted intent when present (preferred source)', async () => {
    const b = mockBackend('redis', [hit('redis', 'a', 0.1)])
    const { result } = await run(
      { intent: 'find the quarterly revenue figure' },
      [userMsg('what was it again?')],
      { backends: [b], k: 5 },
    )
    expect(b.calls).toHaveLength(1)
    expect(b.calls[0].text).toBe('find the quarterly revenue figure')
    expect(b.calls[0].intent).toBe('find the quarterly revenue figure')
    expect((result.data as { matches?: RetrievalHit[] }).matches).toHaveLength(1)
  })

  it('falls back to the last user message when there is no intent', async () => {
    const b = mockBackend('redis', [])
    const { result } = await run({}, [userMsg('first'), userMsg('latest question')], {
      backends: [b],
    })
    expect(b.calls[0].text).toBe('latest question')
    expect(b.calls[0].intent).toBeUndefined()
    expect((result.data as { matches?: RetrievalHit[] }).matches).toEqual([])
  })

  it('widens the query to the last N user turns when turnWindow is set', async () => {
    const b = mockBackend('redis', [])
    await run(
      {},
      [userMsg('alpha', 1), userMsg('beta', 2), userMsg('gamma', 3)],
      { backends: [b], turnWindow: 3 },
    )
    // Joined recent user turns (no intent present).
    expect(b.calls[0].text).toContain('alpha')
    expect(b.calls[0].text).toContain('gamma')
  })

  it('fans out to all backends and merges closest-first, capped at k', async () => {
    const redis = mockBackend('redis', [hit('redis', 'r1', 0.5), hit('redis', 'r2', 0.2)])
    const supa = mockBackend('supabase', [hit('supabase', 's1', 0.1), hit('supabase', 's2', 0.9)])
    const { result } = await run({ intent: 'q' }, [userMsg('q')], {
      backends: [redis, supa],
      k: 3,
    })
    const matches = (result.data as { matches: RetrievalHit[] }).matches
    expect(matches).toHaveLength(3) // capped at k=3 (4 hits available)
    expect(matches.map((m) => m.id)).toEqual(['s1', 'r2', 'r1']) // 0.1 < 0.2 < 0.5
    expect(redis.calls[0].k).toBe(3)
    expect(supa.calls[0].k).toBe(3)
  })

  it('sorts hits without a score last', async () => {
    const b = mockBackend('redis', [
      { backend: 'redis', id: 'noscore', content: 'x' },
      hit('redis', 'scored', 0.4),
    ])
    const { result } = await run({ intent: 'q' }, [userMsg('q')], { backends: [b], k: 5 })
    const matches = (result.data as { matches: RetrievalHit[] }).matches
    expect(matches.map((m) => m.id)).toEqual(['scored', 'noscore'])
  })

  it('emits a tool_result the synthesizer can read, with matches + backends + query', async () => {
    const b = mockBackend('redis', [hit('redis', 'a', 0.1)])
    const { result } = await run({ intent: 'the query' }, [userMsg('x')], {
      backends: [b],
    })
    const trs = toolResults(result.events)
    expect(trs).toHaveLength(1)
    expect(trs[0].tool).toBe('retriever')
    expect(trs[0].success).toBe(true)
    const payload = trs[0].result as { matches: RetrievalHit[]; backends: string[]; query: string }
    expect(payload.matches).toHaveLength(1)
    expect(payload.backends).toEqual(['redis'])
    expect(payload.query).toBe('the query')
    expect(trs[0].summary).toContain('1 match')
  })

  it('reports "no matches" (empty) without erroring when backends find nothing', async () => {
    const b = mockBackend('redis', [])
    const { result } = await run({ intent: 'q' }, [userMsg('q')], { backends: [b] })
    expect((result.data as { matches: RetrievalHit[] }).matches).toEqual([])
    expect(toolResults(result.events)[0].summary).toBe('no matches')
    expect(result.events.some((e) => e.type === 'error')).toBe(false)
  })

  it('isolates a failing backend: error event + the other backend still contributes', async () => {
    const ok = mockBackend('redis', [hit('redis', 'a', 0.3)])
    const bad = mockBackend('supabase', [], { throws: new Error('pgvector down') })
    const { result } = await run({ intent: 'q' }, [userMsg('q')], {
      backends: [ok, bad],
      k: 5,
    })
    const matches = (result.data as { matches: RetrievalHit[] }).matches
    expect(matches.map((m) => m.id)).toEqual(['a'])
    const errors = result.events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(JSON.stringify(errors[0].data)).toContain('pgvector down')
    expect(JSON.stringify(errors[0].data)).toContain('supabase')
    // Still emits a tool_result with the surviving hit.
    expect(toolResults(result.events)[0].success).toBe(true)
  })

  it('short-circuits to empty matches when there are no backends', async () => {
    const { result } = await run({ intent: 'q' }, [userMsg('q')], { backends: [] })
    expect((result.data as { matches: RetrievalHit[] }).matches).toEqual([])
    expect(toolResults(result.events)).toHaveLength(1)
  })

  it('short-circuits when there is no query text at all', async () => {
    const b = mockBackend('redis', [hit('redis', 'a', 0.1)])
    const { result } = await run({}, [], { backends: [b] })
    expect(b.calls).toHaveLength(0)
    expect((result.data as { matches: RetrievalHit[] }).matches).toEqual([])
  })
})
