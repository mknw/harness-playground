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
  type HarnessResultScoped,
  type ContextEvent,
} from "../harness-patterns";
import {
  getOrCreateSession,
  getSession,
  updateSession,
  deleteSession,
  type SessionData,
} from "./session.server";
import { getAgent, getAgentMetadata } from "./registry.server";
import type { HarnessSettings } from "../settings";
import { runWithSettings } from "../settings-context.server";

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Process a user message using the default agent.
 *
 * @param sessionId - Unique session identifier (from createUniqueId())
 * @param message - User message content
 * @returns HarnessResult with response and status
 */
export async function processMessage(
  sessionId: string,
  message: string,
): Promise<HarnessResultScoped<SessionData>> {
  return processMessageWithAgent(sessionId, message, "default");
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

/**
 * Process a message with streaming events via callback.
 * Used by the SSE endpoint for real-time event delivery.
 *
 * @param sessionId - Session identifier
 * @param message - User message
 * @param agentId - Agent ID
 * @param onEvent - Callback for each committed event
 * @returns HarnessResult after completion
 */
export async function processMessageStreaming(
  sessionId: string,
  message: string,
  agentId: string = "default",
  onEvent: (event: ContextEvent) => void,
  settings?: HarnessSettings,
): Promise<HarnessResultScoped<SessionData>> {
  const session = getOrCreateSession(sessionId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionAny = session as any;
  const currentAgentId = sessionAny.agentId as string | undefined;
  if (currentAgentId !== agentId) {
    session.patterns = [];
    sessionAny.agentId = agentId;
  }

  return runWithSettings(settings, async () => {
    if (session.patterns.length === 0) {
      const agent = getAgent(agentId);
      if (!agent) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
      session.patterns = await agent.createPatterns();
      sessionAny.agentId = agentId;
    }

    let result: HarnessResultScoped<SessionData>;

    if (session.serializedContext) {
      result = await continueSession(
        session.serializedContext,
        session.patterns,
        message,
        onEvent,
      );
    } else {
      const agent = harness(...session.patterns);
      result = await agent(message, sessionId, undefined, onEvent);
    }

    updateSession(sessionId, {
      lastResult: result,
      serializedContext: result.serialized,
    });

    return result;
  });
}
