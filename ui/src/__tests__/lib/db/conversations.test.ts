/**
 * Round-trip test for conversations CRUD.
 *
 * Hits the live Postgres container from docker-compose. Skips gracefully
 * when Postgres isn't reachable so this works on machines without docker.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Bypass server-only guard in jsdom test env
import { vi } from 'vitest'
vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
  assertServer: vi.fn(),
  ServerOnlyError: class ServerOnlyError extends Error {},
}))

import {
  loadConversation,
  saveConversation,
  listConversations,
  deleteConversation,
  deriveTitle,
} from '../../../lib/db/conversations.server'
import { closePool, query } from '../../../lib/db/client.server'

const TEST_USER = `test-user-${Math.random().toString(36).slice(2, 10)}`

let dbAvailable = true

beforeAll(async () => {
  try {
    await query('SELECT 1')
  } catch (err) {
    dbAvailable = false
    console.warn('[conversations.test] Postgres unreachable, skipping:', err)
  }
})

afterAll(async () => {
  if (!dbAvailable) return
  // Clean up everything we wrote under the test user
  await query('DELETE FROM conversations WHERE user_id = $1', [TEST_USER])
  await closePool()
})

describe('deriveTitle', () => {
  it('returns null for empty input', () => {
    expect(deriveTitle('')).toBeNull()
    expect(deriveTitle('   \n  ')).toBeNull()
  })

  it('collapses whitespace and trims', () => {
    expect(deriveTitle('  hello   world  ')).toBe('hello world')
  })

  it('truncates with ellipsis past 60 chars', () => {
    const long = 'x'.repeat(80)
    const out = deriveTitle(long)!
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(61) // 60 chars + ellipsis
  })
})

describe('conversations CRUD', () => {
  it('round-trips a serialized context unchanged', async () => {
    if (!dbAvailable) return
    const id = `conv-${Math.random().toString(36).slice(2, 10)}`
    const ctx = {
      sessionId: id,
      createdAt: 1730000000000,
      events: [
        { id: 'ev-1', type: 'user_message', ts: 1, patternId: 'harness', data: { content: 'hi' } },
        { id: 'ev-2', type: 'tool_result', ts: 2, patternId: 'neo4j-query', data: { tool: 'read_neo4j_cypher', result: { rows: [] }, success: true } },
      ],
      status: 'done',
      data: { intent: 'neo4j' },
      input: 'hi',
    }
    const serialized = JSON.stringify(ctx)

    await saveConversation({
      id,
      userId: TEST_USER,
      agentId: 'default',
      title: 'hi',
      serializedContext: serialized,
    })

    const loaded = await loadConversation(id, TEST_USER)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(id)
    expect(loaded!.userId).toBe(TEST_USER)
    expect(loaded!.agentId).toBe('default')
    expect(loaded!.title).toBe('hi')
    expect(JSON.parse(loaded!.serializedContext)).toEqual(ctx)
  })

  it('upserts (second save overwrites context, preserves title)', async () => {
    if (!dbAvailable) return
    const id = `conv-${Math.random().toString(36).slice(2, 10)}`

    await saveConversation({
      id,
      userId: TEST_USER,
      agentId: 'default',
      title: 'first title',
      serializedContext: JSON.stringify({ events: [] }),
    })

    // Second write: try to change the title — should be ignored (sticky)
    await saveConversation({
      id,
      userId: TEST_USER,
      agentId: 'default',
      title: 'attempted rename',
      serializedContext: JSON.stringify({ events: [{ id: 'a' }] }),
    })

    const loaded = await loadConversation(id, TEST_USER)
    expect(loaded!.title).toBe('first title')
    expect(JSON.parse(loaded!.serializedContext)).toEqual({ events: [{ id: 'a' }] })
  })

  it('only returns rows for the requesting user', async () => {
    if (!dbAvailable) return
    const id = `conv-${Math.random().toString(36).slice(2, 10)}`
    await saveConversation({
      id,
      userId: TEST_USER,
      agentId: 'default',
      title: 't',
      serializedContext: '{}',
    })
    const otherUser = `other-${Math.random().toString(36).slice(2, 10)}`
    const stolen = await loadConversation(id, otherUser)
    expect(stolen).toBeNull()
  })

  it('lists newest first, scoped to user', async () => {
    if (!dbAvailable) return
    // Serialize inserts so updated_at ordering is deterministic. Promise.all
    // would race them, and Postgres NOW() can return identical values for
    // sub-millisecond inserts.
    const ids: string[] = []
    for (const n of [1, 2, 3]) {
      const id = `conv-list-${n}-${Math.random().toString(36).slice(2, 8)}`
      await saveConversation({
        id,
        userId: TEST_USER,
        agentId: 'default',
        title: `t${n}`,
        serializedContext: '{}',
      })
      await new Promise((r) => setTimeout(r, 15))
      ids.push(id)
    }
    const list = await listConversations(TEST_USER)
    const seen = list.map((r) => r.id).filter((id) => ids.includes(id))
    // Most recent insert appears first
    expect(seen[0]).toBe(ids[2])
    expect(seen[2]).toBe(ids[0])
  })

  it('deleteConversation only deletes when user matches', async () => {
    if (!dbAvailable) return
    const id = `conv-${Math.random().toString(36).slice(2, 10)}`
    await saveConversation({
      id,
      userId: TEST_USER,
      agentId: 'default',
      title: 't',
      serializedContext: '{}',
    })

    await deleteConversation(id, 'wrong-user')
    expect(await loadConversation(id, TEST_USER)).not.toBeNull()

    await deleteConversation(id, TEST_USER)
    expect(await loadConversation(id, TEST_USER)).toBeNull()
  })
})
