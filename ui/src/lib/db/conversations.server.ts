/**
 * Conversations Repository — Server Only
 *
 * One table, one JSONB blob per conversation. The blob is the full
 * `serializeContext()` output; we don't normalize events or messages here.
 */

import { assertServerOnImport } from '../harness-patterns/assert.server'
import { query } from './client.server'

assertServerOnImport()

export interface ConversationRow {
  id: string
  userId: string
  agentId: string
  title: string | null
  /** Stringified UnifiedContext (matches serializeContext() output). */
  serializedContext: string
  createdAt: Date
  updatedAt: Date
}

export interface ConversationListItem {
  id: string
  agentId: string
  title: string | null
  updatedAt: Date
}

interface DbRow {
  id: string
  user_id: string
  agent_id: string
  title: string | null
  /** pg returns JSONB columns as already-parsed JS objects. */
  context: unknown
  created_at: Date
  updated_at: Date
}

interface DbListRow {
  id: string
  agent_id: string
  title: string | null
  updated_at: Date
}

function rowToConversation(row: DbRow): ConversationRow {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    title: row.title,
    serializedContext: JSON.stringify(row.context),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Load a conversation, scoped to the requesting user. Returns null when the
 * id is unknown or belongs to someone else.
 */
export async function loadConversation(
  id: string,
  userId: string
): Promise<ConversationRow | null> {
  const { rows } = await query<DbRow>(
    'SELECT id, user_id, agent_id, title, context, created_at, updated_at FROM conversations WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  if (rows.length === 0) return null
  return rowToConversation(rows[0])
}

export interface SaveConversationInput {
  id: string
  userId: string
  agentId: string
  /** Sticky — only set the first time, ignored on subsequent updates. */
  title: string | null
  /** Full serializeContext() output. Stored as JSONB. */
  serializedContext: string
}

/**
 * Upsert a conversation row. Title is sticky: once set it never changes via
 * this path (use a dedicated rename action when we ship one).
 */
export async function saveConversation(
  input: SaveConversationInput
): Promise<void> {
  await query(
    `INSERT INTO conversations (id, user_id, agent_id, title, context)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       agent_id   = EXCLUDED.agent_id,
       context    = EXCLUDED.context,
       title      = COALESCE(conversations.title, EXCLUDED.title),
       updated_at = NOW()`,
    [
      input.id,
      input.userId,
      input.agentId,
      input.title,
      input.serializedContext,
    ]
  )
}

/**
 * List a user's conversations, newest first.
 */
export async function listConversations(
  userId: string
): Promise<ConversationListItem[]> {
  const { rows } = await query<DbListRow>(
    'SELECT id, agent_id, title, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200',
    [userId]
  )
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    updatedAt: r.updated_at,
  }))
}

/**
 * Delete a conversation. No-op when the id doesn't belong to the user.
 */
export async function deleteConversation(
  id: string,
  userId: string
): Promise<void> {
  await query(
    'DELETE FROM conversations WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
}

/**
 * Derive a sticky title from the first user message: trimmed, single-line,
 * capped at 60 chars. Returns null if the input is empty.
 */
export function deriveTitle(firstUserMessage: string): string | null {
  const cleaned = firstUserMessage.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.length > 60 ? cleaned.slice(0, 60) + '…' : cleaned
}
