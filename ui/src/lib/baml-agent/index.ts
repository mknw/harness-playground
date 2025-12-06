/**
 * BAML Agent Module
 *
 * Exports all agentic functionality for the knowledge graph agent.
 * This module handles BAML reasoning and direct neo4j-driver execution.
 *
 * Architecture:
 * - state.ts: Thread management and BAML type adapters
 * - server.ts: Server functions with multi-turn tool loop
 * - orchestrator.ts: Client-side state management
 */

// State management
export {
  Thread,
  type ThreadEvent,
  type ThreadEventType,
  type SerializedThread,
  type ToolExecutionPlan,
  type RoutingInterfaceEvent,
  type ConversationMessage
} from './state';

// Server functions (main entry points)
export {
  processAgentMessageStreaming,
  executeApprovedWrite,
  rejectWrite,
  type ProcessMessageResult,
  type WriteExecutionResult,
  type ToolCallInfo,
  type StreamEvent
} from './server';

// Client-side orchestrator (safe to export - no BAML imports)
export {
  AgentOrchestrator,
  type AgentMessage,
  type ProcessMessageOutput
} from './orchestrator';
