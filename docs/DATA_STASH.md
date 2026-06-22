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
| `document-ingest.server.ts` | Orchestrator: chunk → embed → Redis HNSW index, and `searchDocuments` (KNN) |
| `stash/upload-service.server.ts`, `stash/http.server.ts` | Upload request parsing (multipart + JSON), auth/response helpers |

## API routes (`ui/src/routes/api/stash/`)

| Method · Path | Purpose |
|---|---|
| `POST /api/stash/upload` | Store a document (multipart `file`, or JSON `{sessionId, filename, content}`) |
| `GET /api/stash/upload?sessionId=` | List a session's documents (metadata) |
| `GET /api/stash/document/:id?sessionId=` | Fetch a document (content + metadata) |
| `DELETE /api/stash/document/:id?sessionId=` | Remove a document + its index entry |
| `PATCH /api/stash/document/:id` | Toggle `hidden` / `archived` (`{sessionId, hidden?, archived?}`) |
| `POST /api/stash/ingest` | Chunk → embed → index a stored doc (`{sessionId, docId, chunk?, embedding?}`) |
| `GET /api/stash/search?sessionId=&q=&k=` | KNN similarity search over a session's chunks |

Auth follows the existing posture (dev-bypass aware; see `lib/auth/dev-bypass.ts`). Ingest is **explicit**, not auto-run on upload — it needs an embedding backend and binds the corpus to one model.

## Storage model (Redis)

- **Document**: RedisJSON blob at `stash:doc:{sessionId}:{docId}`, TTL default 7 days. `content` is opaque UTF-8 text (binary extraction is the upstream caller's job — not done yet).
- **Session index**: a Redis SET `stash:docs:{sessionId}` of doc ids (self-healing — stale entries pruned on list).
- **Chunk**: a Redis HASH `stashvec:{sessionId}:{spaceTag}:{docId}:{chunkIndex}` with `vector` (float blob) + `meta` (base64 of a JSON `{content, doc_id, source, chunk_index, offsets, model, provider, dim}`). 2 writes/chunk.
- **Vector index**: a RediSearch HNSW index per `(session, embedding-space)`; `dim` matches the embedding model.
- **Embedding space**: recorded at `stash:space:{sessionId}` as `{provider, model, dimensions}`.

`MAX_CONTENT_BYTES` = 5 MiB. Accepts any text-decodable file; the picker hints Text/Markdown/JSON/CSV (no hard allow-list — binaries decode as garbage today).

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

## Requirements & gotchas

- **redis-stack** (not plain `redis`): the pipeline needs **RedisJSON** (`json_*`) and **RediSearch** (`create_vector_index_hash` / `vector_search_hash`). The compose `redis` service uses `redis/redis-stack` (merged in #91).
- **Apple-Silicon / colima:** redis-stack's arm64 `redisearch.so` SIGILL-crashes on the colima VM during vector ops. Run the redis service as `platform: linux/amd64` (emulated) — see the git-ignored `docker-compose.override.yml`. Long-term: colima CPU passthrough (`--vm-type vz`). Store/RedisJSON is unaffected; only vector search needs this.
- **Gateway argument/result quirks** (see [CLAUDE.md → Redis MCP Tool Parameters](../CLAUDE.md)): the MCP gateway runs the redis server over serial stdio (so ingest is sequential and minimal-call), returns multi-value results as one text block per element (handled by `callTool` aggregation), and auto-parses JSON-looking string args into objects (so chunk `meta` is base64-encoded).

## Relationships

- **#89** (sandbox `/work` ⇄ DataStash artifact sync) builds on the store/retrieve path (`getDocument` / `toPriorResult`); it does not require vector search.
- Distinct from **#17** (RDF/OWL → Neo4j): this is documents → Redis + vectors.
