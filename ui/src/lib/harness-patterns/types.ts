/**
 * Harness Patterns - Shared Types
 *
 * Pure TypeScript interfaces with no server-side code.
 * Safe to import from both client and server.
 */

// ============================================================================
// Thread & Context
// ============================================================================

export interface ThreadEvent {
  type:
    | 'user_message'
    | 'tool_call'
    | 'tool_response'
    | 'assistant_message'
    | 'approval_request'
    | 'approval_response'
    | 'error';
  timestamp: string;
  data: unknown;
}

export type SerializedThread = ThreadEvent[];

export interface PlannerContext {
  intent: string;
  previousResults: ToolEvent[];
  turn: number;
}

// ============================================================================
// Tool Execution
// ============================================================================

export interface ToolExecutionPlan {
  reasoning: string;
  toolName: string;
  payload: string;
  description: string;
  isReturn: boolean;
}

export interface ToolEvent {
  status_code: number;
  status_description: string;
  operation: string;
  data: unknown;
  n_turn: number;
  stats?: {
    duration_ms?: number;
    token_count?: number;
  };
}

export interface MCPToolDescription {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  success: boolean;
  data: unknown;
  error?: string;
}

// ============================================================================
// Pattern Results
// ============================================================================

export type ExitReason = 'return' | 'max_turns' | 'error' | 'approval_needed';

export interface PatternResult {
  toolEvents: ToolEvent[];
  finalResult: unknown;
  metadata: {
    turnsUsed: number;
    exitReason: ExitReason;
  };
}

export interface CodeModeResult extends PatternResult {
  newCodedTools?: CodedTool[];
}

// ============================================================================
// Coded Tools (for persistence)
// ============================================================================

export interface CodedTool {
  name: string;
  description: string;
  script: string;
  inputSchema?: Record<string, unknown>;
}

export interface ScriptExecutionEvent {
  script: string;
  output: string;
  error: string | null;
}

export interface ScriptEvaluationResult {
  is_sufficient: boolean;
  explanation: string;
  suggested_approach: string | null;
}

// ============================================================================
// Orchestrator Output (sent to client)
// ============================================================================

export interface TelemetrySummary {
  totalDuration_ms: number;
  turnsUsed: number;
  toolCalls: number;
  exitReason: ExitReason;
}

export interface OrchestratorResult {
  response: string;
  telemetry: TelemetrySummary;
  needsApproval?: boolean;
  pendingPlan?: ToolExecutionPlan;
}

// ============================================================================
// Planner Function Type
// ============================================================================

export type PlannerFn = (
  ctx: PlannerContext,
  threadXml: string
) => Promise<ToolExecutionPlan>;

export type EvaluatorFn = (
  intent: string,
  events: ScriptExecutionEvent[]
) => Promise<ScriptEvaluationResult>;

// ============================================================================
// Constants
// ============================================================================

export const MAX_TOOL_TURNS = 5;
