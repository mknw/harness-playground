/**
 * Agentic Server Functions (Simplified Two-Step Flow)
 *
 * Server-side functions that expose agentic capabilities via SolidStart's "use server".
 *
 * Architecture:
 * - Step 1: DetectIntent (BAML) - lightweight, no schema needed
 * - Step 2: executeGraphQuery - lazy schema fetch + direct neo4j-driver
 * - Uses BAML for LLM reasoning (runs server-side due to native module requirement)
 * - Uses direct neo4j-driver for query execution (no UTCP)
 */

"use server";

import { Thread, type SerializedThread } from './state';
import { getSchema, executeWriteCypher } from '../neo4j/queries';
import { getNeo4jDriver } from '../neo4j/client';
import { transformNeo4jToCytoscape, parseNeo4jResults } from '../graph/transform';
import type { ElementDefinition } from 'cytoscape';
import type { GraphQuery } from '../../../baml_client';
import neo4j from 'neo4j-driver';

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Convert Neo4j types to plain JSON-serializable values
 * Neo4j driver returns Integer, Date, etc. objects that can't be serialized
 */
function toSerializable(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Neo4j Integer
  if (neo4j.isInt(value)) {
    return neo4j.integer.toNumber(value);
  }

  // Handle Neo4j Date/DateTime/Time
  if (neo4j.isDate(value) || neo4j.isDateTime(value) || neo4j.isTime(value)) {
    return value.toString();
  }

  // Handle Neo4j Duration
  if (neo4j.isDuration(value)) {
    return value.toString();
  }

  // Handle Neo4j Point
  if (neo4j.isPoint(value)) {
    return { x: value.x, y: value.y, z: value.z, srid: value.srid };
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(toSerializable);
  }

  // Handle objects (including Neo4j Node, Relationship, Path)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = toSerializable(val);
    }
    return result;
  }

  return value;
}

// ============================================================================
// Types
// ============================================================================

export interface ToolCallInfo {
  id: string;
  tool: 'read_neo4j_cypher' | 'write_neo4j_cypher' | 'get_schema';
  cypher?: string;
  status: 'pending' | 'executed' | 'error';
  result?: {
    nodeCount: number;
    relationshipCount: number;
    raw?: unknown;
  };
  error?: string;
  timestamp: string;
}

export interface AgentMessageResponse {
  id: string;
  role: 'assistant';
  content: string;
  timestamp: string;
}

export interface ProcessMessageResult {
  response: AgentMessageResponse;
  toolCall?: ToolCallInfo;
  graphUpdate?: ElementDefinition[];
  threadEvents: SerializedThread;
  needsApproval: boolean;
  pendingCypher?: string;
  pendingExplanation?: string;
}

export interface WriteExecutionResult {
  success: boolean;
  toolCall?: ToolCallInfo;
  graphUpdate?: ElementDefinition[];
  threadEvents: SerializedThread;
  error?: string;
}

// ============================================================================
// Main Entry Point: Two-Step Processing
// ============================================================================

/**
 * Process a user message through the agent (two-step flow)
 *
 * Step 1: DetectIntent - determines if graph query is needed (no schema)
 * Step 2: executeGraphQuery - lazy schema fetch + query execution
 *
 * @param message - The user's message
 * @param threadEvents - Serialized thread events from previous turns
 */
export async function processAgentMessage(
  message: string,
  threadEvents: SerializedThread
): Promise<ProcessMessageResult> {
  "use server";

  // Restore thread from serialized events
  const thread = Thread.fromJSON(threadEvents);
  thread.addUserMessage(message);

  try {
    // Dynamic import of BAML client (inside try-catch to handle import errors)
    const { b } = await import('../../../baml_client');
    // ========================================
    // STEP 1: Intent Detection (no schema)
    // ========================================
    const intent = await b.DetectIntent(
      message,
      thread.getRecentHistory(10)
    );

    // If no graph query needed, return directly
    if (!intent.requires_graph_query) {
      thread.addAssistantMessage(intent.message);

      return {
        response: {
          id: Date.now().toString(),
          role: 'assistant',
          content: intent.message,
          timestamp: new Date().toISOString()
        },
        threadEvents: thread.toJSON(),
        needsApproval: false
      };
    }

    // ========================================
    // STEP 2: Graph Query Execution
    // ========================================
    return await executeGraphQuery(
      thread,
      message,
      intent.query_intent || message,
      intent.message
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    thread.addError(errorMessage, { phase: 'process_message' });

    return {
      response: {
        id: Date.now().toString(),
        role: 'assistant',
        content: `I encountered an error:\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nPlease try again.`,
        timestamp: new Date().toISOString()
      },
      threadEvents: thread.toJSON(),
      needsApproval: false
    };
  }
}

// ============================================================================
// Step 2: Graph Query Execution (Direct neo4j-driver)
// ============================================================================

/**
 * Execute a graph query with lazy schema fetching
 *
 * @param thread - Thread state
 * @param userMessage - Original user message
 * @param queryIntent - Natural language description of the query
 * @param prefixMessage - Initial response message from intent detection
 */
async function executeGraphQuery(
  thread: Thread,
  userMessage: string,
  queryIntent: string,
  prefixMessage: string
): Promise<ProcessMessageResult> {
  const { b } = await import('../../../baml_client');
  const toolCallId = Date.now().toString();

  // 1. Lazy schema fetch (only happens when query is needed)
  const schemaResult = await getSchema();
  if (!schemaResult.success) {
    throw new Error(`Failed to fetch schema: ${schemaResult.error}`);
  }

  // 2. Generate Cypher query using BAML
  const query: GraphQuery = await b.GenerateCypherQuery(
    queryIntent,
    schemaResult.schema || ''
  );

  // Record tool call in thread
  thread.addToolCall(
    query.read_only ? 'read_neo4j_cypher' : 'write_neo4j_cypher',
    { query: query.cypher },
    query.read_only ? 'read' : 'write'
  );

  // 3. Handle write queries (need approval)
  if (!query.read_only) {
    thread.addApprovalRequest(query.cypher, query.explanation);

    return {
      response: {
        id: Date.now().toString(),
        role: 'assistant',
        content: `${prefixMessage}\n\nI've prepared a query that will modify the database. Please review and approve it.`,
        timestamp: new Date().toISOString()
      },
      toolCall: {
        id: toolCallId,
        tool: 'write_neo4j_cypher',
        cypher: query.cypher,
        status: 'pending',
        timestamp: new Date().toISOString()
      },
      threadEvents: thread.toJSON(),
      needsApproval: true,
      pendingCypher: query.cypher,
      pendingExplanation: query.explanation
    };
  }

  // 4. Execute read query directly via neo4j-driver
  const session = getNeo4jDriver().session();
  try {
    const result = await session.run(query.cypher);

    // Convert Neo4j types to serializable JSON
    const rawResults = toSerializable(result.records.map(r => r.toObject())) as unknown[];

    // Parse and transform results (also needs serialization)
    const parsed = parseNeo4jResults({ records: result.records });

    console.log('[server] Parsed nodes:', parsed.nodes?.length || 0);
    console.log('[server] Parsed rels:', parsed.relationships?.length || 0);
    if (parsed.nodes?.length) {
      console.log('[server] First node:', JSON.stringify(parsed.nodes[0], null, 2));
    }

    const graphData = toSerializable(transformNeo4jToCytoscape(
      parsed.nodes || [],
      parsed.relationships || []
    )) as ElementDefinition[];

    console.log('[server] GraphData elements:', graphData.length);

    // Record tool response
    thread.addToolResponse('read_neo4j_cypher', {
      nodeCount: parsed.nodes?.length || 0,
      relationshipCount: parsed.relationships?.length || 0
    });

    // 5. Interpret results using BAML
    const interpretation = await b.InterpretGraphResults(
      query.cypher,
      JSON.stringify(rawResults, null, 2),
      userMessage
    );

    const fullMessage = `${prefixMessage}\n\n${interpretation}`;
    thread.addAssistantMessage(fullMessage);

    return {
      response: {
        id: Date.now().toString(),
        role: 'assistant',
        content: fullMessage,
        timestamp: new Date().toISOString()
      },
      toolCall: {
        id: toolCallId,
        tool: 'read_neo4j_cypher',
        cypher: query.cypher,
        status: 'executed',
        result: {
          nodeCount: parsed.nodes?.length || 0,
          relationshipCount: parsed.relationships?.length || 0,
          raw: rawResults
        },
        timestamp: new Date().toISOString()
      },
      graphUpdate: graphData,
      threadEvents: thread.toJSON(),
      needsApproval: false
    };
  } finally {
    await session.close();
  }
}

// ============================================================================
// Write Approval Handling
// ============================================================================

/**
 * Execute an approved write query
 * Called when user approves a pending write operation
 *
 * @param cypher - The Cypher query to execute
 * @param explanation - The query explanation
 * @param threadEvents - Serialized thread events
 */
export async function executeApprovedWrite(
  cypher: string,
  explanation: string,
  threadEvents: SerializedThread
): Promise<WriteExecutionResult> {
  "use server";

  const thread = Thread.fromJSON(threadEvents);
  const toolCallId = Date.now().toString();

  try {
    // Record approval
    thread.addApprovalResponse(true);

    // Execute via direct neo4j-driver
    const result = await executeWriteCypher(cypher);

    if (!result.success) {
      thread.addError(result.error || 'Write query failed', { tool: 'write_neo4j_cypher' });

      return {
        success: false,
        toolCall: {
          id: toolCallId,
          tool: 'write_neo4j_cypher',
          cypher,
          status: 'error',
          error: result.error,
          timestamp: new Date().toISOString()
        },
        threadEvents: thread.toJSON(),
        error: result.error
      };
    }

    thread.addToolResponse('write_neo4j_cypher', {
      success: true
    });

    const successMessage = `Changes applied successfully.\n\n**Query executed:**\n\`\`\`cypher\n${cypher}\n\`\`\`\n\n${explanation}`;
    thread.addAssistantMessage(successMessage);

    return {
      success: true,
      toolCall: {
        id: toolCallId,
        tool: 'write_neo4j_cypher',
        cypher,
        status: 'executed',
        result: {
          nodeCount: 0, // Write queries don't always return counts
          relationshipCount: 0,
          raw: result.raw
        },
        timestamp: new Date().toISOString()
      },
      graphUpdate: result.graphUpdate,
      threadEvents: thread.toJSON()
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    thread.addError(errorMessage, { phase: 'write_execution' });

    return {
      success: false,
      threadEvents: thread.toJSON(),
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
  thread.addApprovalResponse(false, reason);

  const message = reason
    ? `Operation cancelled: ${reason}\n\nIs there something else I can help you with?`
    : 'Operation cancelled.\n\nIs there something else I can help you with?';

  thread.addAssistantMessage(message);

  return {
    threadEvents: thread.toJSON(),
    message
  };
}

// ============================================================================
// Re-export types for client use
// ============================================================================

export type { SerializedThread } from './state';
