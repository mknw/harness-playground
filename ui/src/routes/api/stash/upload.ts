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
  setDocumentFlags,
} from '../../../lib/document-store.server'
import { ingestStashDocument } from '../../../lib/document-ingest.server'
import {
  getOrBuildPatterns,
  loadSession,
} from '../../../lib/harness-client/session.server'
import { harnessHasRedisRetriever } from '../../../lib/harness-patterns'
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
      const doc = await storeDocument(input)
      // Harness-aware Data Stash: if this session's agent composes a retriever
      // wired to the local redis vector store, make the upload searchable.
      // Fired-and-forgotten OFF the upload's critical path — resolving the agent
      // + embedding can take seconds, and the upload should feel instant. The
      // doc is marked `ingestStatus: 'pending'` as soon as the gate fires; the
      // client polls `GET ?sessionId` to surface "embedding…" → indexed/failed.
      void maybeAutoIngest(input.sessionId, userId, doc.id, doc.encoding)
      // Return metadata only — the client already has the content it uploaded,
      // and full inlining bloats the response.
      const { content: _content, ...meta } = doc
      void _content
      return json({ ok: true, document: meta }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      // Size-limit rejections from the store map to 413; everything else 500.
      return json({ error: msg }, /too large/i.test(msg) ? 413 : 500)
    }
  })
}

/**
 * Auto-ingest gate (runs in the background — see the POST handler). No-ops when
 * the upload should not be ingested: binary, no persisted session yet, or no
 * redis-retriever in the harness. Marks the doc `'pending'` the moment it
 * decides to ingest (so the panel can show "embedding…"), then chunks → embeds →
 * indexes, landing `'indexed'`/`'failed'`. Best-effort: never throws. Docs
 * uploaded before the session is persisted are covered by the retriever's lazy
 * `ensureSessionIngested` net on first search.
 */
async function maybeAutoIngest(
  sessionId: string,
  userId: string,
  docId: string,
  encoding: 'utf8' | 'base64' | undefined,
): Promise<void> {
  if (encoding === 'base64') return // binary: not text-ingestable
  try {
    const loaded = await loadSession(sessionId, userId)
    if (!loaded) return
    const patterns = await getOrBuildPatterns(sessionId, loaded.agentId)
    if (!harnessHasRedisRetriever(patterns)) return
    await setDocumentFlags(sessionId, docId, { ingestStatus: 'pending' })
    await ingestStashDocument(sessionId, docId)
  } catch {
    /* best-effort: status stays pending/unset; the retriever's net retries */
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
