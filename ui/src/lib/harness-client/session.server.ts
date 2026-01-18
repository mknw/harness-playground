/**
 * Session Management - Server Only
 *
 * Manages agent sessions with UnifiedContext state and pattern configuration.
 * In-memory storage - replace with Redis/DB for production.
 */

import type { HarnessResultScoped, ConfiguredPattern, WithApproval } from '../harness-patterns'
import type { HarnessData } from '../harness-patterns/harness.server'
import type { RouterData } from '../harness-patterns/router.server'
import type { SimpleLoopData } from '../harness-patterns/patterns'

// ============================================================================
// Types
// ============================================================================

export interface SessionData extends HarnessData, RouterData, SimpleLoopData, WithApproval {
  response?: string
  [key: string]: unknown
}

export interface Session {
  patterns: ConfiguredPattern<SessionData>[]
  lastResult: HarnessResultScoped<SessionData> | null
  /** Serialized context for session persistence */
  serializedContext: string | null
}

// ============================================================================
// Session Storage
// ============================================================================

const sessions = new Map<string, Session>()

/**
 * Get or create a session by ID.
 */
export function getOrCreateSession(sessionId: string): Session {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      patterns: [],
      lastResult: null,
      serializedContext: null
    })
  }
  return sessions.get(sessionId)!
}

/**
 * Get an existing session.
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId)
}

/**
 * Update session state.
 */
export function updateSession(
  sessionId: string,
  update: Partial<Session>
): void {
  const session = sessions.get(sessionId)
  if (session) {
    Object.assign(session, update)
  }
}

/**
 * Delete a session.
 */
export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

/**
 * Check if session has pending approval.
 */
export function hasPendingApproval(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  return session?.lastResult?.status === 'paused'
}
