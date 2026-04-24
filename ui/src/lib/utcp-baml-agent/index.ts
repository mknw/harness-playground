/**
 * UTCP-BAML Agent Module
 *
 * Exports all agentic functionality for the knowledge graph agent.
 * This module handles BAML reasoning and direct neo4j-driver execution.
 */

// State management
export { Thread, type ThreadEvent, type ThreadEventType, type SerializedThread } from './state';

// Server functions (main entry points)
export {
  processAgentMessage,
  executeApprovedWrite,
  rejectWrite,
  type AgentMessageResponse,
  type ProcessMessageResult,
  type WriteExecutionResult,
  type ToolCallInfo
} from './server';

// Client-side orchestrator (safe to export - no BAML imports)
export {
  AgentOrchestrator,
  type AgentMessage,
  type ProcessMessageResult as OrchestrationResult
} from './orchestrator';
