/**
 * Agent Loop (12-Factor-Agents Pattern)
 *
 * Inner loop agent logic that:
 * 1. Processes user messages via BAML
 * 2. Determines if graph queries are needed
 * 3. Executes read queries immediately
 * 4. Returns write queries for approval (exits to outer loop)
 *
 * This follows the two-loop pattern from 12-factor-agents:
 * - Inner loop: Agent reasoning and tool execution
 * - Outer loop: Human interaction and approval
 */

// NOTE: NO top-level imports from baml_client for the runtime `b` object!
// BAML has native modules that can only run on the server.
// Dynamic imports must be used inside async functions.
import type { AgentResponse, GraphQuery } from '../../../baml_client'; // types only - OK
import { Thread } from './state';
import { handleReadCypher } from './tools';
import type { ElementDefinition } from 'cytoscape';

// ============================================================================
// Types
// ============================================================================

export interface AgentLoopResult {
  thread: Thread;
  message: string;
  graphData?: ElementDefinition[];
  needsApproval: boolean;
  pendingQuery?: GraphQuery;
}

// ============================================================================
// Agent Loop
// ============================================================================

/**
 * Main agent loop - processes a single turn of conversation
 *
 * @param thread - The conversation thread state
 * @param graphSchema - The Neo4j schema for context
 * @returns Result containing response, graph data, and approval state
 */
export async function agentLoop(
  thread: Thread,
  graphSchema: string
): Promise<AgentLoopResult> {
  // Dynamic import of BAML client - runs only on server
  const { b } = await import('../../../baml_client');

  // Get the last user message
  const userMessage = thread.getLastUserMessage();
  if (!userMessage) {
    return {
      thread,
      message: "I didn't receive a message. How can I help you with the knowledge graph?",
      needsApproval: false
    };
  }

  // Get recent conversation history for context
  const conversationHistory = thread.getRecentHistory(10);

  try {
    // Call BAML to process the message
    const decision: AgentResponse = await b.ProcessUserMessage(
      userMessage,
      conversationHistory,
      graphSchema
    );

    // Record the agent's decision
    thread.addEvent({
      type: 'tool_call',
      data: {
        intent: decision.requires_graph_query ? 'query' : 'respond',
        message: decision.message,
        hasQuery: !!decision.query
      }
    });

    // If no graph query needed, just return the message
    if (!decision.requires_graph_query || !decision.query) {
      thread.addAssistantMessage(decision.message);

      return {
        thread,
        message: decision.message,
        needsApproval: false
      };
    }

    // Handle graph query based on whether it's read-only
    const query = decision.query;

    if (query.read_only) {
      // Execute read query immediately
      return await executeReadQuery(thread, decision.message, query, userMessage);
    } else {
      // Write query needs approval - exit inner loop
      return requestWriteApproval(thread, decision.message, query);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    thread.addError(errorMessage, { phase: 'agent_loop' });

    return {
      thread,
      message: `I encountered an error while processing your request:\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nPlease try rephrasing your question.`,
      needsApproval: false
    };
  }
}

/**
 * Execute a read-only query and interpret the results
 */
async function executeReadQuery(
  thread: Thread,
  agentMessage: string,
  query: GraphQuery,
  userQuestion: string
): Promise<AgentLoopResult> {
  // Dynamic import of BAML client
  const { b } = await import('../../../baml_client');

  try {
    // Execute the read query via UTCP-MCP
    const { graphData, parsed, error } = await handleReadCypher(query.cypher, thread);

    if (error) {
      const errorResponse = `${agentMessage}\n\nUnfortunately, the query failed:\n\`\`\`\n${error}\n\`\`\``;
      thread.addAssistantMessage(errorResponse);

      return {
        thread,
        message: errorResponse,
        needsApproval: false
      };
    }

    // Interpret the results using BAML
    const interpretation = await b.InterpretGraphResults(
      query.cypher,
      JSON.stringify(parsed, null, 2),
      userQuestion
    );

    // Compose final message
    const fullMessage = `${agentMessage}\n\n${interpretation}`;
    thread.addAssistantMessage(fullMessage);

    return {
      thread,
      message: fullMessage,
      graphData,
      needsApproval: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    thread.addError(errorMessage, { phase: 'read_query' });

    const errorResponse = `${agentMessage}\n\nI encountered an error executing the query:\n\`\`\`\n${errorMessage}\n\`\`\``;
    thread.addAssistantMessage(errorResponse);

    return {
      thread,
      message: errorResponse,
      needsApproval: false
    };
  }
}

/**
 * Request approval for a write query - exits inner loop
 */
function requestWriteApproval(
  thread: Thread,
  agentMessage: string,
  query: GraphQuery
): AgentLoopResult {
  // Record approval request
  thread.addApprovalRequest(query.cypher, query.explanation);

  // Don't add assistant message yet - wait for approval flow

  return {
    thread,
    message: agentMessage,
    needsApproval: true,
    pendingQuery: query
  };
}

// ============================================================================
// Approval Handling
// ============================================================================

/**
 * Continue agent loop after write approval
 * Called from outer loop when user approves a write
 */
export async function handleApprovedWrite(
  thread: Thread,
  query: GraphQuery
): Promise<AgentLoopResult> {
  const { handleWriteCypher } = await import('./tools');

  try {
    // Record approval
    thread.addApprovalResponse(true);

    // Execute the write
    const { graphData, error } = await handleWriteCypher(query.cypher, thread);

    if (error) {
      const errorMessage = `The write operation failed:\n\`\`\`\n${error}\n\`\`\``;
      thread.addAssistantMessage(errorMessage);

      return {
        thread,
        message: errorMessage,
        needsApproval: false
      };
    }

    const successMessage = `The changes have been applied successfully.\n\n**Query executed:**\n\`\`\`cypher\n${query.cypher}\n\`\`\`\n\n${query.explanation}`;
    thread.addAssistantMessage(successMessage);

    return {
      thread,
      message: successMessage,
      graphData,
      needsApproval: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    thread.addError(errorMessage, { phase: 'write_execution' });

    return {
      thread,
      message: `Failed to execute write operation:\n\`\`\`\n${errorMessage}\n\`\`\``,
      needsApproval: false
    };
  }
}

/**
 * Handle write rejection
 */
export function handleRejectedWrite(
  thread: Thread,
  reason?: string
): AgentLoopResult {
  thread.addApprovalResponse(false, reason);

  const message = reason
    ? `I understand. The operation was cancelled because: ${reason}\n\nIs there something else I can help you with?`
    : 'I understand. The operation was cancelled.\n\nIs there something else I can help you with?';

  thread.addAssistantMessage(message);

  return {
    thread,
    message,
    needsApproval: false
  };
}
