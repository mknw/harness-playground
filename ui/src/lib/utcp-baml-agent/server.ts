/**
 * Agentic Server Functions
 *
 * Server-side functions that expose agentic capabilities via SolidStart's "use server".
 * These are the entry points called from the client-side orchestrator.
 *
 * Architecture:
 * - Uses BAML for LLM reasoning (runs server-side due to native module requirement)
 * - Uses UTCP-MCP for tool execution (via mcp-gateway)
 * - Manages thread state for conversation continuity
 */

"use server";

import { Thread, type SerializedThread } from './state';
import { agentLoop, handleApprovedWrite, handleRejectedWrite } from './agent';
import { getSchema } from '../neo4j/queries';
import type { ElementDefinition } from 'cytoscape';
import type { GraphQuery } from '../../../baml_client';

// ============================================================================
// Types
// ============================================================================

export interface AgentMessageResponse {
  id: string;
  role: 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: {
    tool: string;
    parameters: Record<string, unknown>;
    status: 'pending' | 'approved' | 'rejected' | 'executed';
    explanation?: string;
  }[];
}

export interface ProcessMessageResult {
  response: AgentMessageResponse;
  graphUpdate?: ElementDefinition[];
  threadEvents: SerializedThread;
  needsApproval: boolean;
  pendingQuery?: GraphQuery;
}

export interface WriteExecutionResult {
  success: boolean;
  graphUpdate?: ElementDefinition[];
  threadEvents: SerializedThread;
  error?: string;
}

// ============================================================================
// Main Server Functions
// ============================================================================

/**
 * Process a user message through the agent
 * This is the outer loop entry point
 *
 * @param message - The user's message
 * @param threadEvents - Serialized thread events from previous turns
 * @param graphSchema - Optional cached schema (will fetch if not provided)
 */
export async function processAgentMessage(
  message: string,
  threadEvents: SerializedThread,
  graphSchema?: string
): Promise<ProcessMessageResult> {
  "use server";

  try {
    // Get schema if not provided
    let schema = graphSchema;
    if (!schema) {
      const schemaResult = await getSchema();
      schema = schemaResult.success ? schemaResult.schema : '';
    }

    // Restore thread from serialized events
    const thread = Thread.fromJSON(threadEvents);

    // Add the new user message
    thread.addUserMessage(message);

    // Run the agent loop
    const result = await agentLoop(thread, schema || '');

    // Build the response
    const response: AgentMessageResponse = {
      id: Date.now().toString(),
      role: 'assistant',
      content: result.message,
      timestamp: new Date().toISOString()
    };

    // If needs approval, add pending tool call to response
    if (result.needsApproval && result.pendingQuery) {
      response.toolCalls = [{
        tool: 'write_neo4j_cypher',
        parameters: { query: result.pendingQuery.cypher },
        status: 'pending',
        explanation: result.pendingQuery.explanation
      }];
    }

    return {
      response,
      graphUpdate: result.graphData,
      threadEvents: thread.toJSON(),
      needsApproval: result.needsApproval,
      pendingQuery: result.pendingQuery
    };
  } catch (error) {
    // Return error as assistant message
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      response: {
        id: Date.now().toString(),
        role: 'assistant',
        content: `I encountered an error:\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nPlease try again.`,
        timestamp: new Date().toISOString()
      },
      threadEvents,
      needsApproval: false
    };
  }
}

/**
 * Execute an approved write query
 * Called when user approves a pending write operation
 *
 * @param query - The Cypher query to execute
 * @param explanation - The query explanation
 * @param threadEvents - Serialized thread events
 */
export async function executeApprovedWrite(
  query: string,
  explanation: string,
  threadEvents: SerializedThread
): Promise<WriteExecutionResult> {
  "use server";

  try {
    // Restore thread
    const thread = Thread.fromJSON(threadEvents);

    // Execute the approved write
    const result = await handleApprovedWrite(thread, {
      cypher: query,
      explanation,
      read_only: false
    });

    return {
      success: true,
      graphUpdate: result.graphData,
      threadEvents: thread.toJSON()
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      threadEvents,
      error: errorMessage
    };
  }
}

/**
 * Reject a pending write query
 * Called when user rejects a pending write operation
 *
 * @param reason - Optional reason for rejection
 * @param threadEvents - Serialized thread events
 */
export async function rejectWrite(
  reason: string | undefined,
  threadEvents: SerializedThread
): Promise<{ threadEvents: SerializedThread; message: string }> {
  "use server";

  const thread = Thread.fromJSON(threadEvents);
  const result = handleRejectedWrite(thread, reason);

  return {
    threadEvents: thread.toJSON(),
    message: result.message
  };
}

// ============================================================================
// Utility Server Functions
// ============================================================================

/**
 * Initialize agent - fetches schema and returns initial state
 */
export async function initializeAgent(): Promise<{
  success: boolean;
  graphSchema?: string;
  error?: string;
}> {
  "use server";

  try {
    const schemaResult = await getSchema();

    if (!schemaResult.success) {
      return {
        success: false,
        error: schemaResult.error
      };
    }

    return {
      success: true,
      graphSchema: schemaResult.schema
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Validate a Cypher query before execution
 * Uses BAML to check query safety and intent
 */
export async function validateWriteQuery(
  query: string,
  userIntent: string,
  currentState: string
): Promise<{ valid: boolean; message: string }> {
  "use server";

  try {
    const { b } = await import('../../../baml_client');

    const validation = await b.ValidateWriteOperation(
      query,
      userIntent,
      currentState
    );

    return {
      valid: true,
      message: validation
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Generate a Cypher query from natural language
 * Useful for advanced users who want to preview queries
 */
export async function generateCypherQuery(
  intent: string,
  schema: string
): Promise<{
  success: boolean;
  query?: GraphQuery;
  error?: string;
}> {
  "use server";

  try {
    const { b } = await import('../../../baml_client');

    const query = await b.GenerateCypherQuery(intent, schema);

    return {
      success: true,
      query
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
