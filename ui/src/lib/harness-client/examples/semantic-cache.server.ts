/**
 * Semantic Cache Agent
 *
 * Pattern: semanticCache → conditionalRetrieval (parallel web+kg) → cacheWriter → synthesizer
 * Use case: serve answers to *semantically equivalent* queries from cache before
 * hitting web/neo4j sources.
 *
 * Two cache layers:
 *   L1 — exact match: `json_get query:${hashInput(input)}` (fast, byte-identical).
 *   L2 — semantic: embed the query (embeddings.server) and KNN-search a Redis
 *        vector index (vector-store.server). A hit requires the nearest neighbour
 *        within `SEMANTIC_HIT_MAX_DISTANCE` (cosine distance, lower = closer).
 *
 * Both the read (check) and write paths embed the query; the cached result rides
 * in the vector record's payload, so a semantic hit needs no second lookup. The
 * L2 layer is best-effort: if the embedder (local llama :8090) or RediSearch is
 * unavailable it is skipped, and the agent falls back to exact-match + retrieval.
 * (RediSearch on arm64 colima needs the amd64 redis override — see docs/DATA_STASH.md.)
 */
"use server";

import {
  simpleLoop,
  parallel,
  synthesizer,
  configurePattern,
  Tools,
  callTool,
  createWebSearchController,
  createNeo4jController,
  type ConfiguredPattern,
} from "../../harness-patterns";
import { embedOne } from "../../embeddings.server";
import { createVectorStore, spaceTag } from "../../vector-store.server";
import type { EmbeddingSpace } from "../../embeddings.server";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

/** Max cosine distance for a semantic cache hit (lower = more similar). Tunable;
 *  a future iteration could surface this via HarnessSettings. */
const SEMANTIC_HIT_MAX_DISTANCE = 0.15;
/** Cache entries live 24h. */
const CACHE_TTL_SECONDS = 86400;

// Simple hash function for exact-match cache keys
function hashInput(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// The semantic cache is global (cross-session); one index per embedding model.
function cacheIndexName(space: EmbeddingSpace): string {
  return `qcache_idx_${spaceTag(space)}`;
}
function cacheKeyPrefix(space: EmbeddingSpace): string {
  return `qcache:${spaceTag(space)}:`;
}

async function getSchema(): Promise<string> {
  const result = await callTool("get_neo4j_schema", {});
  return result.success ? JSON.stringify(result.data) : "";
}

async function createPatterns(_sessionId: string): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Cache check: L1 exact-match, then L2 semantic (KNN over query embeddings).
  const semanticCache = configurePattern<SessionData>(
    "semantic-cache",
    async (scope) => {
      const input = (scope.data as Record<string, unknown>).input as string ?? "";
      const cacheKey = `query:${hashInput(input)}`;

      // L1 — exact match.
      try {
        const cached = await callTool("json_get", { name: cacheKey, path: "$" });
        if (cached.success && cached.data) {
          console.log("[SemanticCache] exact hit:", input.slice(0, 50));
          scope.data = {
            ...scope.data,
            response: JSON.stringify(cached.data),
            cacheHit: true,
            cacheKind: "exact",
          };
          return scope;
        }
      } catch {
        // Redis unavailable — fall through to a miss.
      }

      // L2 — semantic (best-effort: needs the embedder + RediSearch).
      try {
        const q = await embedOne(input);
        const space: EmbeddingSpace = { provider: q.provider, model: q.model, dimensions: q.dimensions };
        const store = createVectorStore({
          indexName: cacheIndexName(space),
          prefix: cacheKeyPrefix(space),
          dim: q.dimensions,
        });
        const [top] = await store.search(q.vector, 1);
        if (
          top &&
          typeof top.score === "number" &&
          top.score <= SEMANTIC_HIT_MAX_DISTANCE &&
          top.payload.result != null
        ) {
          console.log(`[SemanticCache] semantic hit (d=${top.score.toFixed(3)}):`, input.slice(0, 50));
          scope.data = {
            ...scope.data,
            response: JSON.stringify(top.payload.result),
            cacheHit: true,
            cacheKind: "semantic",
          };
          return scope;
        }
      } catch {
        // Embedder/RediSearch unavailable — skip the semantic layer.
      }

      // Cache miss
      scope.data = { ...scope.data, cacheHit: false };
      return scope;
    },
    { patternId: "semantic-cache" },
  );

  // Source patterns (only executed on cache miss)
  const webSearch = simpleLoop<SessionData>(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "web-search", maxTurns: 4 },
  );

  const kgSearch = simpleLoop<SessionData>(
    createNeo4jController(tools.neo4j ?? []),
    tools.neo4j ?? [],
    { patternId: "kg-search", schema, maxTurns: 4 },
  );

  // Conditional retrieval: skip if cache hit
  const conditionalRetrieval = configurePattern<SessionData>(
    "conditional-retrieval",
    async (scope, view) => {
      if ((scope.data as Record<string, unknown>).cacheHit) {
        // Skip retrieval on cache hit
        return scope;
      }

      // Execute parallel search
      const retrieval = parallel<SessionData>([webSearch, kgSearch], {
        patternId: "retrieval",
      });
      const result = await retrieval.fn(scope, view);
      scope.events.push(...result.events);
      scope.data = { ...scope.data, ...result.data };
      return scope;
    },
    { patternId: "conditional-retrieval" },
  );

  // Cache writer: store results on cache miss (both layers)
  const cacheWriter = configurePattern<SessionData>(
    "cache-writer",
    async (scope, view) => {
      const data = scope.data as Record<string, unknown>;
      if (data.cacheHit) return scope; // Skip if was cache hit

      const input = data.input as string ?? "";
      const cacheKey = `query:${hashInput(input)}`;
      const results = view.fromLastPattern().ofType("tool_result").get().map((r) => r.data);
      const payload = { query: input, result: results, ts: Date.now() };

      // L1 — exact-match entry.
      try {
        await callTool("json_set", {
          name: cacheKey,
          path: "$",
          value: JSON.stringify(payload),
        });
        await callTool("expire", { name: cacheKey, expire_seconds: CACHE_TTL_SECONDS });
      } catch {
        // Redis unavailable.
      }

      // L2 — semantic entry (best-effort): embed the query, store query→result.
      try {
        const q = await embedOne(input);
        const space: EmbeddingSpace = { provider: q.provider, model: q.model, dimensions: q.dimensions };
        const store = createVectorStore({
          indexName: cacheIndexName(space),
          prefix: cacheKeyPrefix(space),
          dim: q.dimensions,
        });
        await store.ensureIndex();
        await store.upsert(hashInput(input), q.vector, payload, CACHE_TTL_SECONDS);
      } catch {
        // Embedder/RediSearch unavailable — skip the semantic layer.
      }

      console.log("[SemanticCache] cached result for:", input.slice(0, 50));
      return scope;
    },
    { patternId: "cache-writer" },
  );

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "retrieval-synth",
  });

  return [
    semanticCache,       // Check cache first (L1 exact, L2 semantic)
    conditionalRetrieval, // On miss: fetch from sources
    cacheWriter,         // Store result in both cache layers
    responseSynth,
  ];
}

export const semanticCacheAgent: AgentConfig = {
  id: "semantic-cache",
  name: "Semantic Cache",
  description: "Redis-backed semantic cache with real embedding-based vector similarity search",
  icon: "⚡",
  servers: ["redis", "web_search", "neo4j-cypher"],
  createPatterns,
};
