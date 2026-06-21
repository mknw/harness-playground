/**
 * Document Ingestion — Server Only (ties #6 + #9 + #8 together)
 *
 * The capstone of the store → chunk → embed pipeline. Takes a stored
 * {@link StashDocument} and makes it *searchable*:
 *
 *   chunkDocument(content)  →  embed(chunks)  →  Redis vector hashes + HNSW index
 *
 * and answers queries:
 *
 *   embedOne(query)  →  vector_search_hash  →  top-k chunks (with provenance)
 *
 * ── One embedding space per session corpus ────────────────────────────────
 * Vectors are only comparable within one model (see `embeddings.server.ts`).
 * This module makes that structural, not advisory:
 *   - The Redis key prefix AND index name both encode the embedding space
 *     (`provider_model_dim`), so a hash embedded with model A can never land in
 *     model B's index — different prefix, different index, different `dim`.
 *   - The session's space is recorded at `stash:space:{sessionId}`. Re-ingesting
 *     with a *different* model throws (unless `allowSpaceChange`), and queries
 *     are always embedded with the recorded model — so a search can never
 *     compare across spaces.
 *
 * Redis is reached via the injectable MCP `callTool` (defaults to the real
 * client) and embedding via an injectable embed fn, so the whole orchestrator
 * is unit-testable without a live gateway or model server — mirroring
 * `document-store.server.ts`.
 */

import { assertServerOnImport } from './harness-patterns/assert.server'
import { callTool as defaultCallTool } from './harness-patterns/mcp-client.server'
import {
  DEFAULT_TTL_SECONDS,
  redisWriteError,
  type CallTool,
  type StashDocument,
} from './document-store.server'
import { chunkDocument, type Chunk, type ChunkConfig } from './chunking.server'
import {
  embed as defaultEmbed,
  embedOne as defaultEmbedOne,
  assertSameSpace,
  type EmbeddingConfig,
  type EmbeddingResult,
  type EmbeddingSpace,
  type SingleEmbeddingResult,
} from './embeddings.server'

assertServerOnImport()

// ============================================================================
// Types
// ============================================================================

export interface IngestOptions {
  /** Chunking config override (strategy / maxChars / overlap). */
  chunk?: Partial<ChunkConfig>
  /** Embedding provider/model override. */
  embedding?: EmbeddingConfig
  /** TTL for the chunk hashes; defaults to the document TTL window. */
  ttlSeconds?: number
  /** Allow re-ingesting a session under a different embedding space (splits
   *  the corpus — off by default to preserve comparability). */
  allowSpaceChange?: boolean
  /** Injected Redis MCP caller (tests). */
  callTool?: CallTool
  /** Injected embed fn (tests). */
  embedFn?: (texts: string[], config?: EmbeddingConfig) => Promise<EmbeddingResult>
}

export interface IngestResult {
  docId: string
  sessionId: string
  /** Number of chunks embedded + indexed. */
  chunks: number
  /** The embedding space this corpus is bound to. */
  space: EmbeddingSpace
  indexName: string
  prefix: string
}

export interface SearchHit {
  docId: string
  source: string
  chunkIndex: number
  content: string
  startOffset?: number
  endOffset?: number
  /** Vector distance (lower = closer) when the backend reports one. */
  score?: number
}

export interface SearchOptions {
  k?: number
  /** Embedding override; provider/model are forced to the recorded space. */
  embedding?: EmbeddingConfig
  callTool?: CallTool
  embedOneFn?: (text: string, config?: EmbeddingConfig) => Promise<SingleEmbeddingResult>
}

// ============================================================================
// Key / index naming — the space is baked into both
// ============================================================================

const SPACE_KEY_PREFIX = 'stash:space'

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** `provider_model_dim` — equal tags ⇒ comparable vectors. */
function spaceTag(space: EmbeddingSpace): string {
  return `${space.provider}_${sanitize(space.model)}_${space.dimensions}`
}

export function indexNameFor(sessionId: string, space: EmbeddingSpace): string {
  return `stash_idx_${sanitize(sessionId)}_${spaceTag(space)}`
}

export function prefixFor(sessionId: string, space: EmbeddingSpace): string {
  return `stashvec:${sessionId}:${spaceTag(space)}:`
}

function chunkKey(prefix: string, docId: string, chunkIndex: number): string {
  return `${prefix}${docId}:${chunkIndex}`
}

function spaceKey(sessionId: string): string {
  return `${SPACE_KEY_PREFIX}:${sessionId}`
}

// ============================================================================
// Embedding-space bookkeeping
// ============================================================================

/** Read the embedding space a session's corpus was built with, if any. */
export async function getEmbeddingSpace(
  sessionId: string,
  callTool: CallTool = defaultCallTool,
): Promise<EmbeddingSpace | null> {
  const res = await callTool('json_get', { name: spaceKey(sessionId), path: '$' })
  if (!res.success || res.data == null) return null
  let value: unknown = res.data
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) value = value[0]
  if (value == null || typeof value !== 'object') return null
  const s = value as Partial<EmbeddingSpace>
  if (!s.provider || !s.model || typeof s.dimensions !== 'number') return null
  return { provider: s.provider, model: s.model, dimensions: s.dimensions }
}

async function recordSpace(
  callTool: CallTool,
  sessionId: string,
  space: EmbeddingSpace,
  ttl: number,
): Promise<void> {
  await callTool('json_set', {
    name: spaceKey(sessionId),
    path: '$',
    value: JSON.stringify(space),
    expire_seconds: ttl,
  })
}

// ============================================================================
// Ingest
// ============================================================================

/**
 * Chunk → embed → index a stored document into Redis for similarity search.
 *
 * @throws if the session already has a different embedding space (and
 *         `allowSpaceChange` is not set), or if Redis writes fail.
 */
export async function ingestDocument(
  doc: StashDocument,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const callTool = opts.callTool ?? defaultCallTool
  const embedFn = opts.embedFn ?? defaultEmbed
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS

  const chunks: Chunk[] = chunkDocument(doc.content, doc.mimeType, opts.chunk)
  const { vectors, ...space } = await embedFn(
    chunks.map((c) => c.content),
    opts.embedding,
  )

  // Enforce one model per session corpus.
  const existing = await getEmbeddingSpace(doc.sessionId, callTool)
  if (existing && !opts.allowSpaceChange) {
    assertSameSpace(existing, space)
  }

  const indexName = indexNameFor(doc.sessionId, space)
  const prefix = prefixFor(doc.sessionId, space)
  await ensureVectorIndex(callTool, indexName, prefix, space.dimensions)

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const key = chunkKey(prefix, doc.id, c.index)

    const setVec = await callTool('set_vector_in_hash', { name: key, vector: vectors[i] })
    const vecErr = redisWriteError(setVec)
    if (vecErr) {
      throw new Error(`Failed to store vector for chunk ${c.index}: ${vecErr}`)
    }

    const fields: Array<[string, string | number]> = [
      ['content', c.content],
      ['doc_id', doc.id],
      ['session_id', doc.sessionId],
      ['source', doc.filename],
      ['chunk_index', c.index],
      ['start_offset', c.startOffset],
      ['end_offset', c.endOffset],
      ['model', space.model],
      ['provider', space.provider],
      ['dim', space.dimensions],
    ]
    for (let f = 0; f < fields.length; f++) {
      const [k, v] = fields[f]
      // Set the key TTL on the final field write (TTL is per-key; HSET on an
      // existing key preserves it, so one expiring write covers the whole hash).
      await callTool('hset', {
        name: key,
        key: k,
        value: v,
        ...(f === fields.length - 1 ? { expire_seconds: ttl } : {}),
      })
    }
  }

  await recordSpace(callTool, doc.sessionId, space, ttl)

  return {
    docId: doc.id,
    sessionId: doc.sessionId,
    chunks: chunks.length,
    space,
    indexName,
    prefix,
  }
}

/** Create the HNSW index for a (session, space), tolerating "already exists". */
async function ensureVectorIndex(
  callTool: CallTool,
  indexName: string,
  prefix: string,
  dim: number,
): Promise<void> {
  const res = await callTool('create_vector_index_hash', {
    index_name: indexName,
    prefix,
    dim,
    distance_metric: 'COSINE',
  })
  // The Redis MCP returns a string; an existing index surfaces as an error-ish
  // message rather than a thrown exception. Only a hard failure that is NOT an
  // "already exists" should propagate.
  const err = redisWriteError(res)
  if (err && !/exist/i.test(err)) {
    throw new Error(`Failed to create vector index ${indexName}: ${err}`)
  }
}

// ============================================================================
// Search
// ============================================================================

/**
 * Embed `query` with the session's recorded model and KNN-search its index.
 * Returns [] when the session has no ingested corpus yet.
 *
 * The query is always embedded with the *recorded* provider/model, and
 * {@link assertSameSpace} re-checks dimensionality — a search can never compare
 * vectors across embedding spaces.
 */
export async function searchDocuments(
  sessionId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const callTool = opts.callTool ?? defaultCallTool
  const embedOneFn = opts.embedOneFn ?? defaultEmbedOne

  const recorded = await getEmbeddingSpace(sessionId, callTool)
  if (!recorded) return []

  const q = await embedOneFn(query, {
    ...opts.embedding,
    provider: recorded.provider,
    model: recorded.model,
    dimensions: recorded.dimensions,
  })
  assertSameSpace(recorded, { provider: q.provider, model: q.model, dimensions: q.dimensions })

  const res = await callTool('vector_search_hash', {
    index_name: indexNameFor(sessionId, recorded),
    query_vector: q.vector,
    k: opts.k ?? 5,
    return_fields: [
      'content',
      'doc_id',
      'source',
      'chunk_index',
      'start_offset',
      'end_offset',
    ],
  })
  if (!res.success || res.data == null) return []
  return parseSearchHits(res.data)
}

/**
 * Tolerant parser for `vector_search_hash` output. The Redis MCP returns "a
 * list of matched documents"; field names vary slightly by version, so this
 * accepts a few shapes and skips anything it can't read rather than throwing.
 */
function parseSearchHits(data: unknown): SearchHit[] {
  let rows: unknown = data
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows)
    } catch {
      return []
    }
  }
  // Some versions wrap results under a key; unwrap common shapes.
  if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
    const obj = rows as Record<string, unknown>
    rows = obj.results ?? obj.documents ?? obj.matches ?? []
  }
  if (!Array.isArray(rows)) return []

  const hits: SearchHit[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const content = str(r.content)
    if (content == null) continue
    hits.push({
      docId: str(r.doc_id) ?? '',
      source: str(r.source) ?? '',
      chunkIndex: num(r.chunk_index) ?? 0,
      content,
      startOffset: num(r.start_offset),
      endOffset: num(r.end_offset),
      score: num(r.score ?? r.distance ?? r.__vector_score),
    })
  }
  return hits
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined
}
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}
