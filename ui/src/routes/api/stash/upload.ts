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
import { parseUploadRequest } from '../../../lib/stash/upload-service.server'
import { json, withUser } from '../../../lib/stash/http.server'

export async function POST(event: APIEvent) {
  return withUser(async () => {
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

export async function GET(event: APIEvent) {
  return withUser(async () => {
    const sessionId = new URL(event.request.url).searchParams.get('sessionId')
    if (!sessionId) return json({ error: 'sessionId is required' }, 400)
    const documents = await listDocuments(sessionId)
    return json({ documents })
  })
}
