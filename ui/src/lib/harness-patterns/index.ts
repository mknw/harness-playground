/**
 * Harness Patterns - Public API
 *
 * Functional, composable framework for agentic tool execution.
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // Context Types
  UnifiedContext,
  PatternScope,
  ContextEvent,
  EventType,
  EventView,
  ScopedPattern,
  ConfiguredPattern,
  CtxStatus,
  HarnessResult,

  // Configuration Types
  PatternConfig,
  ViewConfig,
  CommitStrategy,
  TrackHistory,

  // Controller/Critic Types (BAML function signatures)
  ControllerFn,
  CriticFn,
  CodeModeControllerFn,

  // BAML Types (re-exported)
  ControllerAction,
  CriticResult,
  ScriptExecutionEvent,

  // Pattern Config Types
  SimpleLoopConfig,
  ActorCriticConfig,
  SynthesizerConfig,
  SynthesizerMode,
  SynthesizerInput,
  SynthesisFn,
  SynthesizerData,

  // Loop History Types
  LoopHistory,
  LoopIteration,
  WithLoopHistory,

  // Event Data Payloads
  UserMessageEventData,
  AssistantMessageEventData,
  ToolCallEventData,
  ToolResultEventData,
  ControllerActionEventData,
  CriticResultEventData,
  PatternEnterEventData,
  PatternExitEventData,
  ApprovalRequestEventData,
  ApprovalResponseEventData,
  ErrorEventData,

  // Approval Types
  ApprovalRequest,
  WithApproval,

  // Infrastructure types
  MCPToolDescription,
  ToolCallResult,
  ToolSet
} from './types'

export {
  MAX_TOOL_TURNS,
  MAX_RETRIES,
  DEFAULT_TRACK_HISTORY,
  DEFAULT_COMMIT_STRATEGY
} from './types'

// ============================================================================
// Tools
// ============================================================================

export { Tools, ToolsFrom } from './tools.server'

// ============================================================================
// Router
// ============================================================================

export { router, type Routes, type RoutePatterns, type RouterData } from './router.server'

// ============================================================================
// Harness
// ============================================================================

export {
  harness,
  resumeHarness,
  continueSession,
  type HarnessData,
  type HarnessResultScoped
} from './harness.server'

// ============================================================================
// Patterns
// ============================================================================

export {
  simpleLoop,
  actorCritic,
  withApproval,
  approvalPredicates,
  chain,
  synthesizer,
  configurePattern,
  parallel,
  judge,
  guardrail,
  piiScanRail,
  pathAllowlistRail,
  driftDetectorRail,
  hook,
  type SimpleLoopData,
  type ActorCriticData,
  type ApprovalPredicate,
  type WithApprovalData,
  type JudgeConfig,
  type JudgeData,
  type EvaluatorFn,
  type Rail,
  type RailResult,
  type RailContext,
  type GuardrailConfig,
  type CircuitBreakerConfig,
  type HookConfig,
  type HookTrigger
} from './patterns'

// EventView
export { EventViewImpl, createEventView } from './patterns'

// ============================================================================
// Context Helpers
// ============================================================================

export {
  createContext,
  serializeContext,
  deserializeContext,
  createScope,
  createEvent,
  shouldTrack,
  trackEvent,
  commitEvents,
  enterPattern,
  exitPattern,
  setError,
  setDone,
  setPaused,
  generateId,
  resolveConfig,
  getDefaultTrackHistory,
  getDefaultCommitStrategy
} from './context.server'

// ============================================================================
// Infrastructure (Server-only)
// ============================================================================

export { callTool, listTools, getMcpClient, closeMcpClient } from './mcp-client.server'
export { assertServer, ServerOnlyError } from './assert.server'
export { routeMessageOp } from './routing.server'

// BAML Adapters
export {
  createLoopControllerAdapter,
  createActorControllerAdapter,
  createCriticAdapter,
  createNeo4jController,
  createWebSearchController,
  createMemoryController,
  createContext7Controller,
  createGitHubController,
  createFilesystemController,
  createRedisController,
  createDatabaseController
} from './baml-adapters.server'
