/**
 * Agentic Server Functions (Event-Driven Streaming Architecture)
 *
 * Server-side functions that expose agentic capabilities via SolidStart's "use server".
 *
 * Architecture:
 * - Step 1: RouteUserMessage (BAML) - determine intent and routing
 * - Step 2: Multi-turn tool loop with namespace-specific planning
 * - Step 3: CreateToolResponse (BAML) - synthesize results
 *
 * Streaming via Promise arrays for real-time UI updates.
 */

"use server";

import {
  Thread,
  type SerializedThread,
  type ToolMode,
  type ToolNamespace,
  type ApprovalState,
  type RoutingInterfaceEvent,
  type ToolExecutionPlan,
  type ToolEvent,
  type StreamEvent,
  MAX_TOOL_TURNS,
  estimateTokens,
  prepareResultsForContext,
  requiresApproval,
  createApprovalState
} from './state';
import { getSchema, executeWriteCypher } from '../neo4j/queries';
import { getNeo4jDriver } from '../neo4j/client';
import { transformNeo4jToCytoscape, parseNeo4jResults } from '../graph/transform';
import type { ElementDefinition } from 'cytoscape';
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

export interface ProcessMessageResult {
  events: StreamEvent[];
  threadEvents: SerializedThread;
  graphUpdate?: ElementDefinition[];
  needsApproval?: boolean;
  pendingPlan?: ToolExecutionPlan;
}

export interface WriteExecutionResult {
  success: boolean;
  toolEvent?: ToolEvent;
  graphUpdate?: ElementDefinition[];
  threadEvents: SerializedThread;
  error?: string;
  toolCall?: ToolCallInfo;
}

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * Tool call information for UI display
 * Used by ToolCallDisplay component
 */
export interface ToolCallInfo {
  // UI display type
  type: 'neo4j_query' | 'neo4j_write' | 'web_search' | 'fetch' | 'code_mode';
  // Execution status for visual indicators
  status: 'pending' | 'executed' | 'error';
  // Tool identifier (for display label)
  tool: string;
  // The cypher query or operation payload
  cypher?: string;
  // Query explanation
  explanation?: string;
  // Whether this is a read-only operation
  isReadOnly?: boolean;
  // Execution result with stats
  result?: {
    nodeCount?: number;
    relationshipCount?: number;
    raw?: unknown;
  };
  // Error message if failed
  error?: string;
}

/**
 * @deprecated Use ProcessMessageResult instead
 */
export interface AgentMessageResponse {
  response: { id: string; role: 'assistant'; content: string; timestamp: string };
  threadEvents: SerializedThread;
  graphUpdate?: ElementDefinition[];
  needsApproval: boolean;
  pendingCypher?: string;
  pendingExplanation?: string;
  toolCall?: ToolCallInfo;
}

// ============================================================================
// MCP Gateway Client
// ============================================================================

const MCP_GATEWAY_URL = 'http://localhost:8811/mcp';

/**
 * Parse SSE (Server-Sent Events) response from MCP Gateway
 * SSE format: "event: message\ndata: {json}\n\n"
 */
function parseSSEResponse(text: string): unknown {
  const lines = text.split('\n');
  let lastData: string | null = null;

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      lastData = line.slice(6); // Remove "data: " prefix
    }
  }

  if (!lastData) {
    throw new Error('No data found in SSE response');
  }

  return JSON.parse(lastData);
}

/**
 * Call an MCP tool through the gateway
 * Handles SSE (streaming) response format from --transport=streaming
 */
async function callMcpGateway(
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(MCP_GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: tool, arguments: args }
    })
  });

  if (!response.ok) {
    throw new Error(`Gateway error: ${response.status} ${response.statusText}`);
  }

  // MCP Gateway with --transport=streaming returns SSE format
  const contentType = response.headers.get('content-type') || '';
  let result: { error?: { message?: string }; result?: unknown };

  if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
    // Parse SSE response
    const text = await response.text();
    result = parseSSEResponse(text) as typeof result;
  } else {
    // Fallback to JSON for non-streaming responses
    result = await response.json();
  }

  if (result.error) {
    throw new Error(result.error.message || 'Gateway tool call failed');
  }

  return result.result;
}

// ============================================================================
// Main Entry Point: Streaming Message Processing
// ============================================================================

/**
 * Process a user message with streaming events
 *
 * @param message - The user's message
 * @param threadEvents - Serialized thread events from previous turns
 * @param approvalState - Current approval state for the session
 */
export async function processAgentMessageStreaming(
  message: string,
  threadEvents: SerializedThread,
  approvalState?: ApprovalState
): Promise<ProcessMessageResult> {
  "use server";

  const thread = Thread.fromJSON(threadEvents);
  thread.addUserMessage(message);

  const events: StreamEvent[] = [];
  const state = approvalState || createApprovalState();

  try {
    const { b } = await import('../../../baml_client');

    // ========================================
    // STEP 1: Route Message
    // ========================================
    const routing = await b.RouteUserMessage(
      message,
      thread.getRecentHistory(10)
    );

    // Add routing event
    events.push({
      type: 'routing',
      data: routing as unknown as RoutingInterfaceEvent,
      timestamp: new Date().toISOString()
    });

    // If no tool needed, return conversational response
    if (!routing.tool_call_needed) {
      thread.addAssistantMessage(routing.response_text);

      events.push({
        type: 'complete',
        data: routing.response_text,
        timestamp: new Date().toISOString()
      });

      return {
        events,
        threadEvents: thread.toJSON()
      };
    }

    // ========================================
    // STEP 2: Multi-Turn Tool Execution
    // ========================================
    const { toolEvents, finalResponse, graphUpdate, needsApproval, pendingPlan } =
      await executeToolLoop(
        routing as unknown as RoutingInterfaceEvent,
        message,
        thread,
        state
      );

    // Add tool events to stream
    for (const te of toolEvents) {
      events.push({
        type: 'executing',
        data: te,
        timestamp: new Date().toISOString()
      });
    }

    // If approval needed, return with pending state
    if (needsApproval && pendingPlan) {
      return {
        events,
        threadEvents: thread.toJSON(),
        graphUpdate,
        needsApproval: true,
        pendingPlan
      };
    }

    // ========================================
    // STEP 3: Generate Final Response
    // ========================================
    const finalContent = await b.CreateToolResponse(
      JSON.stringify(toolEvents),
      message,
      routing.intent
    );

    const fullMessage = `${routing.response_text}\n\n${finalContent}`;
    thread.addAssistantMessage(fullMessage);

    events.push({
      type: 'complete',
      data: fullMessage,
      timestamp: new Date().toISOString()
    });

    return {
      events,
      threadEvents: thread.toJSON(),
      graphUpdate
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    thread.addError(errorMessage, { phase: 'process_message' });

    events.push({
      type: 'error',
      data: errorMessage,
      timestamp: new Date().toISOString()
    });

    return {
      events,
      threadEvents: thread.toJSON()
    };
  }
}

// ============================================================================
// Multi-Turn Tool Execution Loop
// ============================================================================

interface ToolLoopResult {
  toolEvents: ToolEvent[];
  finalResponse?: string;
  graphUpdate?: ElementDefinition[];
  needsApproval?: boolean;
  pendingPlan?: ToolExecutionPlan;
}

/**
 * Execute tools in a loop until done or max turns reached
 */
async function executeToolLoop(
  routing: RoutingInterfaceEvent,
  message: string,
  thread: Thread,
  approvalState: ApprovalState
): Promise<ToolLoopResult> {
  const { b } = await import('../../../baml_client');
  const toolEvents: ToolEvent[] = [];
  let graphUpdate: ElementDefinition[] | undefined;
  let n_turn = 0;
  let endTool = false;

  while (!endTool && n_turn < MAX_TOOL_TURNS) {
    n_turn++;

    // Prepare context from previous results
    const previousResults = prepareResultsForContext(toolEvents);

    // Plan next action based on tool namespace
    const plan = await planToolExecution(
      routing,
      message,
      previousResults,
      n_turn
    );

    // Check if approval needed for writes
    if (requiresApproval(plan, approvalState)) {
      thread.addApprovalRequest(plan.payload, plan.reasoning);

      return {
        toolEvents,
        graphUpdate,
        needsApproval: true,
        pendingPlan: plan
      };
    }

    // Execute the tool
    const toolEvent = await executeToolPlan(plan, routing.tool_mode, n_turn);
    toolEvents.push(toolEvent);

    // Record in thread
    thread.addToolCall(plan.toolName, JSON.parse(plan.payload), routing.intent);
    thread.addToolResponse(plan.toolName, toolEvent);

    // Extract graph data if neo4j query
    if (plan.toolName.includes('neo4j') && toolEvent.status_code === 200) {
      const parsed = parseNeo4jResults({ records: toolEvent.data as any[] || [] });
      const newGraphData = toSerializable(transformNeo4jToCytoscape(
        parsed.nodes || [],
        parsed.relationships || []
      )) as ElementDefinition[];

      graphUpdate = [...(graphUpdate || []), ...newGraphData];
    }

    // Check if done
    endTool = plan.end_tool || n_turn >= MAX_TOOL_TURNS;
  }

  return { toolEvents, graphUpdate };
}

// ============================================================================
// Tool Planning (Namespace-Specific)
// ============================================================================

/**
 * Plan tool execution based on namespace
 */
async function planToolExecution(
  routing: RoutingInterfaceEvent,
  message: string,
  previousResults: string,
  n_turn: number
): Promise<ToolExecutionPlan> {
  const { b } = await import('../../../baml_client');

  switch (routing.tool_name) {
    case 'neo4j': {
      // Get schema for neo4j operations
      const schemaResult = await getSchema();
      const schema = schemaResult.success ? schemaResult.schema || '' : '';

      return await b.PlanNeo4jOperation(
        message,
        routing.intent,
        schema,
        previousResults,
        n_turn
      );
    }

    case 'web_search':
      return await b.PlanWebSearch(
        message,
        routing.intent,
        previousResults,
        n_turn
      );

    case 'code_mode': {
      // Get available tools for code_mode
      const availableTools = [
        'read_neo4j_cypher',
        'write_neo4j_cypher',
        'get_neo4j_schema',
        'web_search',
        'fetch'
      ];

      return await b.PlanCodeModeOperation(
        message,
        routing.intent,
        availableTools,
        previousResults,
        n_turn
      );
    }

    default:
      throw new Error(`Unknown tool namespace: ${routing.tool_name}`);
  }
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Execute a tool plan and return ToolEvent
 */
async function executeToolPlan(
  plan: ToolExecutionPlan,
  toolMode: ToolMode,
  n_turn: number
): Promise<ToolEvent> {
  const startTime = Date.now();

  try {
    let result: unknown;
    const args = JSON.parse(plan.payload);

    if (toolMode === 'CodeMode') {
      // Use MCP gateway code_mode
      result = await callMcpGateway('run_tools_with_javascript', args);
    } else if (plan.toolName.includes('neo4j')) {
      // Execute neo4j queries directly for better performance
      result = await executeNeo4jTool(plan.toolName, args);
    } else {
      // Use MCP gateway for other tools
      result = await callMcpGateway(plan.toolName, args);
    }

    const resultStr = JSON.stringify(result);
    const stats = extractStats(result, plan.toolName);

    return {
      status_code: 200,
      status_description: 'Success',
      operation: plan.payload,
      data: toSerializable(result),
      n_turn,
      stats: {
        ...stats,
        duration_ms: Date.now() - startTime,
        token_count: estimateTokens(resultStr)
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      status_code: 500,
      status_description: errorMessage,
      operation: plan.payload,
      data: null,
      n_turn,
      stats: {
        duration_ms: Date.now() - startTime
      }
    };
  }
}

/**
 * Execute Neo4j tools directly via neo4j-driver
 */
async function executeNeo4jTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const session = getNeo4jDriver().session();

  try {
    if (toolName === 'get_neo4j_schema') {
      const schemaResult = await getSchema();
      return schemaResult.schema;
    }

    const query = args.query as string;
    if (!query) {
      throw new Error('Query is required');
    }

    if (toolName === 'write_neo4j_cypher') {
      const result = await executeWriteCypher(query);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.raw;
    }

    // read_neo4j_cypher
    const result = await session.run(query);
    return result.records.map(r => toSerializable(r.toObject()));
  } finally {
    await session.close();
  }
}

/**
 * Extract statistics from tool result
 */
function extractStats(
  result: unknown,
  toolName: string
): { nodeCount?: number; relationshipCount?: number } {
  if (!result || !toolName.includes('neo4j')) {
    return {};
  }

  if (Array.isArray(result)) {
    // Count nodes and relationships in result
    let nodeCount = 0;
    let relationshipCount = 0;

    for (const record of result) {
      if (record && typeof record === 'object') {
        for (const value of Object.values(record)) {
          if (value && typeof value === 'object') {
            const v = value as Record<string, unknown>;
            if ('labels' in v) nodeCount++;
            if ('type' in v && 'start' in v) relationshipCount++;
          }
        }
      }
    }

    return { nodeCount, relationshipCount };
  }

  return {};
}

// ============================================================================
// Write Approval Handling
// ============================================================================

/**
 * Convert ToolExecutionPlan to ToolCallInfo for UI display
 */
function planToToolCallInfo(
  plan: ToolExecutionPlan | undefined,
  status: 'pending' | 'executed' | 'error' = 'pending',
  result?: unknown,
  error?: string
): ToolCallInfo | undefined {
  if (!plan) return undefined;

  const toolType = plan.toolName.includes('write') ? 'neo4j_write' :
    plan.toolName.includes('neo4j') ? 'neo4j_query' :
    plan.toolName.includes('web_search') ? 'web_search' :
    plan.toolName.includes('fetch') ? 'fetch' : 'code_mode';

  // Extract cypher from payload if neo4j
  let cypher: string | undefined;
  try {
    const payload = JSON.parse(plan.payload);
    cypher = payload.query;
  } catch {
    cypher = plan.payload;
  }

  // Build result with stats if executed
  let resultObj: ToolCallInfo['result'];
  if (status === 'executed' && result) {
    const stats = extractStats(result, plan.toolName);
    resultObj = {
      nodeCount: stats.nodeCount,
      relationshipCount: stats.relationshipCount,
      raw: result
    };
  }

  return {
    type: toolType,
    status,
    tool: plan.toolName,
    cypher,
    explanation: plan.reasoning,
    isReadOnly: !plan.toolName.includes('write'),
    result: resultObj,
    error
  };
}

/**
 * Execute an approved write operation (new signature with ToolExecutionPlan)
 */
async function executeApprovedWriteWithPlan(
  plan: ToolExecutionPlan,
  threadEvents: SerializedThread
): Promise<WriteExecutionResult> {
  const thread = Thread.fromJSON(threadEvents);

  try {
    thread.addApprovalResponse(true);

    const toolEvent = await executeToolPlan(plan, 'Mcp', 1);

    if (toolEvent.status_code !== 200) {
      thread.addError(toolEvent.status_description, { tool: plan.toolName });

      return {
        success: false,
        toolEvent,
        threadEvents: thread.toJSON(),
        error: toolEvent.status_description
      };
    }

    thread.addToolResponse(plan.toolName, toolEvent);

    // Get graph update if neo4j
    let graphUpdate: ElementDefinition[] | undefined;
    if (plan.toolName.includes('neo4j')) {
      const parsed = parseNeo4jResults({ records: toolEvent.data as any[] || [] });
      graphUpdate = toSerializable(transformNeo4jToCytoscape(
        parsed.nodes || [],
        parsed.relationships || []
      )) as ElementDefinition[];
    }

    // Build toolCall for legacy compatibility
    const toolCall = planToToolCallInfo(plan, 'executed', toolEvent.data);

    return {
      success: true,
      toolEvent,
      graphUpdate,
      threadEvents: thread.toJSON(),
      toolCall
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
 * Execute an approved write operation
 * Supports both new (ToolExecutionPlan) and legacy (cypher, explanation) signatures
 */
export async function executeApprovedWrite(
  planOrCypher: ToolExecutionPlan | string,
  explanationOrThreadEvents: string | SerializedThread,
  maybeThreadEvents?: SerializedThread
): Promise<WriteExecutionResult> {
  "use server";

  // Handle legacy 3-argument signature
  if (typeof planOrCypher === 'string') {
    const cypher = planOrCypher;
    const explanation = explanationOrThreadEvents as string;
    const threadEvents = maybeThreadEvents!;

    // Convert to ToolExecutionPlan
    const plan: ToolExecutionPlan = {
      reasoning: explanation,
      toolName: 'write_neo4j_cypher',
      payload: JSON.stringify({ query: cypher }),
      description: 'Executing approved write operation',
      end_tool: true
    };

    return executeApprovedWriteWithPlan(plan, threadEvents);
  }

  // New 2-argument signature
  return executeApprovedWriteWithPlan(planOrCypher, explanationOrThreadEvents as SerializedThread);
}

/**
 * Reject a pending write operation
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
// Legacy Compatibility - Keep old function name
// ============================================================================

/**
 * @deprecated Use processAgentMessageStreaming instead
 */
export async function processAgentMessage(
  message: string,
  threadEvents: SerializedThread
): Promise<AgentMessageResponse> {
  const result = await processAgentMessageStreaming(message, threadEvents);

  // Extract final message from events
  const completeEvent = result.events.find(e => e.type === 'complete');
  const errorEvent = result.events.find(e => e.type === 'error');
  const routingEvent = result.events.find(e => e.type === 'routing');
  const executingEvents = result.events.filter(e => e.type === 'executing');

  let content = '';
  if (completeEvent) {
    content = completeEvent.data as string;
  } else if (errorEvent) {
    content = `Error: ${errorEvent.data}`;
  } else if (routingEvent) {
    content = (routingEvent.data as RoutingInterfaceEvent).response_text;
  }

  // Build toolCall from the last executing event or pending plan
  let toolCall: ToolCallInfo | undefined;
  if (executingEvents.length > 0) {
    const lastEvent = executingEvents[executingEvents.length - 1].data as ToolEvent;
    const isError = lastEvent.status_code !== 200;
    const toolType = lastEvent.operation.includes('write') ? 'neo4j_write' : 'neo4j_query';

    // Extract cypher from operation
    let cypher: string | undefined;
    try {
      const payload = JSON.parse(lastEvent.operation);
      cypher = payload.query;
    } catch {
      cypher = lastEvent.operation;
    }

    toolCall = {
      type: toolType,
      status: isError ? 'error' : 'executed',
      tool: toolType === 'neo4j_write' ? 'write_neo4j_cypher' : 'read_neo4j_cypher',
      cypher,
      result: isError ? undefined : {
        nodeCount: lastEvent.stats?.nodeCount,
        relationshipCount: lastEvent.stats?.relationshipCount,
        raw: lastEvent.data
      },
      error: isError ? lastEvent.status_description : undefined
    };
  } else if (result.pendingPlan) {
    toolCall = planToToolCallInfo(result.pendingPlan, 'pending');
  }

  return {
    response: {
      id: Date.now().toString(),
      role: 'assistant',
      content,
      timestamp: new Date().toISOString()
    },
    threadEvents: result.threadEvents,
    graphUpdate: result.graphUpdate,
    needsApproval: result.needsApproval || false,
    pendingCypher: result.pendingPlan?.payload,
    pendingExplanation: result.pendingPlan?.reasoning,
    toolCall
  };
}

// ============================================================================
// Re-export types
// ============================================================================

export type { SerializedThread, StreamEvent, ToolEvent, ToolExecutionPlan, ApprovalState } from './state';
