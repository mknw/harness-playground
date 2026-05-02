/**
 * Default Agent
 *
 * The original router-based agent with Neo4j, Web Search, and Code Mode.
 */
"use server";

import {
  router,
  routes,
  simpleLoop,
  actorCritic,
  synthesizer,
  withReferences,
  Tools,
  callTool,
  createNeo4jController,
  createWebSearchController,
  createActorControllerAdapter,
  createCriticAdapter,
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

  const neo4jController = createNeo4jController(tools.neo4j ?? []);
  const webTools = tools.web ?? [];
  const webController = createWebSearchController(webTools);
  const codeController = createActorControllerAdapter(tools.all);
  const codeCritic = createCriticAdapter();

  const neo4jPattern = simpleLoop<SessionData>(
    neo4jController,
    tools.neo4j ?? [],
    {
      patternId: "neo4j-query",
      schema,
      liveEvents: true,
      rememberPriorTurns: false,
    },
  );

  const webPattern = simpleLoop<SessionData>(webController, webTools, {
    patternId: "web-search",
    liveEvents: true,
    rememberPriorTurns: false,
  });

  const codePattern = actorCritic<SessionData>(
    codeController,
    codeCritic,
    tools.all,
    {
      patternId: "code-mode",
      liveEvents: true,
    },
  );

  const routerPattern = router<SessionData>(
    {
      neo4j: "Database queries and graph operations",
      web_search: "Web lookups and information retrieval",
      code_mode: "Multi-tool script composition",
    },
    { liveEvents: true },
  );

  // Each route is wrapped in `withReferences` so the inner pattern receives
  // an LLM-curated set of relevant prior tool_results from any earlier turn,
  // attached to its `priorResults` channel. See docs/harness-patterns/with-references.md.
  const routesPattern = routes<SessionData>(
    {
      neo4j: withReferences<SessionData>(neo4jPattern, { scope: "global", liveEvents: true }),
      web_search: withReferences<SessionData>(webPattern, { scope: "global", liveEvents: true }),
      code_mode: withReferences<SessionData>(codePattern, { scope: "global", liveEvents: true }),
    },
    { liveEvents: true },
  );

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "response-synth",
    liveEvents: true,
  });

  return [routerPattern, routesPattern, responseSynth];
}

export const defaultAgent: AgentConfig = {
  id: "default",
  name: "Default Agent",
  description: "Router-based agent with Neo4j, Web Search, and Code Mode",
  icon: "🤖",
  servers: ["neo4j-cypher", "web_search", "fetch"],
  createPatterns,
};
