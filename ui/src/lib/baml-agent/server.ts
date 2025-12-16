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
  type ScriptExecutionEvent,
  type CodedToolReference,
  type ToolCompositionPlan,
  type EvaluationWithPersistence,
  MAX_TOOL_TURNS,
  estimateTokens,
  prepareResultsForContext,
  requiresApproval,
  createApprovalState,
  fromBamlRouting,
  fromNeo4jPlan,
  fromWebSearchPlan,
  fromMCPScriptPlan,
  fromToolCompositionPlan
} from './state';
import { getToolConfig } from './tool-config';
import { getCodedToolsForPlanner, saveCodedTool, getCodedTool } from './tool-repository';
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
  error?: string,
  input?: Record<string, unknown>
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
    output: lastCall?.rawLlmResponse,
    input
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
      data: createBAMLTelemetry('RouteUserMessage', collector, routeStartTime, 'success', undefined, {
        message,
        history_length: thread.getRecentHistory(10).length
      }),
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
      data: createBAMLTelemetry('CreateToolResponse', collector, responseStartTime, 'success', undefined, {
        tool_events_count: toolEvents.length,
        user_message: message,
        intent: routing.intent
      }),
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
 * Branches based on execution mode (static vs code)
 */
async function executeToolLoop(
  routing: RoutingInterfaceEvent,
  message: string,
  thread: Thread,
  approvalState: ApprovalState,
  collector: Collector
): Promise<ToolLoopResult> {
  // Get current tool configuration
  const toolConfig = await getToolConfig();

  // When execution mode is 'code', ALWAYS use the code mode planner flow
  // This allows the planner to orchestrate any tools (neo4j, web_search, etc.)
  // regardless of what namespace the initial routing suggested
  if (toolConfig.executionMode === 'code') {
    return executeCodeModeWithPlanner(
      routing,
      message,
      thread,
      approvalState,
      toolConfig.selectedTools,
      collector
    );
  }

  // Static mode: use namespace-specific planners (PlanNeo4jOperation, PlanWebSearch, ExecuteMCPScript)
  return executeStaticModeLoop(
    routing,
    message,
    thread,
    approvalState,
    collector
  );
}

/**
 * Static mode: Use namespace-specific planners (PlanNeo4jOperation, PlanWebSearch, ExecuteMCPScript)
 * This is the original executeToolLoop implementation
 */
async function executeStaticModeLoop(
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

  // For code_mode, we track script execution events for evaluation
  const scriptExecutionEvents: ScriptExecutionEvent[] = [];

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
        data: createBAMLTelemetry(plannerName, collector, planStartTime, 'success', undefined, {
          intent: routing.intent,
          tool_name: routing.tool_name,
          turn: n_turn,
          previous_results_count: previousResults.length
        }),
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
      const parsed = parseNeo4jResults({ records: toolEvent.data as unknown[] || [] });
      const newGraphData = toSerializable(transformNeo4jToCytoscape(
        parsed.nodes || [],
        parsed.relationships || []
      )) as ElementDefinition[];

      graphUpdate = [...(graphUpdate || []), ...newGraphData];
    }

    // For code_mode: evaluate the script output
    if (routing.tool_name === 'code_mode') {
      // Extract script from plan payload
      try {
        const payload = JSON.parse(plan.payload);
        scriptExecutionEvents.push({
          script: payload.script || '',
          output: toolEvent.status_code === 200 ? JSON.stringify(toolEvent.data) : '',
          error: toolEvent.status_code !== 200 ? toolEvent.status_description : null
        });
      } catch {
        // Fallback if payload parsing fails
        scriptExecutionEvents.push({
          script: plan.payload,
          output: toolEvent.status_code === 200 ? JSON.stringify(toolEvent.data) : '',
          error: toolEvent.status_code !== 200 ? toolEvent.status_description : null
        });
      }

      // Call EvaluateScriptOutput to check if we should continue
      const { b } = await import('../../../baml_client');
      const evalStartTime = Date.now();
      const evaluation = await b.EvaluateScriptOutput(
        routing.intent,
        scriptExecutionEvents,
        { collector }
      );

      // Emit telemetry for evaluation
      telemetryEvents.push({
        type: 'baml_telemetry',
        data: createBAMLTelemetry('EvaluateScriptOutput', collector, evalStartTime, 'success', undefined, {
          intent: routing.intent,
          attempts_count: scriptExecutionEvents.length,
          last_output_length: scriptExecutionEvents[scriptExecutionEvents.length - 1]?.output?.length || 0
        }),
        timestamp: new Date().toISOString()
      });

      // If sufficient, exit the loop - the evaluation explanation will be used in response
      if (evaluation.is_sufficient) {
        // Store evaluation result in the last tool event for CreateToolResponse to use
        toolEvents[toolEvents.length - 1] = {
          ...toolEvents[toolEvents.length - 1],
          data: {
            result: toolEvent.data,
            evaluation: {
              is_sufficient: evaluation.is_sufficient,
              explanation: evaluation.explanation
            }
          }
        };
        break;
      }

      // Not sufficient - the loop will continue with guidance from evaluation
      // The previousResults will contain the evaluation feedback for the next iteration
    }
  }

  return { toolEvents, graphUpdate, telemetryEvents };
}

/**
 * Code mode with planner: Uses PlanToolComposition → Execute → EvaluateAndPersist
 * This is the new flow that can reuse coded tools from the repository
 */
async function executeCodeModeWithPlanner(
  routing: RoutingInterfaceEvent,
  message: string,
  thread: Thread,
  approvalState: ApprovalState,
  selectedTools: string[],
  collector: Collector
): Promise<ToolLoopResult> {
  const { b } = await import('../../../baml_client');

  const toolEvents: ToolEvent[] = [];
  const telemetryEvents: StreamEvent[] = [];
  let graphUpdate: ElementDefinition[] | undefined;
  const scriptExecutionEvents: ScriptExecutionEvent[] = [];

  // Get coded tools from repository for planner context
  const codedTools = await getCodedToolsForPlanner();

  for (let n_turn = 1; n_turn <= MAX_TOOL_TURNS; n_turn++) {
    // ========================================
    // STEP 1: Plan with PlanToolComposition
    // ========================================
    const planStartTime = Date.now();
    const plan = await b.PlanToolComposition(
      message,
      routing.intent,
      selectedTools,
      codedTools,
      scriptExecutionEvents,
      { collector }
    );

    // Emit telemetry for PlanToolComposition
    telemetryEvents.push({
      type: 'baml_telemetry',
      data: createBAMLTelemetry('ExecuteMCPScript', collector, planStartTime, 'success', undefined, {
        intent: routing.intent,
        turn: n_turn,
        use_existing_tool: plan.use_existing_tool,
        existing_tool_name: plan.existing_tool_name,
        coded_tools_count: codedTools.length,
        should_save: plan.should_save
      }),
      timestamp: new Date().toISOString()
    });

    // ========================================
    // STEP 2: Get or create script to execute
    // ========================================
    let script: string;
    let shouldSave = plan.should_save;
    let toolNameToSave = plan.tool_name_to_save;
    let toolDescription = plan.tool_description;

    if (plan.use_existing_tool && plan.existing_tool_name) {
      // Reuse existing coded tool from repository
      const codedTool = await getCodedTool(plan.existing_tool_name);
      if (!codedTool) {
        // Tool not found - fall back to new script
        script = plan.new_script || '';
      } else {
        script = codedTool.script;
        // Don't save if reusing existing tool
        shouldSave = false;
      }
    } else {
      // Use new script from planner
      script = plan.new_script || '';
    }

    if (!script) {
      // No script to execute - error condition
      toolEvents.push({
        status_code: 400,
        status_description: 'No script provided by planner',
        operation: JSON.stringify({ error: 'empty_script' }),
        data: null,
        n_turn
      });
      break;
    }

    // Convert plan to ToolExecutionPlan for execution
    const executionPlan = fromToolCompositionPlan(plan, script);

    // Check if approval needed for writes
    if (requiresApproval(executionPlan, approvalState)) {
      thread.addApprovalRequest(executionPlan.payload, executionPlan.reasoning);

      return {
        toolEvents,
        graphUpdate,
        needsApproval: true,
        pendingPlan: executionPlan,
        telemetryEvents
      };
    }

    // ========================================
    // STEP 3: Execute the script
    // ========================================
    const toolStartTime = Date.now();
    const toolEvent = await executeToolPlan(executionPlan, 'code_mode', n_turn);
    toolEvents.push(toolEvent);

    // Emit tool telemetry
    telemetryEvents.push({
      type: 'tool_telemetry',
      data: createToolTelemetry(
        executionPlan.toolName,
        toolStartTime,
        toolEvent.status_code === 200 ? 'success' : 'error',
        toolEvent.data,
        toolEvent.status_code !== 200 ? toolEvent.status_description : undefined
      ),
      timestamp: new Date().toISOString()
    });

    // Record in thread
    thread.addToolCall(executionPlan.toolName, { script }, routing.intent);
    thread.addToolResponse(executionPlan.toolName, toolEvent);

    // Track script execution for next iteration
    scriptExecutionEvents.push({
      script,
      output: toolEvent.status_code === 200 ? JSON.stringify(toolEvent.data) : '',
      error: toolEvent.status_code !== 200 ? toolEvent.status_description : null
    });

    // ========================================
    // STEP 4: Evaluate and potentially persist
    // ========================================
    const evalStartTime = Date.now();
    const evaluation = await b.EvaluateAndPersist(
      routing.intent,
      scriptExecutionEvents[scriptExecutionEvents.length - 1],
      shouldSave,
      toolNameToSave || null,
      toolDescription || null,
      { collector }
    );

    // Emit telemetry for EvaluateAndPersist
    telemetryEvents.push({
      type: 'baml_telemetry',
      data: createBAMLTelemetry('EvaluateScriptOutput', collector, evalStartTime, 'success', undefined, {
        intent: routing.intent,
        should_save: shouldSave,
        tool_name_to_save: toolNameToSave,
        script_length: script.length,
        turn: n_turn
      }),
      timestamp: new Date().toISOString()
    });

    // ========================================
    // STEP 5: Save to repository if indicated
    // ========================================
    if (evaluation.tool_saved && toolNameToSave && toolDescription) {
      try {
        await saveCodedTool({
          name: toolNameToSave,
          description: toolDescription,
          script
        });
        console.log(`[CodeMode] Saved tool to repository: ${toolNameToSave}`);
      } catch (saveError) {
        console.error('[CodeMode] Failed to save tool:', saveError);
        // Don't fail the overall execution if save fails
      }
    }

    // ========================================
    // STEP 6: Check if sufficient
    // ========================================
    if (evaluation.is_sufficient) {
      // Store evaluation result in the last tool event for CreateToolResponse
      toolEvents[toolEvents.length - 1] = {
        ...toolEvents[toolEvents.length - 1],
        data: {
          result: toolEvent.data,
          evaluation: {
            is_sufficient: evaluation.is_sufficient,
            explanation: evaluation.explanation,
            tool_saved: evaluation.tool_saved,
            saved_tool_name: evaluation.saved_tool_name
          }
        }
      };
      break;
    }

    // Not sufficient - continue loop with feedback from evaluation
  }

  return { toolEvents, graphUpdate, telemetryEvents };
}

/** Get BAML planner function name from namespace */
function getPlannerName(namespace: ToolNamespace | null): BAMLFunctionName | null {
  switch (namespace) {
    case 'neo4j': return 'PlanNeo4jOperation';
    case 'web_search': return 'PlanWebSearch';
    case 'code_mode': return 'ExecuteMCPScript';
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
        'fetch_content'
      ];

      // Parse previous results to extract script execution events
      const previousAttempts: ScriptExecutionEvent[] = [];
      try {
        const parsed = JSON.parse(previousResults);
        if (Array.isArray(parsed)) {
          for (const event of parsed) {
            if (event.operation) {
              // Extract script from operation payload
              try {
                const payload = JSON.parse(event.operation);
                if (payload.script) {
                  previousAttempts.push({
                    script: payload.script,
                    output: event.status_code === 200 ? JSON.stringify(event.data) : '',
                    error: event.status_code !== 200 ? event.status_description : null
                  });
                }
              } catch {
                // Not a code_mode event, skip
              }
            }
          }
        }
      } catch {
        // Empty or invalid previous results
      }

      const bamlPlan = await b.ExecuteMCPScript(
        message,
        routing.intent,
        availableTools,
        previousAttempts,
        { collector }
      );
      return fromMCPScriptPlan(bamlPlan);
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
      const parsed = parseNeo4jResults({ records: toolEvent.data as unknown[] || [] });
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
