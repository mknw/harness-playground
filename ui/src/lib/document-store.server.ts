/**
 * Document Store — Server Only (Issue #6)
 *
 * Redis-backed persistence for user-uploaded Data Stash documents.
 *
 * Documents live alongside tool results in the Data Stash and are referenced
 * by the agent across turns via the same `ref:<id>` mechanism (see
 * `simpleLoop.server.ts` → `PriorResult` / `resolveRefs`). This module owns
 * only the *storage* layer: write/read/list/delete a document and toggle its
 * stash flags. Chunking (#9) and embedding (#8) build on top of the returned
 * `StashDocument` shape — they never re-implement Redis access.
 *
 * Storage layout (RedisJSON, one document per key):
 *
 *   stash:doc:{sessionId}:{docId}   →  JSON blob (StashDocument)
 *   stash:docs:{sessionId}          →  SET of docIds for the session (index)
 *
 * Each document key carries a configurable TTL via `expire` so stale uploads
 * don't accumulate. The index set is refreshed with the same TTL on every
 * write so a fully-expired session leaves no dangling index.
 *
 * Redis is reached through the MCP Gateway's `callTool`. The MCP tool param
 * quirks (see CLAUDE.md → "Redis MCP Tool Parameters") are encapsulated here:
 *   - json_set / json_get: `name` is the Redis key, `path` the JSON path
 *   - expire:              `name` + `expire_seconds`
 *   - sadd / smembers / srem: `name` is the SET key
 *   - delete:              `key` (note: not `name`)
 */

import { assertServerOnImport } from './harness-patterns/assert.server'
import { callTool as defaultCallTool } from './harness-patterns/mcp-client.server'
import type { ToolCallResult } from './harness-patterns/types'
import type { PriorResult } from '../../baml_client/types'

assertServerOnImport()

// ============================================================================
// Types — the public contract chunking (#9) and embedding (#8) consume
// ============================================================================

/** Metadata stored alongside the document content. */
export interface StashDocumentMeta {
  /** Stable per-session document id (also the `ref:<id>` target). */
  id: string
  /** Session that owns this document. */
  sessionId: string
  /** Original filename as uploaded. */
  filename: string
  /** MIME type, e.g. `text/plain`, `application/json`, `text/csv`. */
  mimeType: string
  /** Content size in bytes (UTF-8). */
  size: number
  /** Upload timestamp (epoch ms). */
  uploadedAt: number
  /** Hidden from LLM context (mirrors tool-result stash semantics). */
  hidden?: boolean
  /** Moved to the Archived section (also excluded from LLM context). */
  archived?: boolean
}

/** A stored document: metadata + its (already text-extracted) content. */
export interface StashDocument extends StashDocumentMeta {
  /**
   * Text content of the document. Upstream callers (the upload route) are
   * responsible for extracting text from binary formats (PDF, etc.) before
   * storing — this layer treats `content` as opaque UTF-8 text.
   */
  content: string
}

/** Input for {@link storeDocument}. `id` and `uploadedAt` are minted here. */
export interface StoreDocumentInput {
  sessionId: string
  filename: string
  mimeType: string
  content: string
  /** Override the generated id (e.g. for deterministic tests). */
  id?: string
  /** TTL override in seconds; falls back to {@link DEFAULT_TTL_SECONDS}. */
  ttlSeconds?: number
}

// ============================================================================
// Configuration
// ============================================================================

/** Default document TTL: 7 days. Keeps uploads around across a working
 *  session without letting them accumulate forever. */
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Maximum stored content size (bytes). Redis values can be far larger, but
 * uploads beyond this are rejected here to protect the LLM context budget —
 * the chunking/embedding pipeline (#9/#8) is the path for large documents, not
 * full inlining. Callers can raise this per-call once that pipeline lands.
 */
export const MAX_CONTENT_BYTES = 5 * 1024 * 1024 // 5 MiB

const DOC_KEY_PREFIX = 'stash:doc'
const INDEX_KEY_PREFIX = 'stash:docs'

/** A `callTool`-shaped function. Injectable so the store is unit-testable
 *  without a live MCP gateway (tests pass a stub; prod uses the MCP client). */
export type CallTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<ToolCallResult>

// ============================================================================
// Key helpers
// ============================================================================

function docKey(sessionId: string, docId: string): string {
  return `${DOC_KEY_PREFIX}:${sessionId}:${docId}`
}

function indexKey(sessionId: string): string {
  return `${INDEX_KEY_PREFIX}:${sessionId}`
}

function newDocId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for non-secure contexts (mirrors session-id.ts rationale).
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function byteLength(str: string): number {
  return typeof Buffer !== 'undefined'
    ? Buffer.byteLength(str, 'utf8')
    : new TextEncoder().encode(str).length
}

/**
 * RedisJSON returns the value at `$` wrapped in a single-element array
 * (`["...stringified..."]` or `[{...}]`), and the MCP layer may hand it back
 * either parsed or as a JSON string. Normalise to the contained value.
 */
function unwrapJsonGet(data: unknown): unknown {
  let value: unknown = data
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : undefined
  }
  return value
}

// ============================================================================
// Store
// ============================================================================

/**
 * Persist an uploaded document in Redis and register it in the session index.
 * Returns the stored document (with its minted `id` and `uploadedAt`).
 *
 * @throws if the content exceeds {@link MAX_CONTENT_BYTES} or Redis rejects
 *         the write — callers surface this as a 4xx/5xx on the upload route.
 */
export async function storeDocument(
  input: StoreDocumentInput,
  callTool: CallTool = defaultCallTool,
): Promise<StashDocument> {
  const size = byteLength(input.content)
  if (size > MAX_CONTENT_BYTES) {
    throw new Error(
      `Document too large: ${size} bytes exceeds limit of ${MAX_CONTENT_BYTES} bytes`,
    )
  }

  const doc: StashDocument = {
    id: input.id ?? newDocId(),
    sessionId: input.sessionId,
    filename: input.filename,
    mimeType: input.mimeType,
    size,
    uploadedAt: Date.now(),
    content: input.content,
  }

  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const key = docKey(doc.sessionId, doc.id)

  const set = await callTool('json_set', {
    name: key,
    path: '$',
    value: JSON.stringify(doc),
    expire_seconds: ttl,
  })
  if (!set.success) {
    throw new Error(`Failed to store document: ${set.error ?? 'unknown error'}`)
  }

  // Register in the per-session index, refreshing its TTL to outlive the docs.
  await callTool('sadd', {
    name: indexKey(doc.sessionId),
    value: doc.id,
    expire_seconds: ttl,
  })

  return doc
}

// ============================================================================
// Read
// ============================================================================

/** Retrieve a full document (content + metadata), or null if absent/expired. */
export async function getDocument(
  sessionId: string,
  docId: string,
  callTool: CallTool = defaultCallTool,
): Promise<StashDocument | null> {
  const res = await callTool('json_get', {
    name: docKey(sessionId, docId),
    path: '$',
  })
  if (!res.success || res.data == null) return null

  const value = unwrapJsonGet(res.data)
  if (value == null || typeof value !== 'object') return null
  return value as StashDocument
}

/** Retrieve a document's metadata without its content. */
export async function getDocumentMeta(
  sessionId: string,
  docId: string,
  callTool: CallTool = defaultCallTool,
): Promise<StashDocumentMeta | null> {
  const doc = await getDocument(sessionId, docId, callTool)
  if (!doc) return null
  return stripContent(doc)
}

/**
 * List metadata for every (non-expired) document in a session. Documents whose
 * keys have expired but linger in the index are pruned from the index as a
 * side-effect, so the index self-heals.
 */
export async function listDocuments(
  sessionId: string,
  callTool: CallTool = defaultCallTool,
): Promise<StashDocumentMeta[]> {
  const members = await callTool('smembers', { name: indexKey(sessionId) })
  if (!members.success || !Array.isArray(members.data)) return []

  const ids = members.data.filter((m): m is string => typeof m === 'string')
  const out: StashDocumentMeta[] = []

  for (const id of ids) {
    const doc = await getDocument(sessionId, id, callTool)
    if (doc) {
      out.push(stripContent(doc))
    } else {
      // Key expired/missing — drop the stale index entry.
      await callTool('srem', { name: indexKey(sessionId), value: id })
    }
  }

  // Newest first, matching the conversations list ordering.
  out.sort((a, b) => b.uploadedAt - a.uploadedAt)
  return out
}

// ============================================================================
// Mutate flags (hide / unhide / archive / unarchive)
// ============================================================================

/**
 * Patch a document's stash flags in place (hide/archive), preserving its TTL.
 * Mirrors `enrichToolResult` semantics for tool results so the existing
 * DataStashPanel actions apply uniformly to uploads. Returns the updated
 * document, or null if it no longer exists.
 */
export async function setDocumentFlags(
  sessionId: string,
  docId: string,
  patch: { hidden?: boolean; archived?: boolean },
  callTool: CallTool = defaultCallTool,
): Promise<StashDocument | null> {
  const doc = await getDocument(sessionId, docId, callTool)
  if (!doc) return null

  if (patch.hidden !== undefined) doc.hidden = patch.hidden
  if (patch.archived !== undefined) doc.archived = patch.archived

  // Rewriting via json_set at `$` would clear any existing expiry, so we
  // re-apply a TTL. There is no `ttl` tool on the Redis MCP surface to read the
  // remaining time, so we refresh to the default window — a flag edit signals
  // the document is still in use, making a fresh window reasonable.
  const key = docKey(sessionId, docId)
  const set = await callTool('json_set', {
    name: key,
    path: '$',
    value: JSON.stringify(doc),
    expire_seconds: DEFAULT_TTL_SECONDS,
  })
  if (!set.success) {
    throw new Error(`Failed to update document: ${set.error ?? 'unknown error'}`)
  }
  return doc
}

// ============================================================================
// Delete
// ============================================================================

/** Remove a document from Redis and from the session index. Idempotent. */
export async function deleteDocument(
  sessionId: string,
  docId: string,
  callTool: CallTool = defaultCallTool,
): Promise<void> {
  // `delete` uses `key` (not `name`) — see CLAUDE.md Redis quirks.
  await callTool('delete', { key: docKey(sessionId, docId) })
  await callTool('srem', { name: indexKey(sessionId), value: docId })
}

// ============================================================================
// Agent-facing adapter — surface a document as a PriorResult / ref
// ============================================================================

/**
 * Convert a stored document into the `PriorResult` shape simpleLoop already
 * uses for tool results, so uploads can be passed through `turns_previous_runs`
 * and expanded via `ref:<id>` without touching the harness-patterns layer.
 *
 * `summary` is a short, deterministic preview here; the embedding/summarization
 * pipeline (#8) can replace it with a model-authored summary later.
 */
export function toPriorResult(
  doc: StashDocumentMeta & { content?: string },
  previewChars = 200,
): PriorResult {
  const preview = doc.content
    ? doc.content.slice(0, previewChars).replace(/\s+/g, ' ').trim() +
      (doc.content.length > previewChars ? '…' : '')
    : `${doc.filename} (${doc.mimeType}, ${doc.size} bytes)`
  return {
    ref_id: doc.id,
    tool: `upload:${doc.filename}`,
    summary: preview,
    expanded_in_turn: null,
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

function stripContent(doc: StashDocument): StashDocumentMeta {
  const { content: _content, ...meta } = doc
  void _content
  return meta
}
