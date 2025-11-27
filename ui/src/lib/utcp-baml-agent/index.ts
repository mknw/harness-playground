/**
 * UTCP-BAML Agent Module
 *
 * Exports all agentic functionality for the knowledge graph agent.
 * This module handles BAML reasoning and UTCP tool execution.
 */

// State management
export { Thread, type ThreadEvent, type ThreadEventType, type SerializedThread } from './state';

// Server functions (main entry points)
export {
  processAgentMessage,
  executeApprovedWrite,
  rejectWrite,
  initializeAgent,
  validateWriteQuery,
  generateCypherQuery,
  type AgentMessageResponse,
  type ProcessMessageResult,
  type WriteExecutionResult
} from './server';

// Agent loop and tool handlers are internal-only (used by server.ts)
// They are NOT exported here to avoid bundling BAML on the client
// Types can be exported since they're erased at compile time
export type { AgentLoopResult } from './agent';
export type { ToolResult } from './tools';

// Client-side orchestrator (safe to export - no BAML imports)
export { AgentOrchestrator, type AgentMessage, type ToolCall } from './orchestrator';
// Note: ProcessMessageResult from orchestrator conflicts with server's type - use OrchestrationResult if needed
export type { ProcessMessageResult as OrchestrationResult } from './orchestrator';
