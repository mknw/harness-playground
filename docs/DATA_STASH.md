# Data Stash — Document Ingestion Pipeline

The Data Stash lets users upload documents that the agent can reference and
search. This doc covers the **store → chunk → embed → search** pipeline
(issues #6, #9, #8). For the tool-result side of the stash (hide/archive of
agent-produced results) see [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md).

```
upload ─▶ store (RedisJSON) ─▶ chunk ─▶ embed (local/OpenRouter) ─▶ HNSW index
                                                                         │
query ─────────────────────── embed query (same model) ────▶ KNN search ┘
```

## Modules (`ui/src/lib/`)

| Module | Role |
|--------|------|
| `document-store.server.ts` (#6) | RedisJSON storage: CRUD, TTL, per-session index, hide/archive flags, `toPriorResult` adapter |
| `chunking.server.ts` (#9) | Pure text chunking — `fixed` / `sentence` / `paragraph` + MIME-aware `chunkDocument` |
| `embeddings.server.ts` (#8) | Provider-pluggable embedding with a one-model-per-corpus guard |
| `vector-store.server.ts` | Shared RediSearch wrapper: `createVectorStore` → `ensureIndex` / `upsert` / `search`; owns the index/key/payload plumbing + naming (`spaceTag`) |
| `document-ingest.server.ts` | Orchestrator: chunk → embed → vector store, and `searchDocuments` (KNN) |
| `stash/upload-service.server.ts`, `stash/http.server.ts` | Upload request parsing (multipart + JSON), auth/response helpers |

## API routes (`ui/src/routes/api/stash/`)

| Method · Path | Purpose |
|---|---|
| `POST /api/stash/upload` | Store a document (multipart `file`, or JSON `{sessionId, filename, content}`) |
| `GET /api/stash/upload?sessionId=` | List a session's documents (metadata) |
| `GET /api/stash/document/:id?sessionId=` | Fetch a document (content + metadata) |
| `GET /api/stash/document/:id?sessionId=&download` | Stream the raw file (base64 decoded for binary) with `Content-Disposition` (#89) |
| `DELETE /api/stash/document/:id?sessionId=` | Remove a document + its index entry |
| `PATCH /api/stash/document/:id` | Toggle `hidden` / `archived` (`{sessionId, hidden?, archived?}`) |
| `POST /api/stash/ingest` | Chunk → embed → index a stored doc (`{sessionId, docId, chunk?, embedding?}`) |
| `GET /api/stash/search?sessionId=&q=&k=` | KNN similarity search over a session's chunks |

Auth follows the existing posture (dev-bypass aware; see `lib/auth/dev-bypass.ts`). Ingest is **explicit**, not auto-run on upload — it needs an embedding backend and binds the corpus to one model.

## Storage model (Redis)

- **Document**: RedisJSON blob at `stash:doc:{sessionId}:{docId}`, TTL default 7 days. `content` is UTF-8 text by default; binary files (xlsx, pdf, images) are stored with `encoding: 'base64'` and `size` = the original (decoded) byte count (#89). Binary content is byte-faithful but **not** semantically searchable — `POST /api/stash/ingest` rejects base64 docs (chunking/embedding is text-only).
- **Session index**: a Redis SET `stash:docs:{sessionId}` of doc ids (self-healing — stale entries pruned on list).
- **Chunk**: a Redis HASH `stashvec:{sessionId}:{spaceTag}:{docId}:{chunkIndex}` with `vector` (float blob) + `meta` (base64 of a JSON `{content, doc_id, source, chunk_index, offsets, model, provider, dim}`). 2 writes/chunk.
- **Vector index**: a RediSearch HNSW index per `(session, embedding-space)`; `dim` matches the embedding model.
- **Embedding space**: recorded at `stash:space:{sessionId}` as `{provider, model, dimensions}`.

`MAX_CONTENT_BYTES` = 5 MiB (applies to the original bytes, base64 or not). Text files store verbatim; recognized binary types are base64-encoded by the upload service (`isTextMime` decides). Text remains the path for anything you want to search; binary is for byte-faithful round-trips (e.g. the sandbox `/work` flow, #89).

## Chunking (#9)

Default `{ maxChars: 1000, overlap: 200, strategy: 'paragraph' }`. `chunkDocument(content, mimeType)` routes by type: **CSV/TSV** → row-grouping with the header repeated; **JSON** → pretty-print then chunk; everything else → `chunkText`. Strategies: `paragraph` (blank lines), `sentence` (`.!?`), `fixed` (sliding window). Overlap is carried between chunks; an oversized single unit falls back to a fixed window. Offsets satisfy `content === text.slice(start, end)` (CSV excepted).

## Embeddings (#8) — one model per corpus

Vectors are only comparable within one model, so there is **no silent cross-provider fallback**. The provider is a deliberate choice:

- **`local`** (dev default) — `llama-server --embedding` on `:8090` (Qwen3-Embedding-0.6B, 1024-dim), OpenAI-compatible `/v1/embeddings`.
- **`openrouter`** — selectable; requires `OPENROUTER_API_KEY`.

`embed()` returns vectors tagged with `{provider, model, dimensions}`; `assertSameSpace()` enforces comparability. The space is baked into the index name and key prefix, and re-ingesting a session under a different model **throws** (override with `allowSpaceChange`). Env: `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_LOCAL_URL`, `EMBEDDINGS_LOCAL_MODEL`.

Start the local embedder (separate from `pnpm dev:llama`, which serves a *chat* model on `:8080`):

```bash
llama-server --embedding -m models/Qwen3-Embedding-0.6B-Q8_0.gguf --port 8090 --ctx-size 8192
```

## Shared vector store

`vector-store.server.ts` is the single home for the embed-target Redis plumbing —
`createVectorStore({ indexName, prefix, dim })` → `ensureIndex()` / `upsert(id, vector, payload, ttl)` / `search(queryVector, k)`. It owns index creation (tolerating "already exists"), the 2-writes-per-record format (vector + base64 `meta` payload), KNN result parsing, and the `spaceTag(space)` naming that keeps one index to one model. Both consumers use it:

- **`document-ingest.server.ts`** — document chunks (index/prefix per `(session, space)`).
- **Semantic Cache agent** (`harness-client/examples/semantic-cache.server.ts`) — caches query→result vectors in a global per-model index (`qcache_idx_{spaceTag}`). It embeds the query on read and write: L1 is an exact-hash `json_get`; L2 is a distance-thresholded KNN over the query embeddings (`SEMANTIC_HIT_MAX_DISTANCE`), best-effort so it degrades to exact-match + retrieval when the embedder/RediSearch is unavailable.

## Requirements & gotchas

- **redis-stack** (not plain `redis`): the pipeline needs **RedisJSON** (`json_*`) and **RediSearch** (`create_vector_index_hash` / `vector_search_hash`). The compose `redis` service uses `redis/redis-stack` (merged in #91).
- **Apple-Silicon / colima:** redis-stack's arm64 `redisearch.so` SIGILL-crashes on the colima VM during vector ops. Run the redis service as `platform: linux/amd64` (emulated) — see the git-ignored `docker-compose.override.yml`. Long-term: colima CPU passthrough (`--vm-type vz`). Store/RedisJSON is unaffected; only vector search needs this.
- **Gateway argument/result quirks** (see [CLAUDE.md → Redis MCP Tool Parameters](../CLAUDE.md)): the MCP gateway runs the redis server over serial stdio (so ingest is sequential and minimal-call), returns multi-value results as one text block per element (handled by `callTool` aggregation), and auto-parses JSON-looking string args into objects (so chunk `meta` is base64-encoded).

## Relationships

- **#89** (sandbox `/work` ⇄ DataStash artifact sync) builds on the store/retrieve path (`storeDocument` / `getDocument` / `listDocuments`) and added the base64 `encoding` field + the `?download` route for byte-faithful binaries. It does not require vector search. Mechanism: [`docs/sandbox-plan.md → Durable workspaces`](sandbox-plan.md#durable-workspaces-89).
- Distinct from **#17** (RDF/OWL → Neo4j): this is documents → Redis + vectors.
