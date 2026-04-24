/**
 * Knowledge Graph Builder Agent
 *
 * Pattern: simpleLoop → simpleLoop → withApproval(simpleLoop) → synthesizer
 * Use case: Research a topic, extract entities, persist to both neo4j and memory.
 */
"use server";

import {
  simpleLoop,
  withApproval,
  synthesizer,
  Tools,
  callTool,
  approvalPredicates,
  createWebSearchController,
  createMemoryController,
  createNeo4jController,
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

  // Stage 1: Research the topic on the web
  const webResearch = simpleLoop<SessionData>(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "web-research", maxTurns: 8 },
  );

  // Stage 2: Extract entities and relations to memory
  const memoryExtract = simpleLoop<SessionData>(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    { patternId: "memory-extract", maxTurns: 6 },
  );

  // Stage 3: Persist to Neo4j with approval
  const neo4jPersist = withApproval<SessionData>(
    simpleLoop<SessionData>(
      createNeo4jController(tools.neo4j ?? []),
      tools.neo4j ?? [],
      { patternId: "neo4j-persist", schema, maxTurns: 10 },
    ),
    approvalPredicates.mutations,
  );

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "kg-build-synth",
  });

  return [webResearch, memoryExtract, neo4jPersist, responseSynth];
}

export const kgBuilderAgent: AgentConfig = {
  id: "kg-builder",
  name: "Knowledge Graph Builder",
  description: "Research topics, extract entities, persist to Neo4j and memory",
  icon: "🕸️",
  servers: ["web_search", "memory", "neo4j-cypher"],
  createPatterns,
};
