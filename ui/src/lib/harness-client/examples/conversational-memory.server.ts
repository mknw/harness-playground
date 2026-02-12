/**
 * Conversational Memory Agent
 *
 * Pattern: sessionTracker → router → memoryWriter → synthesizer
 * Plus: hook pattern on session close for KB distillation
 *
 * Use case: Memory as conversational scratchpad; neo4j as persistent KB.
 */
"use server";

import {
  router,
  simpleLoop,
  synthesizer,
  configurePattern,
  hook,
  Tools,
  callTool,
  createNeo4jController,
  createWebSearchController,
  createMemoryController,
  type ConfiguredPattern,
} from "../../harness-patterns";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

async function getSchema(): Promise<string> {
  const result = await callTool("get_neo4j_schema", {});
  return result.success ? JSON.stringify(result.data) : "";
}

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Session tracker: update turn count and timestamps in redis
  const sessionTracker = configurePattern<SessionData>(
    "session-tracker",
    async (scope) => {
      const sessionKey = `session:${(scope.data as Record<string, unknown>).sessionId ?? "unknown"}`;
      try {
        await callTool("hset", {
          name: sessionKey,
          key: "lastTurn",
          value: Date.now().toString(),
        });
        const turnCount = ((scope.data as Record<string, unknown>).turnCount as number) ?? 0;
        await callTool("hset", {
          name: sessionKey,
          key: "turnCount",
          value: String(turnCount + 1),
        });
        await callTool("expire", { name: sessionKey, expire_seconds: 7200 }); // 2hr TTL
        scope.data = { ...scope.data, turnCount: turnCount + 1 };
      } catch {
        // Redis may not be available
      }
      return scope;
    },
    { patternId: "session-tracker" },
  );

  // Domain patterns
  const neo4jPattern = simpleLoop<SessionData>(
    createNeo4jController(tools.neo4j ?? []),
    tools.neo4j ?? [],
    { patternId: "neo4j-query", schema, maxTurns: 5 },
  );

  const webPattern = simpleLoop<SessionData>(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "web-search", maxTurns: 4 },
  );

  const routerPattern = router<SessionData>(
    {
      neo4j: "Knowledge base queries and graph operations",
      web_search: "Web lookups and information retrieval",
    },
    {
      neo4j: neo4jPattern,
      web_search: webPattern,
    },
  );

  // Memory writer: capture key facts from responses
  const memoryWriter = simpleLoop<SessionData>(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    { patternId: "memory-write", maxTurns: 3 },
  );

  // Distillation chain for session close
  const readMemory = simpleLoop<SessionData>(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    { patternId: "distill-read", maxTurns: 2 },
  );

  const persistToKB = simpleLoop<SessionData>(
    createNeo4jController(tools.neo4j ?? []),
    tools.neo4j ?? [],
    { patternId: "distill-persist", schema, maxTurns: 5 },
  );

  // Background hook for session close distillation
  const distillationHook = hook<SessionData>(
    configurePattern<SessionData>(
      "distill-chain",
      async (scope, view) => {
        // Read memory
        const readResult = await readMemory.fn(scope, view);
        scope.events.push(...readResult.events);
        scope.data = { ...scope.data, ...readResult.data };

        // Persist to KB
        const persistResult = await persistToKB.fn(scope, view);
        scope.events.push(...persistResult.events);
        scope.data = { ...scope.data, ...persistResult.data };

        return scope;
      },
      { patternId: "distill-chain" },
    ),
    {
      patternId: "session-close-hook",
      trigger: "session_close",
      background: true,
    },
  );

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "memory-synth",
  });

  // Main chain: track → route → memorize → synthesize
  // Distillation hook runs on session close
  return [sessionTracker, routerPattern, memoryWriter, responseSynth, distillationHook];
}

export const conversationalMemoryAgent: AgentConfig = {
  id: "conversational-memory",
  name: "Conversational Memory",
  description: "Memory scratchpad with KB distillation on session close",
  icon: "🧠",
  servers: ["memory", "neo4j-cypher", "web_search", "redis"],
  createPatterns,
};
