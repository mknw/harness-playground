/**
 * Data Stash Upload Service — Server Only
 *
 * Request-parsing for the `POST /api/stash/upload` route, kept separate from
 * the route handler so it is unit-testable without spinning up the router.
 *
 * Two intake shapes are supported:
 *   - `multipart/form-data` with a `file` field (+ optional `sessionId`) — the
 *     browser file-picker / drag-drop path.
 *   - `application/json` `{ sessionId, filename, mimeType, content, ttlSeconds? }`
 *     — the programmatic path (and what #89 / the sandbox lane can call).
 *
 * Both yield a {@link StoreDocumentInput} for `document-store.server.ts`. Binary
 * formats (PDF, xlsx, …) are decoded as UTF-8 text here — true text extraction
 * is left to the caller, matching the document-store contract ("`content` is
 * opaque UTF-8 text").
 */

import { assertServerOnImport } from '../harness-patterns/assert.server'
import type { StoreDocumentInput } from '../document-store.server'

assertServerOnImport()

/** Extension → MIME fallback for uploads that arrive without a usable type. */
const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  log: 'text/plain',
}

/** Best-effort MIME from a filename extension; defaults to `text/plain`. */
export function guessMimeType(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return 'text/plain'
  const ext = filename.slice(dot + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'text/plain'
}

/**
 * Parse an upload request body into a {@link StoreDocumentInput}.
 * @throws Error (message safe to surface as a 400) on malformed input.
 */
export async function parseUploadRequest(
  request: Request,
): Promise<StoreDocumentInput> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    // Duck-type rather than `instanceof File`: the runtime and test (jsdom)
    // realms can hand back File objects from different constructors, so an
    // instanceof check is unreliable. A Blob/File exposes async `text()`.
    if (file == null || typeof file === 'string' || typeof (file as Blob).text !== 'function') {
      throw new Error('multipart upload requires a "file" field')
    }
    const blob = file as File
    const sessionId = String(form.get('sessionId') ?? '').trim()
    const filename = blob.name || 'upload'
    const ttlRaw = form.get('ttlSeconds')
    const ttlSeconds =
      ttlRaw != null && ttlRaw !== '' ? Number(ttlRaw) : undefined
    return {
      sessionId,
      filename,
      mimeType: blob.type || guessMimeType(filename),
      content: await blob.text(),
      ...(Number.isFinite(ttlSeconds) ? { ttlSeconds } : {}),
    }
  }

  // Default: JSON body.
  let body: Partial<StoreDocumentInput>
  try {
    body = (await request.json()) as Partial<StoreDocumentInput>
  } catch {
    throw new Error('Request body must be JSON or multipart/form-data')
  }
  if (typeof body.content !== 'string') {
    throw new Error('content (string) is required')
  }
  const filename = body.filename?.trim() || 'upload.txt'
  return {
    sessionId: String(body.sessionId ?? '').trim(),
    filename,
    mimeType: body.mimeType?.trim() || guessMimeType(filename),
    content: body.content,
    ...(typeof body.ttlSeconds === 'number' ? { ttlSeconds: body.ttlSeconds } : {}),
  }
}
