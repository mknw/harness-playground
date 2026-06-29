/**
 * Redis vector RetrieverBackend — Server Only
 *
 * The local-uploads retrieval path: wraps `searchDocuments` (the Data Stash
 * RediSearch KNN over a session's ingested document chunks). Embeds the query
 * locally (the corpus's recorded model, e.g. Qwen3 1024-d) and returns
 * normalized {@link RetrievalHit}s.
 *
 * On its first search per session it runs `ensureSessionIngested` — the safety
 * net for docs uploaded before the agent was known (so the upload-time gate
 * couldn't fire). It's idempotent and memoized per instance, so a fully-indexed
 * corpus pays just one `listDocuments` once per session, not per query.
 *
 * `sessionId` scopes the corpus. `searchFn`/`ensureFn` are injectable and
 * `ensureIngested:false` disables the net — both for tests.
 */

import { assertServerOnImport } from '../harness-patterns/assert.server'
import type { RetrieverBackend, RetrievalHit } from '../harness-patterns'
import { searchDocuments, ensureSessionIngested } from '../document-ingest.server'

assertServerOnImport()

export function createRedisBackend(
  sessionId: string,
  opts: {
    searchFn?: typeof searchDocuments
    ensureFn?: typeof ensureSessionIngested
    ensureIngested?: boolean
  } = {},
): RetrieverBackend {
  const searchFn = opts.searchFn ?? searchDocuments
  const ensureFn = opts.ensureFn ?? ensureSessionIngested
  const ensureIngested = opts.ensureIngested !== false
  let ensured = false
  return {
    name: 'redis',
    type: 'vector',
    async search({ text }, { k }): Promise<RetrievalHit[]> {
      if (ensureIngested && !ensured) {
        // Mark before awaiting so racing searches don't double-ensure; a
        // transient failure won't be retried this session (the upload gate is
        // the primary path — this is only a net).
        ensured = true
        try {
          await ensureFn(sessionId)
        } catch {
          /* best-effort */
        }
      }
      const hits = await searchFn(sessionId, text, { k })
      return hits.map((h) => ({
        backend: 'redis',
        id: `${h.docId}:${h.chunkIndex}`,
        content: h.content,
        source: h.source,
        score: h.score,
        // First-class locator → enables typed RetrievalReference + the viewer.
        docId: h.docId,
        chunkIndex: h.chunkIndex,
        startOffset: h.startOffset,
        endOffset: h.endOffset,
      }))
    },
  }
}
