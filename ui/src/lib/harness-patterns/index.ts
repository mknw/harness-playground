/**
 * Harness Patterns - Public API
 *
 * Server-side agentic tool execution patterns.
 */

// Types (safe to import anywhere)
export type {
  ThreadEvent,
  SerializedThread,
  PlannerContext,
  ToolExecutionPlan,
  ToolEvent,
  MCPToolDescription,
  ToolCallResult,
  PatternResult,
  CodeModeResult,
  CodedTool,
  ScriptExecutionEvent,
  ScriptEvaluationResult,
  TelemetrySummary,
  OrchestratorResult,
  ExitReason,
  PlannerFn,
  EvaluatorFn
} from './types';

export { MAX_TOOL_TURNS } from './types';

// Server-only exports (will fail if imported on client)
export { AgentOrchestrator } from './orchestrator.server';
export {
  simpleLoop,
  executorEvaluatorLoop,
  codeModeLoop,
  withResponse
} from './patterns.server';
export {
  neo4jOp,
  webSearchOp,
  codePlannerOp,
  evaluateScriptOp,
  createResponseOp,
  routeMessageOp
} from './planners.server';
export { Thread } from './state.server';
export { callTool, listTools, getMcpClient, closeMcpClient } from './mcp-client.server';
export { assertServer, ServerOnlyError } from './assert.server';
