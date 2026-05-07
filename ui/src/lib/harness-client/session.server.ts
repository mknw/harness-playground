/**
 * Session Management - Server Only
 *
 * Sessions are split into two layers:
 *   - Pattern instances (non-serializable: BAML clients, tool refs, closures).
 *     Cached in-process by sessionId; rebuilt from the agent registry on miss.
 *   - Serialized UnifiedContext (pure JSON). Persisted in Postgres, scoped by
 *     user_id, so conversations survive restarts and can be listed/resumed.
 *
 * The public function names are unchanged from the previous in-memory store,
 * but every function now takes a `userId` and is async.
 */

import { assertServerOnImport } from '../harness-patterns/assert.server'
import type { ConfiguredPattern, WithApproval } from '../harness-patterns'
import type { HarnessData } from '../harness-patterns/harness.server'
import type { RouterData } from '../harness-patterns/patterns/router.server'
import type { SimpleLoopData } from '../harness-patterns/patterns'
import { deserializeContext, serializeContext } from '../harness-patterns'
import type { UnifiedContext } from '../harness-patterns'
import { getAgent } from './registry.server'
import {
  loadConversation,
  saveConversation,
  deleteConversation,
  deriveTitle,
} from '../db/conversations.server'

assertServerOnImport()

// ============================================================================
// Types
// ============================================================================

export interface SessionData extends HarnessData, RouterData, SimpleLoopData, WithApproval {
  response?: string
  [key: string]: unknown
}

interface PatternCacheEntry {
  agentId: string
  patterns: ConfiguredPattern<SessionData>[]
}

// ============================================================================
// In-process pattern cache
// ============================================================================
//
// Patterns hold function references and cannot be serialized. We rebuild them
// on demand from the agent registry and cache the result per sessionId. If an
// incoming request asks for a different agentId for the same sessionId, the
// cache entry is replaced.

const patternCache = new Map<string, PatternCacheEntry>()

export async function getOrBuildPatterns(
  sessionId: string,
  agentId: string
): Promise<ConfiguredPattern<SessionData>[]> {
  const cached = patternCache.get(sessionId)
  if (cached && cached.agentId === agentId) return cached.patterns

  const agent = getAgent(agentId)
  if (!agent) throw new Error(`Unknown agent: ${agentId}`)
  const patterns = await agent.createPatterns()
  patternCache.set(sessionId, { agentId, patterns })
  return patterns
}

export function evictPatterns(sessionId: string): void {
  patternCache.delete(sessionId)
}

// ============================================================================
// Persistence — Postgres-backed
// ============================================================================

export interface LoadedSession {
  serializedContext: string
  agentId: string
}

/** Load a serialized context for (sessionId, userId), or null if not found. */
export async function loadSession(
  sessionId: string,
  userId: string
): Promise<LoadedSession | null> {
  const row = await loadConversation(sessionId, userId)
  if (!row) return null
  return { serializedContext: row.serializedContext, agentId: row.agentId }
}

/**
 * Persist the latest serialized context for this conversation. Title is
 * derived from the first user_message on the very first save and never
 * overwritten after that (sticky in the DB layer).
 */
export async function saveSession(
  sessionId: string,
  userId: string,
  agentId: string,
  serializedContext: string
): Promise<void> {
  const title = extractTitleFromContext(serializedContext)
  await saveConversation({
    id: sessionId,
    userId,
    agentId,
    title,
    serializedContext,
  })
}

export async function deleteSession(
  sessionId: string,
  userId: string
): Promise<void> {
  evictPatterns(sessionId)
  await deleteConversation(sessionId, userId)
}

/** True when the persisted context is in `paused` status (awaiting approval). */
export async function hasPendingApproval(
  sessionId: string,
  userId: string
): Promise<boolean> {
  const loaded = await loadSession(sessionId, userId)
  if (!loaded) return false
  try {
    const ctx = deserializeContext(loaded.serializedContext)
    return ctx.status === 'paused'
  } catch {
    return false
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractTitleFromContext(serializedContext: string): string | null {
  try {
    const ctx = deserializeContext<Record<string, unknown>>(serializedContext)
    const events = (ctx.events ?? []) as Array<{ type: string; data: unknown }>
    const firstUser = events.find((e) => e.type === 'user_message')
    if (!firstUser) return null
    const content = (firstUser.data as { content?: string })?.content ?? ''
    return deriveTitle(content)
  } catch {
    return null
  }
}

/**
 * Re-serialize a mutated in-memory context and persist it. Used by the stash
 * API which mutates `tool_result` events in place via `enrichToolResult`.
 */
export async function persistContext(
  sessionId: string,
  userId: string,
  agentId: string,
  ctx: UnifiedContext
): Promise<void> {
  await saveSession(sessionId, userId, agentId, serializeContext(ctx))
}
