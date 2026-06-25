/**
 * Data Stash single-document API (Issue #6)
 *
 *   GET    /api/stash/document/:id?sessionId            — full document (content + meta)
 *   GET    /api/stash/document/:id?sessionId&download   — raw file stream
 *                                               (base64-decoded for binary)
 *   DELETE /api/stash/document/:id?sessionId  — remove from Redis + index
 *   PATCH  /api/stash/document/:id            — toggle hide/archive flags
 *                                               body: { sessionId, hidden?, archived? }
 *
 * Documents are keyed by (sessionId, id); the session is supplied as a query
 * param (GET/DELETE) or in the JSON body (PATCH).
 */

import type { APIEvent } from '@solidjs/start/server'
import {
  getDocument,
  deleteDocument,
  setDocumentFlags,
} from '../../../../lib/document-store.server'
import { json, withUser } from '../../../../lib/stash/http.server'

function sessionParam(event: APIEvent): string | null {
  return new URL(event.request.url).searchParams.get('sessionId')
}

export async function GET(event: APIEvent) {
  return withUser(async () => {
    const sessionId = sessionParam(event)
    if (!sessionId) return json({ error: 'sessionId is required' }, 400)
    const doc = await getDocument(sessionId, event.params.id)
    if (!doc) return json({ error: 'Document not found' }, 404)

    // ?download → stream the raw file with its original content-type, so the
    // DataStash UI can offer a real download. Binary docs are base64-decoded
    // back to bytes; text docs stream verbatim.
    if (new URL(event.request.url).searchParams.has('download')) {
      const isBinary = doc.encoding === 'base64'
      const body = isBinary ? Buffer.from(doc.content, 'base64') : doc.content
      const filename = doc.filename.replace(/["\r\n]/g, '')
      return new Response(body as BodyInit, {
        headers: {
          'Content-Type': doc.mimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(
            isBinary
              ? (body as Buffer).length
              : Buffer.byteLength(doc.content, 'utf8'),
          ),
        },
      })
    }

    return json({ document: doc })
  })
}

export async function DELETE(event: APIEvent) {
  return withUser(async () => {
    const sessionId = sessionParam(event)
    if (!sessionId) return json({ error: 'sessionId is required' }, 400)
    await deleteDocument(sessionId, event.params.id)
    return json({ ok: true })
  })
}

export async function PATCH(event: APIEvent) {
  return withUser(async () => {
    let body: { sessionId?: string; hidden?: boolean; archived?: boolean }
    try {
      body = await event.request.json()
    } catch {
      return json({ error: 'Request body must be JSON' }, 400)
    }
    if (!body.sessionId) return json({ error: 'sessionId is required' }, 400)

    const updated = await setDocumentFlags(body.sessionId, event.params.id, {
      hidden: body.hidden,
      archived: body.archived,
    })
    if (!updated) return json({ error: 'Document not found' }, 404)
    const { content: _content, ...meta } = updated
    void _content
    return json({ ok: true, document: meta })
  })
}
