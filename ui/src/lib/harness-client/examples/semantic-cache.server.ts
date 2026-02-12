/**
 * Semantic Cache Agent
 *
 * Pattern: semanticCache → (parallel) → cacheWriter → synthesizer
 * Use case: Build a semantic cache that checks redis vector similarity
 * before hitting web/neo4j sources.
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
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

// Simple hash function for cache keys
function hashInput(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

async function getSchema(): Promise<string> {
  const result = await callTool("get_neo4j_schema", {});
  return result.success ? JSON.stringify(result.data) : "";
}

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Semantic cache check pattern
  const semanticCache = configurePattern<SessionData>(
    "semantic-cache",
    async (scope) => {
      const input = (scope.data as Record<string, unknown>).input as string ?? "";
      const cacheKey = `query:${hashInput(input)}`;

      try {
        // Try to get from cache
        const cached = await callTool("json_get", { name: cacheKey, path: "$" });

        if (cached.success && cached.data) {
          // Cache hit
          console.log("[SemanticCache] Cache hit for:", input.slice(0, 50));
          scope.data = {
            ...scope.data,
            response: JSON.stringify(cached.data),
            cacheHit: true,
          };
          return scope;
        }

        // For vector similarity search (if redis has vector support)
        // This is a placeholder - in production, compute embedding first
        try {
          const similar = await callTool("vector_search_hash", {
            index_name: "idx:query_cache",
            query_vector: [], // Would be embedding vector in production
            k: 1,
          });

          if (
            similar.success &&
            Array.isArray(similar.data) &&
            similar.data.length > 0 &&
            similar.data[0].score > 0.92
          ) {
            const resultKey = similar.data[0].key;
            const result = await callTool("json_get", { name: resultKey, path: "$.result" });
            if (result.success && result.data) {
              scope.data = {
                ...scope.data,
                response: JSON.stringify(result.data),
                cacheHit: true,
              };
              return scope;
            }
          }
        } catch {
          // Vector search may not be configured
        }

      } catch {
        // Redis may not be available
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

  // Cache writer: store results on cache miss
  const cacheWriter = configurePattern<SessionData>(
    "cache-writer",
    async (scope, view) => {
      const data = scope.data as Record<string, unknown>;
      if (data.cacheHit) return scope; // Skip if was cache hit

      const input = data.input as string ?? "";
      const cacheKey = `query:${hashInput(input)}`;

      try {
        // Get results from events
        const results = view.fromLastPattern().ofType("tool_result").get();

        // Store result as JSON
        await callTool("json_set", {
          name: cacheKey,
          path: "$",
          value: JSON.stringify({
            query: input,
            result: results.map((r) => r.data),
            ts: Date.now(),
          }),
        });

        // Set TTL: 24 hours
        await callTool("expire", { name: cacheKey, expire_seconds: 86400 });

        console.log("[SemanticCache] Cached result for:", input.slice(0, 50));
      } catch {
        // Redis may not be available
      }

      return scope;
    },
    { patternId: "cache-writer" },
  );

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "retrieval-synth",
  });

  return [
    semanticCache,       // Check cache first
    conditionalRetrieval, // On miss: fetch from sources
    cacheWriter,         // Store result in cache
    responseSynth,
  ];
}

export const semanticCacheAgent: AgentConfig = {
  id: "semantic-cache",
  name: "Semantic Cache",
  description: "Redis-backed semantic cache with vector similarity search",
  icon: "⚡",
  servers: ["redis", "web_search", "neo4j-cypher"],
  createPatterns,
};
