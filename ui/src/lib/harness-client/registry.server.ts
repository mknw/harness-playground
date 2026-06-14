/**
 * Agent Registry - Server Only
 *
 * Registry of available agents/harnesses. Each agent defines:
 * - id: unique identifier
 * - name: display name
 * - description: what the agent does
 * - createPatterns: factory function that returns the pattern chain
 */
"use server";

import type { ConfiguredPattern } from "../harness-patterns";
import type { SessionData } from "./session.server";

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  /** Emoji icon for UI display */
  icon: string;
  /** Server namespaces this agent uses */
  servers: string[];
  /** Factory function that creates the pattern chain. Receives the
   *  sessionId so per-conversation context (e.g. code-mode's user-curated
   *  tool allowlist) can be loaded inside the pattern closures. Most
   *  agents accept and ignore the parameter. */
  createPatterns: (sessionId: string) => Promise<ConfiguredPattern<SessionData>[]>;
}

// ============================================================================
// Registry
// ============================================================================

const agentRegistry = new Map<string, AgentConfig>();

/**
 * Register an agent configuration.
 */
export function registerAgent(config: AgentConfig): void {
  agentRegistry.set(config.id, config);
}

/**
 * Get an agent by ID.
 */
export function getAgent(id: string): AgentConfig | undefined {
  return agentRegistry.get(id);
}

/**
 * Get all registered agents.
 */
export function getAllAgents(): AgentConfig[] {
  return Array.from(agentRegistry.values());
}

/**
 * Get agent metadata (safe for client).
 */
export function getAgentMetadata(): Array<{
  id: string;
  name: string;
  description: string;
  icon: string;
  servers: string[];
}> {
  return getAllAgents().map(({ id, name, description, icon, servers }) => ({
    id,
    name,
    description,
    icon,
    servers,
  }));
}

// ============================================================================
// Default Agent Registration
// ============================================================================

// Import and register all example agents
import { defaultAgent } from "./examples/default.server";
import { codeModeAgent } from "./examples/code-mode.server";
import { docAssistantAgent } from "./examples/doc-assistant.server";
import { multiSourceResearchAgent } from "./examples/multi-source-research.server";
import { guardrailedAgent } from "./examples/guardrailed-agent.server";
import { issueTriageAgent } from "./examples/issue-triage.server";
import { kgBuilderAgent } from "./examples/kg-builder.server";
import { llmJudgeAgent } from "./examples/llm-judge.server";
import { conversationalMemoryAgent } from "./examples/conversational-memory.server";
import { ontologyBuilderAgent } from "./examples/ontology-builder.server";
import { semanticCacheAgent } from "./examples/semantic-cache.server";
import { sandboxDemoAgent } from "./examples/sandbox-demo.server";
import { sandboxSessionAgent } from "./examples/sandbox-session.server";

// Register all agents
registerAgent(defaultAgent);
registerAgent(codeModeAgent);
registerAgent(docAssistantAgent);
registerAgent(multiSourceResearchAgent);
registerAgent(guardrailedAgent);
registerAgent(issueTriageAgent);
registerAgent(kgBuilderAgent);
registerAgent(llmJudgeAgent);
registerAgent(conversationalMemoryAgent);
registerAgent(ontologyBuilderAgent);
registerAgent(semanticCacheAgent);
registerAgent(sandboxDemoAgent);
registerAgent(sandboxSessionAgent);
