/**
 * Tests for `enrichNeo4jResult`.
 *
 * Focus: the rel-direction canonicalization. The enricher must always emit the
 * 3-tuple in the relationship's actual direction (rel.start → rel.end), not
 * the query binding order. Otherwise the same edge gets two different IDs
 * depending on which side the agent's query touched first, and the panel
 * shows duplicate edges (user-reported bug).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
}))

const sessionRun = vi.fn()
const sessionClose = vi.fn().mockResolvedValue(undefined)
const driverSession = vi.fn(() => ({ run: sessionRun, close: sessionClose }))

vi.mock('../../../lib/neo4j/client', () => ({
  getNeo4jDriver: () => ({ session: driverSession }),
}))

// Driver-shaped mocks. `identity` is a plain string here — the enricher's
// `identityEquals` falls back to `String(a) === String(b)` for non-Integer
// values, so this matches behaviour against real `neo4j.Integer`.
const node = (identity: string, name: string) => ({
  identity,
  labels: ['Concept'],
  properties: { name },
})

const rel = (startId: string, endId: string, type: string) => ({
  type,
  start: startId,
  end: endId,
  properties: {},
})

const record = (n: unknown, r: unknown, m: unknown) => ({
  get(field: string) {
    return field === 'n' ? n : field === 'r' ? r : m
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionClose.mockResolvedValue(undefined)
})

describe('enrichNeo4jResult — canonical edge direction', () => {
  it('emits rel tuple in start→end order when n is the rel start', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    sessionRun.mockResolvedValueOnce({
      records: [
        record(
          node('redis-id', 'Redis'),
          rel('redis-id', 'kvdb-id', 'CAN_BE'),
          node('kvdb-id', 'Key-Value Database'),
        ),
      ],
    })

    const out = await enrichNeo4jResult(
      'read_neo4j_cypher',
      { success: true, data: [{ c: { name: 'Redis' } }] },
      { args: {} },
    )

    expect(out).toBeDefined()
    const payload = (out as { data: { _neighborhood: { rows: Array<{ r: unknown }> } } }).data
    const tuple = payload._neighborhood.rows[0].r as [{ name: string }, string, { name: string }]
    expect(tuple[0].name).toBe('Redis')
    expect(tuple[1]).toBe('CAN_BE')
    expect(tuple[2].name).toBe('Key-Value Database')
  })

  it('FLIPS rel tuple to start→end when n is the rel end (the dup-edge fix)', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    // Same physical relationship, but this time the agent's query touched
    // KVDB first — so n=KVDB but the rel still goes Redis -> KVDB.
    sessionRun.mockResolvedValueOnce({
      records: [
        record(
          node('kvdb-id', 'Key-Value Database'),
          rel('redis-id', 'kvdb-id', 'CAN_BE'),
          node('redis-id', 'Redis'),
        ),
      ],
    })

    const out = await enrichNeo4jResult(
      'read_neo4j_cypher',
      { success: true, data: [{ c: { name: 'Key-Value Database' } }] },
      { args: {} },
    )

    const payload = (out as { data: { _neighborhood: { rows: Array<{ r: unknown }> } } }).data
    const tuple = payload._neighborhood.rows[0].r as [{ name: string }, string, { name: string }]
    // Must canonicalize to the rel's actual direction, NOT the query binding order.
    expect(tuple[0].name).toBe('Redis')
    expect(tuple[1]).toBe('CAN_BE')
    expect(tuple[2].name).toBe('Key-Value Database')
  })

  it('skips enrichment when no node names are present in the result', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    const out = await enrichNeo4jResult(
      'read_neo4j_cypher',
      { success: true, data: [{ count: 42 }] }, // no `name` anywhere
      { args: {} },
    )

    expect(out).toBeUndefined()
    expect(sessionRun).not.toHaveBeenCalled()
  })

  it('skips non-enrichable tools', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    const out = await enrichNeo4jResult(
      'get_neo4j_schema',
      { success: true, data: { Concept: { type: 'node', count: 1 } } },
      { args: {} },
    )

    expect(out).toBeUndefined()
    expect(sessionRun).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Issue #46 — write_neo4j_cypher returns only counters; the enricher must
// fall back to parsing call args so writes light up the graph panel
// ============================================================================

describe('enrichNeo4jResult — writes are sourced from call args', () => {
  it('extracts node names from CREATE patterns in args.query and fetches their neighborhood', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    sessionRun.mockResolvedValueOnce({
      records: [
        record(
          node('kafka-id', 'Apache Kafka'),
          rel('producers-id', 'kafka-id', 'HAS_CONCEPT'),
          node('producers-id', 'Producers'),
        ),
      ],
    })

    const out = await enrichNeo4jResult(
      'write_neo4j_cypher',
      // The MCP write returns only counters — no node objects to walk.
      { success: true, data: { _contains_updates: true, nodes_created: 2, properties_set: 2 } },
      {
        args: {
          query:
            'CREATE (:Concept {name: "Apache Kafka", description: "Streaming"}) ' +
            'CREATE (:Concept {name: "Producers"})-[:HAS_CONCEPT]->(:Concept {name: "Apache Kafka"})',
        },
      },
    )

    expect(out).toBeDefined()
    const payload = (out as { data: { rows: unknown; _neighborhood: { rows: unknown[] }; _touched: string[] } }).data
    // Names came from the cypher, not from the (counter-only) result.
    expect(payload._touched).toContain('Apache Kafka')
    expect(payload._touched).toContain('Producers')
    expect(payload._neighborhood.rows).toHaveLength(1)
    // Neighborhood query was driven by those names.
    const [, runArgs] = sessionRun.mock.calls[0]
    expect((runArgs as { names: string[] }).names).toEqual(expect.arrayContaining(['Apache Kafka', 'Producers']))
  })

  it('also matches MERGE patterns and single-quoted name literals', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    sessionRun.mockResolvedValueOnce({ records: [] })

    await enrichNeo4jResult(
      'write_neo4j_cypher',
      { success: true, data: { _contains_updates: true, nodes_created: 0 } },
      {
        args: {
          query:
            "MERGE (k:Concept {name: 'Kafka'}) " +
            "MERGE (b:Concept { name : \"Brokers\" }) " +
            "MERGE (k)-[:HAS_CONCEPT]->(b)",
        },
      },
    )

    const [, runArgs] = sessionRun.mock.calls[0]
    expect((runArgs as { names: string[] }).names).toEqual(expect.arrayContaining(['Kafka', 'Brokers']))
  })

  it('returns undefined when neither result nor args contain a usable name', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    const out = await enrichNeo4jResult(
      'write_neo4j_cypher',
      { success: true, data: { _contains_updates: false } },
      // Cypher with no inline name literals (all parametrized — not supported by
      // the regex). Accepted limitation; we just decline to enrich rather than
      // crash.
      { args: { query: 'CREATE (:Concept {name: $name})' } },
    )

    expect(out).toBeUndefined()
    expect(sessionRun).not.toHaveBeenCalled()
  })

  it('does NOT scan args for read_neo4j_cypher (results already carry the nodes)', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    // No `name` in result → today's behavior is to bail. Even though args has
    // a name literal, reads should not fall through to args parsing — that
    // path is reserved for writes whose results are counter-only.
    const out = await enrichNeo4jResult(
      'read_neo4j_cypher',
      { success: true, data: [{ count: 7 }] },
      { args: { query: 'MATCH (n:Concept {name: "Should Not Be Used"}) RETURN count(n)' } },
    )

    expect(out).toBeUndefined()
    expect(sessionRun).not.toHaveBeenCalled()
  })

  it('combines names from both result and args when a write also returns nodes (RETURN clause)', async () => {
    const { enrichNeo4jResult } = await import('../../../lib/harness-client/neo4j-enricher.server')

    sessionRun.mockResolvedValueOnce({ records: [] })

    // Hypothetical MCP build that actually returns the written node alongside
    // counters. Our union-of-sources behavior should still pick up both.
    await enrichNeo4jResult(
      'write_neo4j_cypher',
      { success: true, data: [{ name: 'Topics' }] },
      { args: { query: 'CREATE (:Concept {name: "Apache Kafka"})' } },
    )

    const [, runArgs] = sessionRun.mock.calls[0]
    const names = (runArgs as { names: string[] }).names
    expect(names).toEqual(expect.arrayContaining(['Topics', 'Apache Kafka']))
    // Dedup: each name appears once even if both sources mention it.
    expect(new Set(names).size).toBe(names.length)
  })
})
