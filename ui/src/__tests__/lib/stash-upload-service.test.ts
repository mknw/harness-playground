/**
 * Upload Service Tests (Issue #6 upload path)
 *
 * Covers MIME guessing and request parsing (JSON + multipart) for
 * `POST /api/stash/upload`.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
  assertServer: vi.fn(),
}))

import {
  guessMimeType,
  parseUploadRequest,
} from '../../lib/stash/upload-service.server'

describe('upload-service (Issue #6)', () => {
  describe('guessMimeType', () => {
    it('maps known extensions', () => {
      expect(guessMimeType('a.md')).toBe('text/markdown')
      expect(guessMimeType('data.json')).toBe('application/json')
      expect(guessMimeType('table.csv')).toBe('text/csv')
    })
    it('defaults to text/plain for unknown or missing extensions', () => {
      expect(guessMimeType('README')).toBe('text/plain')
      expect(guessMimeType('archive.weird')).toBe('text/plain')
      expect(guessMimeType('trailing.')).toBe('text/plain')
    })
  })

  describe('parseUploadRequest — JSON', () => {
    it('parses a JSON body', async () => {
      const req = new Request('http://x/api/stash/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 's1',
          filename: 'doc.md',
          content: '# hi',
        }),
      })
      const input = await parseUploadRequest(req)
      expect(input).toMatchObject({
        sessionId: 's1',
        filename: 'doc.md',
        mimeType: 'text/markdown',
        content: '# hi',
      })
    })

    it('infers a default filename + mime when omitted', async () => {
      const req = new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', content: 'plain' }),
      })
      const input = await parseUploadRequest(req)
      expect(input.filename).toBe('upload.txt')
      expect(input.mimeType).toBe('text/plain')
    })

    it('throws when content is missing', async () => {
      const req = new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1' }),
      })
      await expect(parseUploadRequest(req)).rejects.toThrow(/content/i)
    })

    it('throws on non-JSON body when content-type is JSON', async () => {
      const req = new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      })
      await expect(parseUploadRequest(req)).rejects.toThrow(/JSON|multipart/i)
    })
  })

  describe('parseUploadRequest — multipart', () => {
    // Build a raw multipart body so part headers (filename / Content-Type) are
    // parsed faithfully — round-tripping a jsdom File through undici's FormData
    // serialization drops those, which is a test-realm artifact, not our code.
    const BOUNDARY = '----testboundary1234'
    function multipart(
      parts: Array<
        | { name: string; value: string }
        | { name: string; filename: string; type?: string; content: string }
      >,
    ): Request {
      const body =
        parts
          .map((p) => {
            if ('filename' in p) {
              return (
                `--${BOUNDARY}\r\n` +
                `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
                (p.type ? `Content-Type: ${p.type}\r\n` : '') +
                `\r\n${p.content}\r\n`
              )
            }
            return (
              `--${BOUNDARY}\r\n` +
              `Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`
            )
          })
          .join('') + `--${BOUNDARY}--\r\n`
      return new Request('http://x/api/stash/upload', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
        body,
      })
    }

    it('parses a file field and uses its name/type', async () => {
      const req = multipart([
        { name: 'sessionId', value: 's2' },
        { name: 'file', filename: 'sheet.csv', type: 'text/csv', content: 'col1,col2\n1,2' },
      ])
      const input = await parseUploadRequest(req)
      expect(input.sessionId).toBe('s2')
      expect(input.filename).toBe('sheet.csv')
      expect(input.mimeType).toBe('text/csv')
      expect(input.content).toBe('col1,col2\n1,2')
    })

    it('throws when no file field is present', async () => {
      const req = multipart([{ name: 'sessionId', value: 's2' }])
      await expect(parseUploadRequest(req)).rejects.toThrow(/file/i)
    })
  })
})
