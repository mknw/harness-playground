/**
 * Data Stash Upload API (Issue #6)
 *
 *   POST /api/stash/upload          — store an uploaded document in Redis
 *   GET  /api/stash/upload?sessionId — list a session's uploaded documents (meta)
 *
 * Storage is delegated to `document-store.server.ts`; this route only handles
 * intake (multipart or JSON), auth, and shaping the HTTP response. Companion
 * routes for a single document live in `stash/document/[id].ts`.
 */

import type { APIEvent } from '@solidjs/start/server'
import {
  storeDocument,
  listDocuments,
} from '../../../lib/document-store.server'
import { ingestStashDocument } from '../../../lib/document-ingest.server'
import { loadSession } from '../../../lib/harness-client/session.server'
import { agentUsesRedisRetriever } from '../../../lib/harness-client/registry.server'
import { parseUploadRequest } from '../../../lib/stash/upload-service.server'
import { json, withUser } from '../../../lib/stash/http.server'

export async function POST(event: APIEvent) {
  return withUser(async (userId) => {
    let input
    try {
      input = await parseUploadRequest(event.request)
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : 'Invalid upload' },
        400,
      )
    }
    if (!input.sessionId) return json({ error: 'sessionId is required' }, 400)

    try {
      const { agentId, ...storeInput } = input
      const doc = await storeDocument(storeInput)
      const { content: _content, ...meta } = doc
      void _content

      // Harness-aware Data Stash: if this session's agent composes a retriever
      // wired to the local redis vector store, auto-ingest the upload. The GATE
      // DECISION is fast (memoized per agentId) so we can report
      // `ingestStatus: 'pending'` in THIS response — the panel shows "embedding…"
      // instantly, without waiting on a status poll. The actual embed (slow on
      // the serial gateway) runs in the background; the client reconciles to
      // indexed/failed via `GET ?sessionId`. The agentId hint lets this work even
      // before the session is persisted (drop-files-then-chat).
      if (await willAutoIngest(input.sessionId, userId, doc.encoding, agentId)) {
        meta.ingestStatus = 'pending'
        void ingestStashDocument(input.sessionId, doc.id).catch(() => {})
      }

      return json({ ok: true, document: meta }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      // Size-limit rejections from the store map to 413; everything else 500.
      return json({ error: msg }, /too large/i.test(msg) ? 413 : 500)
    }
  })
}

/**
 * Fast gate decision: should this upload be auto-ingested? True only for a
 * text doc whose (client-hinted or persisted) agent composes a redis retriever.
 * `agentUsesRedisRetriever` is memoized per agentId, so this is cheap after the
 * first call. Best-effort: never throws (returns false); the retriever's lazy
 * `ensureSessionIngested` net still covers anything missed on first search.
 */
async function willAutoIngest(
  sessionId: string,
  userId: string,
  encoding: 'utf8' | 'base64' | undefined,
  agentId: string | undefined,
): Promise<boolean> {
  if (encoding === 'base64') return false // binary: not text-ingestable
  try {
    const resolvedAgentId = agentId ?? (await loadSession(sessionId, userId))?.agentId
    if (!resolvedAgentId) return false // session not persisted + no agent hint
    return await agentUsesRedisRetriever(resolvedAgentId, sessionId)
  } catch {
    return false
  }
}

export async function GET(event: APIEvent) {
  return withUser(async () => {
    const sessionId = new URL(event.request.url).searchParams.get('sessionId')
    if (!sessionId) return json({ error: 'sessionId is required' }, 400)
    const documents = await listDocuments(sessionId)
    return json({ documents })
  })
}
