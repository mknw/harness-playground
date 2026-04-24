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

  const neo4jPattern = simpleLoop<SessionData>(neo4jController, tools.neo4j ?? [], {
    patternId: "neo4j-query",
    schema,
  });

  const webPattern = simpleLoop<SessionData>(webController, webTools, {
    patternId: "web-search",
  });

  const codePattern = actorCritic<SessionData>(
    codeController,
    codeCritic,
    tools.all,
    {
      patternId: "code-mode",
    },
  );

  const routerPattern = router<SessionData>({
    neo4j: "Database queries and graph operations",
    web_search: "Web lookups and information retrieval",
    code_mode: "Multi-tool script composition",
  });

  const routesPattern = routes<SessionData>({
    neo4j: neo4jPattern,
    web_search: webPattern,
    code_mode: codePattern,
  });

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "response-synth",
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
