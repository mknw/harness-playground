/**
 * Status-tracked ingest tests — `ingestStashDocument` + `ensureSessionIngested`
 * (the harness-aware Data Stash auto-ingest gate + retriever safety net).
 *
 * Drives the REAL document-store (storeDocument / setDocumentFlags / getDocument)
 * over a fake Redis so status transitions are exercised end-to-end: indexed on
 * success, failed on error/binary, and idempotent skip-when-terminal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
  assertServer: vi.fn(),
}))
vi.mock('../../lib/harness-patterns/mcp-client.server', () => ({
  callTool: vi.fn(async () => ({ success: false, data: null, error: 'no gateway' })),
}))

import { ingestStashDocument, ensureSessionIngested } from '../../lib/document-ingest.server'
import { storeDocument, setDocumentFlags, getDocument } from '../../lib/document-store.server'
import type { CallTool } from '../../lib/document-store.server'
import type { ToolCallResult } from '../../lib/harness-patterns/types'
import type { EmbeddingConfig, EmbeddingResult } from '../../lib/embeddings.server'

// ----------------------------------------------------------------------------
// Fake Redis: JSON docs + a per-session index set + vector hashes.
// ----------------------------------------------------------------------------
function makeFakeRedis() {
  const json = new Map<string, unknown>()
  const hashes = new Map<string, Record<string, unknown>>()
  const sets = new Map<string, Set<string>>()
  const callTool = (async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    switch (name) {
      case 'json_set':
        json.set(args.name as string, JSON.parse(args.value as string))
        return { success: true, data: 'OK' }
      case 'json_get': {
        const v = json.get(args.name as string)
        return { success: true, data: v == null ? null : [v] }
      }
      case 'sadd': {
        const s = sets.get(args.name as string) ?? new Set<string>()
        s.add(String(args.value))
        sets.set(args.name as string, s)
        return { success: true, data: 1 }
      }
      case 'smembers': {
        const s = sets.get(args.name as string)
        return { success: true, data: s ? [...s] : [] }
      }
      case 'srem':
        sets.get(args.name as string)?.delete(String(args.value))
        return { success: true, data: 1 }
      case 'create_vector_index_hash':
        return { success: true, data: 'Index created' }
      case 'set_vector_in_hash': {
        const h = hashes.get(args.name as string) ?? {}
        h.vector = args.vector
        hashes.set(args.name as string, h)
        return { success: true, data: true }
      }
      case 'hset': {
        const h = hashes.get(args.name as string) ?? {}
        h[args.key as string] = args.value
        hashes.set(args.name as string, h)
        return { success: true, data: 1 }
      }
      default:
        return { success: false, data: null, error: `unhandled ${name}` }
    }
  }) as CallTool
  return { json, hashes, sets, callTool }
}

function makeEmbedder(model: string, dim: number) {
  const embedFn = async (texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult> => ({
    provider: config?.provider ?? 'local',
    model: config?.model ?? model,
    dimensions: dim,
    vectors: texts.map((t, i) => Array.from({ length: dim }, (_, d) => t.length + i + d)),
  })
  return { embedFn }
}

async function seed(
  fake: ReturnType<typeof makeFakeRedis>,
  id: string,
  content: string,
  opts: { encoding?: 'base64' } = {},
) {
  return storeDocument(
    {
      sessionId: 's1',
      id,
      filename: `${id}.txt`,
      mimeType: 'text/plain',
      content,
      ...(opts.encoding ? { encoding: opts.encoding } : {}),
    },
    fake.callTool,
  )
}

describe('ingestStashDocument', () => {
  let fake: ReturnType<typeof makeFakeRedis>
  beforeEach(() => {
    fake = makeFakeRedis()
  })

  it('indexes a text doc and stamps status "indexed"', async () => {
    const { embedFn } = makeEmbedder('m', 3)
    await seed(fake, 'd1', 'Alpha sentence.\n\nBeta paragraph.')
    const res = await ingestStashDocument('s1', 'd1', { callTool: fake.callTool, embedFn })
    expect(res?.docId).toBe('d1')
    expect((await getDocument('s1', 'd1', fake.callTool))?.ingestStatus).toBe('indexed')
    expect(fake.hashes.size).toBeGreaterThan(0)
  })

  it('marks a base64 binary doc "failed" without attempting ingest', async () => {
    const { embedFn } = makeEmbedder('m', 3)
    await seed(fake, 'bin', Buffer.from('binary').toString('base64'), { encoding: 'base64' })
    const res = await ingestStashDocument('s1', 'bin', { callTool: fake.callTool, embedFn })
    expect(res).toBeNull()
    expect((await getDocument('s1', 'bin', fake.callTool))?.ingestStatus).toBe('failed')
    expect(fake.hashes.size).toBe(0)
  })

  it('returns null for a missing doc', async () => {
    const { embedFn } = makeEmbedder('m', 3)
    expect(await ingestStashDocument('s1', 'ghost', { callTool: fake.callTool, embedFn })).toBeNull()
  })

  it('marks status "failed" (and never throws) when ingest errors', async () => {
    const boom: ReturnType<typeof makeEmbedder>['embedFn'] = async () => {
      throw new Error('embedder offline')
    }
    await seed(fake, 'd2', 'some text')
    const res = await ingestStashDocument('s1', 'd2', { callTool: fake.callTool, embedFn: boom })
    expect(res).toBeNull()
    expect((await getDocument('s1', 'd2', fake.callTool))?.ingestStatus).toBe('failed')
  })
})

describe('ensureSessionIngested', () => {
  let fake: ReturnType<typeof makeFakeRedis>
  beforeEach(() => {
    fake = makeFakeRedis()
  })

  it('ingests every not-yet-indexed doc, and is idempotent on a second run', async () => {
    const { embedFn } = makeEmbedder('m', 3)
    const embedSpy = vi.fn(embedFn)
    await seed(fake, 'a', 'Aaa text.')
    await seed(fake, 'b', 'Bbb text.')

    await ensureSessionIngested('s1', { callTool: fake.callTool, embedFn: embedSpy })
    expect((await getDocument('s1', 'a', fake.callTool))?.ingestStatus).toBe('indexed')
    expect((await getDocument('s1', 'b', fake.callTool))?.ingestStatus).toBe('indexed')

    const callsAfterFirst = embedSpy.mock.calls.length
    await ensureSessionIngested('s1', { callTool: fake.callTool, embedFn: embedSpy })
    expect(embedSpy.mock.calls.length).toBe(callsAfterFirst) // nothing re-embedded
  })

  it('retries failed docs (transient) and skips only indexed + binary', async () => {
    const { embedFn } = makeEmbedder('m', 3)
    const embedSpy = vi.fn(embedFn)
    await seed(fake, 'already', 'Already indexed text.')
    await setDocumentFlags('s1', 'already', { ingestStatus: 'indexed' }, fake.callTool)
    await seed(fake, 'old-failed', 'Previously failed (embedder was down).')
    await setDocumentFlags('s1', 'old-failed', { ingestStatus: 'failed' }, fake.callTool)
    await seed(fake, 'bin', Buffer.from('b').toString('base64'), { encoding: 'base64' })
    await seed(fake, 'fresh', 'Fresh content here.')

    await ensureSessionIngested('s1', { callTool: fake.callTool, embedFn: embedSpy })

    expect((await getDocument('s1', 'fresh', fake.callTool))?.ingestStatus).toBe('indexed')
    // A prior failure is transient — retried and recovered now the embedder's up.
    expect((await getDocument('s1', 'old-failed', fake.callTool))?.ingestStatus).toBe('indexed')
    expect((await getDocument('s1', 'already', fake.callTool))?.ingestStatus).toBe('indexed') // skipped (already)
    expect((await getDocument('s1', 'bin', fake.callTool))?.ingestStatus).toBeUndefined() // skipped (binary)
    expect(embedSpy).toHaveBeenCalledTimes(2) // old-failed + fresh
  })
})
