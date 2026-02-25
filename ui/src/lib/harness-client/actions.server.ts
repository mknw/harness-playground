/**
 * Server Actions for Frontend
 *
 * Top-level "use server" module for SolidStart server actions.
 * Wraps harness-patterns for use in Solid components.
 */
"use server";

import {
  harness,
  resumeHarness,
  continueSession,
  router,
  routes,
  simpleLoop,
  actorCritic,
  synthesizer,
  withApproval,
  approvalPredicates,
  Tools,
  callTool,
  createNeo4jController,
  createWebSearchController,
  createActorControllerAdapter,
  createCriticAdapter,
  type HarnessResultScoped,
  type ConfiguredPattern,
} from "../harness-patterns";
import {
  getOrCreateSession,
  getSession,
  updateSession,
  deleteSession,
  type SessionData,
} from "./session.server";
import { getAgent, getAgentMetadata } from "./registry.server";

// ============================================================================
// Agent Configuration
// ============================================================================

async function getSchema(): Promise<string> {
  const result = await callTool("get_neo4j_schema", {});
  return result.success ? JSON.stringify(result.data) : "";
}

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Create controller adapters using the new BAML functions
  const neo4jController = createNeo4jController(tools.neo4j ?? []);
  const webController = createWebSearchController(tools.web ?? []);
  const codeController = createActorControllerAdapter(tools.all);
  const codeCritic = createCriticAdapter();

  const neo4jPattern = withApproval(
    simpleLoop<SessionData>(neo4jController, tools.neo4j ?? [], {
      patternId: "neo4j-query",
      schema,
    }),
    approvalPredicates.mutations,
  );

  const webPattern = simpleLoop<SessionData>(webController, tools.web ?? [], {
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

  const routeDescriptions = {
    neo4j: "Database queries and graph operations",
    web_search: "Web lookups and information retrieval",
    code_mode: "Multi-tool script composition",
  };

  const routePatterns = {
    neo4j: neo4jPattern,
    web_search: webPattern,
    code_mode: codePattern,
  };

  // Synthesizer generates human-readable response from tool results
  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "response-synth",
  });

  return [
    router<SessionData>(routeDescriptions),
    routes<SessionData>(routePatterns),
    responseSynth,
  ];
}

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Process a user message.
 *
 * @param sessionId - Unique session identifier (from createUniqueId())
 * @param message - User message content
 * @returns HarnessResult with response and status
 */
export async function processMessage(
  sessionId: string,
  message: string,
): Promise<HarnessResultScoped<SessionData>> {
  const session = getOrCreateSession(sessionId);

  // Lazy init patterns
  if (session.patterns.length === 0) {
    session.patterns = await createPatterns();
  }

  let result: HarnessResultScoped<SessionData>;

  // Continue existing session or start new one
  if (session.serializedContext) {
    result = await continueSession(
      session.serializedContext,
      session.patterns,
      message,
    );
  } else {
    const agent = harness(...session.patterns);
    result = await agent(message, sessionId);
  }

  updateSession(sessionId, {
    lastResult: result,
    serializedContext: result.serialized,
  });

  return result;
}

/**
 * Approve a pending action.
 *
 * @param sessionId - Session identifier
 * @returns HarnessResult after approval
 */
export async function approveAction(
  sessionId: string,
): Promise<HarnessResultScoped<SessionData>> {
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("No active session");
  }

  if (!session.serializedContext || session.lastResult?.status !== "paused") {
    throw new Error("No pending operation to approve");
  }

  const result = await resumeHarness(
    session.serializedContext,
    session.patterns,
    true,
  );

  updateSession(sessionId, {
    lastResult: result,
    serializedContext: result.serialized,
  });

  return result;
}

/**
 * Reject a pending action.
 *
 * @param sessionId - Session identifier
 * @param _reason - Optional rejection reason (unused for now)
 * @returns HarnessResult after rejection
 */
export async function rejectAction(
  sessionId: string,
  _reason?: string,
): Promise<HarnessResultScoped<SessionData>> {
  const session = getSession(sessionId);

  if (!session) {
    throw new Error("No active session");
  }

  if (!session.serializedContext || session.lastResult?.status !== "paused") {
    throw new Error("No pending operation to reject");
  }

  const result = await resumeHarness(
    session.serializedContext,
    session.patterns,
    false,
  );

  updateSession(sessionId, {
    lastResult: result,
    serializedContext: result.serialized,
  });

  return result;
}

/**
 * Clear a session.
 *
 * @param sessionId - Session identifier
 */
export function clearSession(sessionId: string): void {
  deleteSession(sessionId);
}

/**
 * Process a user message using a specific agent.
 *
 * @param sessionId - Unique session identifier
 * @param message - User message content
 * @param agentId - Agent ID to use (defaults to "default")
 * @returns HarnessResult with response and status
 */
export async function processMessageWithAgent(
  sessionId: string,
  message: string,
  agentId: string = "default",
): Promise<HarnessResultScoped<SessionData>> {
  const session = getOrCreateSession(sessionId);

  // Check if agent changed - reset patterns if so
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionAny = session as any;
  const currentAgentId = sessionAny.agentId as string | undefined;
  if (currentAgentId !== agentId) {
    session.patterns = [];
    sessionAny.agentId = agentId;
  }

  // Lazy init patterns from agent registry
  if (session.patterns.length === 0) {
    const agent = getAgent(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    session.patterns = await agent.createPatterns();
    sessionAny.agentId = agentId;
  }

  let result: HarnessResultScoped<SessionData>;

  // Continue existing session or start new one
  if (session.serializedContext) {
    result = await continueSession(
      session.serializedContext,
      session.patterns,
      message,
    );
  } else {
    const agent = harness(...session.patterns);
    result = await agent(message, sessionId);
  }

  updateSession(sessionId, {
    lastResult: result,
    serializedContext: result.serialized,
  });

  return result;
}

/**
 * Get list of available agents (metadata only).
 * This is a server action that safely wraps the registry.
 *
 * @returns Array of agent metadata
 */
export async function getAgentList(): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    servers: string[];
  }>
> {
  return getAgentMetadata();
}
