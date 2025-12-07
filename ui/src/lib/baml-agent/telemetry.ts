/**
 * Telemetry Types for Observability Panel
 *
 * Captures BAML function execution and tool call metrics for real-time
 * visibility into agent operations.
 */

// ============================================================================
// BAML Function Telemetry
// ============================================================================

/** BAML functions that can be tracked */
export type BAMLFunctionName =
  | 'RouteUserMessage'
  | 'PlanNeo4jOperation'
  | 'PlanWebSearch'
  | 'PlanCodeModeOperation'
  | 'CreateToolResponse';

/** Telemetry data captured for each BAML function call */
export interface BAMLCallTelemetry {
  /** Unique identifier for this call */
  id: string;
  /** Which BAML function was called */
  functionName: BAMLFunctionName;
  /** ISO timestamp of when the call started */
  timestamp: string;
  /** Current execution status */
  status: 'pending' | 'success' | 'error';
  /** Token usage from the LLM call */
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  /** Time taken for the call in milliseconds */
  latency_ms?: number;
  /** Error message if status is 'error' */
  error?: string;
  /** Raw output from the BAML function (for expansion view) */
  output?: unknown;
}

// ============================================================================
// Tool Execution Telemetry
// ============================================================================

/** Tool namespace categories with distinct color coding */
export type ToolNamespace = 'neo4j' | 'web_search' | 'code_mode';

/** Telemetry data captured for each tool execution */
export interface ToolCallTelemetry {
  /** Unique identifier for this call */
  id: string;
  /** Tool namespace (for color coding) */
  namespace: ToolNamespace;
  /** Specific tool name (e.g., 'read_neo4j_cypher') */
  toolName: string;
  /** ISO timestamp of when the call started */
  timestamp: string;
  /** Current execution status */
  status: 'pending' | 'success' | 'error';
  /** Time taken for the call in milliseconds */
  duration_ms?: number;
  /** The query/payload sent to the tool */
  payload?: unknown;
  /** Result statistics */
  result?: {
    nodeCount?: number;
    relationshipCount?: number;
    resultCount?: number;
  };
  /** Raw result data (for expansion view) */
  rawResult?: unknown;
  /** Error message if status is 'error' */
  error?: string;
  /** Turn number in multi-turn tool loop */
  turn?: number;
}

// ============================================================================
// Aggregated Metrics
// ============================================================================

/** Aggregated metrics across all telemetry events */
export interface TelemetryMetrics {
  /** Total number of calls (BAML + tools) */
  totalCalls: number;
  /** Success rate as decimal (0-1) */
  successRate: number;
  /** Average latency in milliseconds */
  avgLatency_ms: number;
  /** Total token usage */
  totalTokens: {
    input: number;
    output: number;
  };
  /** Count of calls per BAML function */
  callsByFunction: Partial<Record<BAMLFunctionName, number>>;
  /** Count of calls per tool namespace */
  callsByNamespace: Partial<Record<ToolNamespace, number>>;
}

// ============================================================================
// Union Types for Generic Handling
// ============================================================================

/** Any telemetry event */
export type TelemetryEvent = BAMLCallTelemetry | ToolCallTelemetry;

/** Timeline event with lane information for vertical timeline display */
export type TimelineEvent =
  | (BAMLCallTelemetry & { lane: 'interface' | 'tools' })
  | (ToolCallTelemetry & { lane: 'tools' });

/** Type guard for BAML call telemetry */
export function isBAMLCallTelemetry(event: TelemetryEvent): event is BAMLCallTelemetry {
  return 'functionName' in event;
}

/** Type guard for tool call telemetry */
export function isToolCallTelemetry(event: TelemetryEvent): event is ToolCallTelemetry {
  return 'namespace' in event && 'toolName' in event;
}

/** Type guard for interface lane events */
export function isInterfaceLane(event: TimelineEvent): event is BAMLCallTelemetry & { lane: 'interface' } {
  return event.lane === 'interface';
}

/** Get display label for any timeline event */
export function getEventLabel(event: TimelineEvent): string {
  // Check event type, not lane - Plan operations are BAML calls in tools lane
  if (isBAMLCallTelemetry(event)) {
    return getBAMLFunctionLabel(event.functionName);
  }
  return getToolLabel((event as ToolCallTelemetry).toolName);
}

/** Get duration for any timeline event */
export function getEventDuration(event: TimelineEvent): number | undefined {
  if (event.lane === 'interface') {
    return (event as BAMLCallTelemetry).latency_ms;
  }
  return (event as ToolCallTelemetry).duration_ms;
}

/** Get color class for any timeline event (for static UnoCSS usage) */
export function getEventColor(event: TimelineEvent): string {
  if (event.lane === 'interface') {
    return 'cyber-500';
  }
  return namespaceColors[(event as ToolCallTelemetry).namespace];
}

/** Get hex color for any timeline event (for dynamic inline styles) */
export function getEventHexColor(event: TimelineEvent): string {
  if (event.lane === 'interface') {
    return '#6366f1'; // cyber-500
  }
  // Tools lane - check if it's a BAML call (Plan operations) or actual tool call
  if (isBAMLCallTelemetry(event)) {
    // Plan operations in tools lane - use a distinct color
    return '#a855f7'; // purple-500 for Plan operations
  }
  return namespaceHexColors[(event as ToolCallTelemetry).namespace];
}

// ============================================================================
// Color Mappings
// ============================================================================

/** Namespace to UnoCSS class mapping (for static usage) */
export const namespaceColors: Record<ToolNamespace, string> = {
  neo4j: 'neon-cyan',
  web_search: 'neon-purple',
  code_mode: 'neon-orange'
};

/** Namespace to hex color mapping (for dynamic inline styles) */
export const namespaceHexColors: Record<ToolNamespace, string> = {
  neo4j: '#00ffff',      // neon-cyan
  web_search: '#9d00ff', // neon-purple
  code_mode: '#ff6600'   // neon-orange
};

/** Status to color class mapping */
export const statusColors: Record<'pending' | 'success' | 'error', string> = {
  pending: 'neon-yellow',
  success: 'neon-green',
  error: 'red-500'
};

// ============================================================================
// Display Helpers
// ============================================================================

/** BAML functions that appear in the Interface lane (user-facing) */
const INTERFACE_FUNCTIONS: BAMLFunctionName[] = ['RouteUserMessage', 'CreateToolResponse'];

/** Check if a BAML function belongs in the Interface lane */
export function isInterfaceFunction(name: BAMLFunctionName): boolean {
  return INTERFACE_FUNCTIONS.includes(name);
}

/** Get human-readable label for a BAML function */
export function getBAMLFunctionLabel(name: BAMLFunctionName): string {
  const labels: Record<BAMLFunctionName, string> = {
    RouteUserMessage: 'Route',
    PlanNeo4jOperation: 'Plan Neo4j',
    PlanWebSearch: 'Plan Search',
    PlanCodeModeOperation: 'Plan Code',
    CreateToolResponse: 'Response'
  };
  return labels[name] || name;
}

/** Get human-readable label for a tool */
export function getToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read_neo4j_cypher: 'Read Cypher',
    write_neo4j_cypher: 'Write Cypher',
    get_neo4j_schema: 'Get Schema',
    search: 'Web Search',
    fetch: 'Fetch URL',
    run_tools_with_javascript: 'Run JS'
  };
  return labels[toolName] || toolName;
}

/** Determine namespace from tool name */
export function getNamespaceFromTool(toolName: string): ToolNamespace {
  if (toolName.includes('neo4j') || toolName.includes('cypher') || toolName.includes('schema')) {
    return 'neo4j';
  }
  if (toolName === 'search' || toolName === 'fetch') {
    return 'web_search';
  }
  return 'code_mode';
}
