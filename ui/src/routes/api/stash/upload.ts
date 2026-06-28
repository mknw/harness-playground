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
  type IngestStatus,
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
      // Best-effort and decoupled from upload success — a failure here never
      // changes the 201.
      const ingestStatus = await maybeAutoIngest(
        input.sessionId,
        userId,
        doc.id,
        doc.encoding,
      )
      // Return metadata only — the client already has the content it uploaded,
      // and full inlining bloats the response.
      const { content: _content, ...meta } = doc
      void _content
      if (ingestStatus) meta.ingestStatus = ingestStatus
      return json({ ok: true, document: meta }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      // Size-limit rejections from the store map to 413; everything else 500.
      return json({ error: msg }, /too large/i.test(msg) ? 413 : 500)
    }
  })
}

/**
 * Auto-ingest gate. Returns the ingest status to stamp on the response, or
 * `undefined` when the upload should not be ingested (binary, no persisted
 * session, no redis-retriever in the harness, or a resolution failure). Marks
 * the doc `'pending'` synchronously, then ingests in the background so the
 * upload returns immediately — embedding a large doc takes seconds. Docs
 * uploaded before the session is persisted are covered by the retriever's
 * lazy `ensureSessionIngested` net on first search.
 */
async function maybeAutoIngest(
  sessionId: string,
  userId: string,
  docId: string,
  encoding: 'utf8' | 'base64' | undefined,
): Promise<IngestStatus | undefined> {
  if (encoding === 'base64') return undefined // binary: not text-ingestable
  try {
    const loaded = await loadSession(sessionId, userId)
    if (!loaded) return undefined
    const patterns = await getOrBuildPatterns(sessionId, loaded.agentId)
    if (!harnessHasRedisRetriever(patterns)) return undefined
    await setDocumentFlags(sessionId, docId, { ingestStatus: 'pending' })
    void ingestStashDocument(sessionId, docId).catch(() => {})
    return 'pending'
  } catch {
    return undefined
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
