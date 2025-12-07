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
  createApprovalState,
  fromBamlRouting,
  fromNeo4jPlan,
  fromWebSearchPlan,
  fromCodeModePlan
} from './state';
import { executeTool } from './agent';
import { getSchemaForAgent } from '../neo4j/queries';
import { transformNeo4jToCytoscape, parseNeo4jResults } from '../graph/transform';
import type { ElementDefinition } from 'cytoscape';
import neo4j from 'neo4j-driver';
import { Collector } from '@boundaryml/baml';
import type { BAMLCallTelemetry, ToolCallTelemetry, BAMLFunctionName } from './telemetry';
import { getNamespaceFromTool } from './telemetry';

// ============================================================================
// Telemetry Helpers
// ============================================================================

/** Generate a unique ID for telemetry events */
function generateTelemetryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Create a BAML telemetry event from collector data */
function createBAMLTelemetry(
  functionName: BAMLFunctionName,
  collector: Collector,
  startTime: number,
  status: 'success' | 'error' = 'success',
  error?: string
): BAMLCallTelemetry {
  const lastCall = collector.last;

  return {
    id: generateTelemetryId('baml'),
    functionName,
    timestamp: new Date().toISOString(),
    status,
    usage: lastCall?.usage ? {
      input_tokens: lastCall.usage.inputTokens || 0,
      output_tokens: lastCall.usage.outputTokens || 0
    } : undefined,
    latency_ms: Date.now() - startTime,
    error,
    output: lastCall?.rawLlmResponse
  };
}

/** Create a tool telemetry event */
function createToolTelemetry(
  toolName: string,
  startTime: number,
  status: 'success' | 'error' = 'success',
  result?: unknown,
  error?: string
): ToolCallTelemetry {
  const stats = extractStats(result, toolName);

  return {
    id: generateTelemetryId('tool'),
    namespace: getNamespaceFromTool(toolName),
    toolName,
    timestamp: new Date().toISOString(),
    status,
    duration_ms: Date.now() - startTime,
    result: stats.nodeCount !== undefined || stats.relationshipCount !== undefined
      ? { nodeCount: stats.nodeCount, relationshipCount: stats.relationshipCount }
      : undefined,
    rawResult: result,
    error
  };
}

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
  type: 'neo4j' | 'web_search' | 'fetch' | 'code_mode';
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

    // Create collector for this session
    const collector = new Collector('agent-session');

    // ========================================
    // STEP 1: Route Message
    // ========================================
    const routeStartTime = Date.now();
    const bamlRouting = await b.RouteUserMessage(
      message,
      thread.getRecentHistory(10),
      { collector }
    );
    const routing = fromBamlRouting(bamlRouting);

    // Add routing event
    events.push({
      type: 'routing',
      data: routing,
      timestamp: new Date().toISOString()
    });

    // Emit BAML telemetry for RouteUserMessage
    events.push({
      type: 'baml_telemetry',
      data: createBAMLTelemetry('RouteUserMessage', collector, routeStartTime),
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
    const { toolEvents, graphUpdate, needsApproval, pendingPlan, telemetryEvents } =
      await executeToolLoop(
        routing as unknown as RoutingInterfaceEvent,
        message,
        thread,
        state,
        collector
      );

    // Add telemetry events from tool loop
    events.push(...telemetryEvents);

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
    const responseStartTime = Date.now();
    const finalContent = await b.CreateToolResponse(
      JSON.stringify(toolEvents),
      message,
      routing.intent,
      { collector }
    );

    // Emit BAML telemetry for CreateToolResponse
    events.push({
      type: 'baml_telemetry',
      data: createBAMLTelemetry('CreateToolResponse', collector, responseStartTime),
      timestamp: new Date().toISOString()
    });

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
  telemetryEvents: StreamEvent[];
}

/**
 * Execute tools in a loop until done or max turns reached
 */
async function executeToolLoop(
  routing: RoutingInterfaceEvent,
  message: string,
  thread: Thread,
  approvalState: ApprovalState,
  collector: Collector
): Promise<ToolLoopResult> {
  const toolEvents: ToolEvent[] = [];
  const telemetryEvents: StreamEvent[] = [];
  let graphUpdate: ElementDefinition[] | undefined;
  let n_turn = 0;

  while (n_turn < MAX_TOOL_TURNS) {
    n_turn++;

    // Prepare context from previous results
    const previousResults = prepareResultsForContext(toolEvents);

    // Plan next action based on tool namespace
    const planStartTime = Date.now();
    const plan = await planToolExecution(
      routing,
      message,
      previousResults,
      n_turn,
      collector
    );

    // Determine which BAML planner was used and emit telemetry
    const plannerName = getPlannerName(routing.tool_name);
    if (plannerName) {
      telemetryEvents.push({
        type: 'baml_telemetry',
        data: createBAMLTelemetry(plannerName, collector, planStartTime),
        timestamp: new Date().toISOString()
      });
    }

    // Check for Return action - exit loop with accumulated results
    if (plan.isReturn) {
      break;
    }

    // Check if approval needed for writes
    if (requiresApproval(plan, approvalState)) {
      thread.addApprovalRequest(plan.payload, plan.reasoning);

      return {
        toolEvents,
        graphUpdate,
        needsApproval: true,
        pendingPlan: plan,
        telemetryEvents
      };
    }

    // Execute the tool
    const toolStartTime = Date.now();
    const toolEvent = await executeToolPlan(plan, routing.tool_name, n_turn);
    toolEvents.push(toolEvent);

    // Emit tool telemetry
    telemetryEvents.push({
      type: 'tool_telemetry',
      data: createToolTelemetry(
        plan.toolName,
        toolStartTime,
        toolEvent.status_code === 200 ? 'success' : 'error',
        toolEvent.data,
        toolEvent.status_code !== 200 ? toolEvent.status_description : undefined
      ),
      timestamp: new Date().toISOString()
    });

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
  }

  return { toolEvents, graphUpdate, telemetryEvents };
}

/** Get BAML planner function name from namespace */
function getPlannerName(namespace: ToolNamespace | null): BAMLFunctionName | null {
  switch (namespace) {
    case 'neo4j': return 'PlanNeo4jOperation';
    case 'web_search': return 'PlanWebSearch';
    case 'code_mode': return 'PlanCodeModeOperation';
    default: return null;
  }
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
  n_turn: number,
  collector: Collector
): Promise<ToolExecutionPlan> {
  const { b } = await import('../../../baml_client');

  switch (routing.tool_name) {
    case 'neo4j': {
      // Get schema for neo4j operations (formatted for LLM consumption)
      const schemaResult = await getSchemaForAgent();
      const schema = schemaResult.success ? schemaResult.schema || '' : '';

      const bamlPlan = await b.PlanNeo4jOperation(
        message,
        routing.intent,
        schema,
        previousResults,
        n_turn,
        { collector }
      );
      return fromNeo4jPlan(bamlPlan);
    }

    case 'web_search': {
      const bamlPlan = await b.PlanWebSearch(
        message,
        routing.intent,
        previousResults,
        n_turn,
        { collector }
      );
      return fromWebSearchPlan(bamlPlan);
    }

    case 'code_mode': {
      // Get available tools for code_mode
      const availableTools = [
        'read_neo4j_cypher',
        'write_neo4j_cypher',
        'get_neo4j_schema',
        'search',
        'fetch'
      ];

      const bamlPlan = await b.PlanCodeModeOperation(
        message,
        routing.intent,
        availableTools,
        previousResults,
        n_turn,
        { collector }
      );
      return fromCodeModePlan(bamlPlan);
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
 * Uses agent.executeTool for unified execution path
 */
async function executeToolPlan(
  plan: ToolExecutionPlan,
  namespace: ToolNamespace | null,
  n_turn: number
): Promise<ToolEvent> {
  const startTime = Date.now();

  try {
    // Use agent integration layer for tool execution
    const toolResult = await executeTool(
      namespace || 'neo4j',
      plan.toolName,
      plan.payload
    );

    if (!toolResult.success) {
      throw new Error(toolResult.error || 'Tool execution failed');
    }

    const resultStr = JSON.stringify(toolResult.data);
    const stats = extractStats(toolResult.data, plan.toolName);

    return {
      status_code: 200,
      status_description: 'Success',
      operation: plan.payload,
      data: toSerializable(toolResult.data),
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

  // Map tool names to UI display types
  const toolType: ToolCallInfo['type'] =
    plan.toolName.includes('write') ? 'neo4j' :
    plan.toolName.includes('neo4j') || plan.toolName.includes('cypher') ? 'neo4j' :
    plan.toolName === 'search' ? 'web_search' :
    plan.toolName === 'fetch' ? 'fetch' : 'code_mode';

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

    // Write operations are always neo4j namespace
    const toolEvent = await executeToolPlan(plan, 'neo4j', 1);

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
      isReturn: false
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
// Re-export types
// ============================================================================
//

export type { SerializedThread, StreamEvent, ToolEvent, ToolExecutionPlan, ApprovalState } from './state';
