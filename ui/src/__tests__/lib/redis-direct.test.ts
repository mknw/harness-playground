/**
 * Direct-Redis adapter tests — `makeDirectCallTool` (the ioredis-backed
 * `CallTool` used by the Data Stash when `STASH_DIRECT_REDIS=1`).
 *
 * A hand-rolled fake ioredis (no socket) drives each tool case; the assertions
 * check the return SHAPES the existing parsers rely on — most importantly that
 * a `vector_search_hash` reply flows through the real `createVectorStore`/
 * `parseHits` to identical `VectorHit`s, and that the FLOAT32 blob is
 * byte-exact (so a direct KNN matches gateway-written vectors).
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
  assertServer: vi.fn(),
}))
// redis-direct imports the gateway callTool for `stashCallTool`'s off-branch;
// stub it so no real gateway is touched on import.
vi.mock('../../lib/harness-patterns/mcp-client.server', () => ({
  callTool: vi.fn(async () => ({ success: false, data: null, error: 'no gateway' })),
}))

import { makeDirectCallTool } from '../../lib/redis-direct.server'
import { createVectorStore, encodeMeta } from '../../lib/vector-store.server'
import type { Redis } from 'ioredis'

// ----------------------------------------------------------------------------
// Fake ioredis — records ops; canned replies for module commands.
// ----------------------------------------------------------------------------
function makeFakeIoredis(opts: { jsonGet?: unknown; smembers?: string[] } = {}) {
  const ops: Array<[string, unknown[]]> = []
  let ftSearch: unknown = [0]
  let ftCreateErr: Error | null = null
  const fake = {
    ops,
    setFtSearch(r: unknown) {
      ftSearch = r
    },
    setFtCreateErr(e: Error | null) {
      ftCreateErr = e
    },
    call: async (cmd: string, ...args: unknown[]) => {
      ops.push([`call:${cmd}`, args])
      switch (cmd) {
        case 'FT.CREATE':
          if (ftCreateErr) throw ftCreateErr
          return 'OK'
        case 'FT.SEARCH':
          return ftSearch
        case 'JSON.SET':
          return 'OK'
        case 'JSON.GET':
          return opts.jsonGet ?? null
        default:
          return null
      }
    },
    hset: async (...args: unknown[]) => {
      ops.push(['hset', args])
      return 1
    },
    sadd: async (...args: unknown[]) => {
      ops.push(['sadd', args])
      return 1
    },
    smembers: async (...args: unknown[]) => {
      ops.push(['smembers', args])
      return opts.smembers ?? []
    },
    srem: async (...args: unknown[]) => {
      ops.push(['srem', args])
      return 1
    },
    del: async (...args: unknown[]) => {
      ops.push(['del', args])
      return 1
    },
    expire: async (...args: unknown[]) => {
      ops.push(['expire', args])
      return 1
    },
  }
  return fake
}

const asRedis = (f: ReturnType<typeof makeFakeIoredis>) => f as unknown as Redis

describe('redis-direct adapter', () => {
  it('set_vector_in_hash stores a byte-exact little-endian FLOAT32 blob', async () => {
    const fake = makeFakeIoredis()
    const ct = makeDirectCallTool(asRedis(fake))
    const res = await ct('set_vector_in_hash', { name: 'stashvec:s:t:d:0', vector: [1, 2, 3.5] })
    expect(res).toEqual({ success: true, data: true })

    const hset = fake.ops.find(([m]) => m === 'hset')!
    const [key, field, value] = hset[1] as [string, string, Buffer]
    expect(key).toBe('stashvec:s:t:d:0')
    expect(field).toBe('vector')
    const expected = Buffer.alloc(12)
    expected.writeFloatLE(1, 0)
    expected.writeFloatLE(2, 4)
    expected.writeFloatLE(3.5, 8)
    expect(Buffer.isBuffer(value)).toBe(true)
    expect((value as Buffer).equals(expected)).toBe(true)
  })

  it('vector_search_hash → parseHits yields identical VectorHits (via createVectorStore)', async () => {
    const fake = makeFakeIoredis()
    const store = createVectorStore({
      indexName: 'idx',
      prefix: 'stashvec:s:t:',
      dim: 3,
      callTool: makeDirectCallTool(asRedis(fake)),
    })
    // Flat RESP2 reply: [total, key, [field, val, ...]].
    fake.setFtSearch([
      1,
      'stashvec:s:t:d1:0',
      ['meta', encodeMeta({ content: 'hello', doc_id: 'd1', chunk_index: 0, _vid: 'd1:0' }), 'score', '0.25'],
    ])
    const hits = await store.search([1, 2, 3], 5)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('d1:0')
    expect(hits[0].payload.content).toBe('hello')
    expect(hits[0].score).toBe(0.25)
  })

  it('vector_search_hash returns [] for an empty result set', async () => {
    const fake = makeFakeIoredis()
    const store = createVectorStore({
      indexName: 'idx',
      prefix: 'p:',
      dim: 3,
      callTool: makeDirectCallTool(asRedis(fake)),
    })
    fake.setFtSearch([0])
    expect(await store.search([1, 2, 3], 5)).toEqual([])
  })

  it('create_vector_index_hash tolerates "already exists" but rethrows other errors', async () => {
    const fake = makeFakeIoredis()
    const store = createVectorStore({
      indexName: 'idx',
      prefix: 'p:',
      dim: 3,
      callTool: makeDirectCallTool(asRedis(fake)),
    })
    fake.setFtCreateErr(new Error('Index already exists'))
    await expect(store.ensureIndex()).resolves.toBeUndefined()

    fake.setFtCreateErr(new Error('WRONGTYPE bad key'))
    await expect(store.ensureIndex()).rejects.toThrow(/WRONGTYPE|Failed to create/)
  })

  it('json_get returns {data:null} for a missing key', async () => {
    const ct = makeDirectCallTool(asRedis(makeFakeIoredis({ jsonGet: null })))
    expect(await ct('json_get', { name: 'nope', path: '$' })).toEqual({ success: true, data: null })
  })

  it('json_set returns "OK" and applies expire when given', async () => {
    const fake = makeFakeIoredis()
    const ct = makeDirectCallTool(asRedis(fake))
    const res = await ct('json_set', { name: 'k', path: '$', value: '{"a":1}', expire_seconds: 60 })
    expect(res).toEqual({ success: true, data: 'OK' })
    expect(fake.ops.some(([m, a]) => m === 'expire' && (a as unknown[])[0] === 'k')).toBe(true)
  })

  it('delete uses args.key (not args.name)', async () => {
    const fake = makeFakeIoredis()
    const ct = makeDirectCallTool(asRedis(fake))
    await ct('delete', { key: 'stash:doc:s:d1' })
    const del = fake.ops.find(([m]) => m === 'del')!
    expect((del[1] as unknown[])[0]).toBe('stash:doc:s:d1')
  })

  it('smembers passes through the set members as an array', async () => {
    const ct = makeDirectCallTool(asRedis(makeFakeIoredis({ smembers: ['a', 'b'] })))
    expect(await ct('smembers', { name: 'stash:docs:s' })).toEqual({ success: true, data: ['a', 'b'] })
  })
})
