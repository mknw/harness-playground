/**
 * Issue Triage Agent
 *
 * Pattern: router → (parallel | simpleLoop) → synthesizer
 * Use case: Triage GitHub issues by gathering context from multiple sources.
 */
"use server";

import {
  router,
  simpleLoop,
  parallel,
  synthesizer,
  Tools,
  callTool,
  createGitHubController,
  createWebSearchController,
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

  // Issue context pattern: fetch issue details from GitHub
  const issueContext = simpleLoop<SessionData>(
    createGitHubController(tools.github ?? []),
    tools.github ?? [],
    { patternId: "issue-context", maxTurns: 4 },
  );

  // Research pattern: parallel search for related info
  const webResearch = simpleLoop<SessionData>(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "web-research", maxTurns: 3 },
  );

  const kgLookup = simpleLoop<SessionData>(
    createNeo4jController(tools.neo4j ?? []),
    tools.neo4j ?? [],
    { patternId: "kg-lookup", schema, maxTurns: 3 },
  );

  const research = parallel<SessionData>(
    [webResearch, kgLookup],
    { patternId: "parallel-research" },
  );

  // Router to dispatch based on intent
  const routerPattern = router<SessionData>(
    {
      issue_context: "Fetch issue details and linked PRs from GitHub",
      research: "Search web and knowledge graph for related context",
    },
    {
      issue_context: issueContext,
      research,
    },
  );

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "triage-synth",
  });

  return [routerPattern, responseSynth];
}

export const issueTriageAgent: AgentConfig = {
  id: "issue-triage",
  name: "Issue Triage",
  description: "Triage GitHub issues with context from web and knowledge graph",
  icon: "🎫",
  servers: ["github", "web_search", "neo4j-cypher"],
  createPatterns,
};
