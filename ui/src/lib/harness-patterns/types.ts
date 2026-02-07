/**
 * Harness Patterns - Types
 *
 * Pure TypeScript interfaces. Safe to import from client and server.
 */

// Re-export BAML types for convenience
export type {
  ControllerAction,
  CriticResult,
  Attempt
} from '../../../baml_client/types'

/**
 * Script execution event for actor-critic pattern.
 * Internal type used by actorCritic to track code mode executions.
 */
export interface ScriptExecutionEvent {
  script: string
  output: string
  error?: string | null
}

// ============================================================================
// Core Context
// ============================================================================

/** Status of context */
export type CtxStatus = 'running' | 'paused' | 'done' | 'error'

/** @deprecated Use UnifiedContext instead */
export interface Ctx<T = Record<string, unknown>> {
  input: string
  data: T
  status: CtxStatus
  error?: string
  startTime: number
}

// ============================================================================
// UnifiedContext - Source of Truth
// ============================================================================

/** All possible event types in the context */
export type EventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'controller_action'
  | 'critic_result'
  | 'pattern_enter'
  | 'pattern_exit'
  | 'approval_request'
  | 'approval_response'
  | 'error'

/** A single event in the context stream */
export interface ContextEvent {
  type: EventType
  ts: number
  patternId: string
  data: unknown
  /** LLM call data - present when event involved an LLM call */
  llmCall?: LLMCallData
}

/** UnifiedContext - single source of truth for session state */
export interface UnifiedContext<T = Record<string, unknown>> {
  /** Session identifier */
  sessionId: string
  /** When the session was created */
  createdAt: number
  /** Full event stream */
  events: ContextEvent[]
  /** Current execution status */
  status: CtxStatus
  /** Error message if status is 'error' */
  error?: string
  /** Accumulated pattern data */
  data: T
  /** Current user input */
  input: string
}

/** Isolated workspace for a pattern's execution */
export interface PatternScope<T = Record<string, unknown>> {
  /** Pattern identifier */
  id: string
  /** Local events (not yet committed to context) */
  events: ContextEvent[]
  /** Pattern-specific data */
  data: T
  /** When pattern execution started */
  startTime: number
}

// ============================================================================
// Pattern Configuration
// ============================================================================

/** When to commit events to context */
export type CommitStrategy =
  | 'always'      // Commit all tracked events regardless of outcome
  | 'on-success'  // Commit only if pattern completes without error
  | 'last'        // Commit only the final event
  | 'never'       // Discard all events (dry-run / preview mode)

/** What event types to track */
export type TrackHistory =
  | boolean       // true = all types, false = none
  | EventType     // Single type: 'tool_result'
  | EventType[]   // Multiple: ['tool_call', 'tool_result']

/** Configuration for what events a pattern receives */
export interface ViewConfig {
  /** Specific pattern IDs to read from */
  fromPatterns?: string[]
  /** Last N patterns */
  fromLastN?: number
  /** Only previous pattern (default: true) */
  fromLast?: boolean
  /** Filter by event type */
  eventTypes?: EventType[]
  /** Max events to include */
  limit?: number
}

/** Base configuration for all patterns */
export interface PatternConfig {
  /** Explicit ID for referencing later */
  patternId?: string
  /** When to commit events (default varies by pattern) */
  commitStrategy?: CommitStrategy
  /** What event types to track */
  trackHistory?: TrackHistory
  /** Configure EventView input for this pattern */
  viewConfig?: ViewConfig
}

// ============================================================================
// Controller & Critic Function Types
// ============================================================================

/**
 * Controller function type for simpleLoop pattern.
 * Matches BAML-generated function signatures.
 * Uses rest params to accommodate different controller signatures (with/without schema).
 */
export type ControllerFn = (
  user_message: string,
  intent: string,
  previous_results: string,
  n_turn: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...extra: any[]
) => Promise<import('../../../baml_client/types').ControllerAction>

/**
 * Critic function type for actorCritic pattern.
 * Matches BAML-generated function signatures.
 */
export type CriticFn = (
  intent: string,
  previous_attempts: ScriptExecutionEvent[]
) => Promise<import('../../../baml_client/types').CriticResult>

/**
 * Code mode controller function type.
 * Different signature - takes available_tools instead of schema.
 */
export type CodeModeControllerFn = (
  user_message: string,
  intent: string,
  available_tools: string[],
  previous_attempts: ScriptExecutionEvent[]
) => Promise<import('../../../baml_client/types').ControllerAction>

// ============================================================================
// Pattern Configuration
// ============================================================================

/** Configuration for simpleLoop pattern */
export interface SimpleLoopConfig extends PatternConfig {
  /** Optional schema to inject (for neo4j) */
  schema?: string
  /** Max turns before forcing exit (default: 5) */
  maxTurns?: number
}

/** Configuration for actorCritic pattern */
export interface ActorCriticConfig extends PatternConfig {
  /** Available tools for code mode */
  availableTools?: string[]
  /** Max retries before giving up (default: 3) */
  maxRetries?: number
}

// ============================================================================
// Patterns
// ============================================================================

/** Forward declaration for EventView (implemented in event-view.server.ts) */
export interface EventView {
  fromPattern(patternId: string): EventView
  fromPatterns(patternIds: string[]): EventView
  fromLastPattern(): EventView
  fromLastNPatterns(n: number): EventView
  fromAll(): EventView
  ofType(type: EventType): EventView
  ofTypes(types: EventType[]): EventView
  tools(): EventView
  messages(): EventView
  actions(): EventView
  last(n: number): EventView
  first(n: number): EventView
  since(ts: number): EventView
  get(): ContextEvent[]
  serialize(): string
  exists(): boolean
  count(): number
}

/** @deprecated Use ScopedPattern instead */
export type Pattern<T> = (ctx: Ctx<T>) => Promise<Ctx<T>>

/** New pattern signature with isolated scope and event view */
export type ScopedPattern<T> = (
  scope: PatternScope<T>,
  view: EventView
) => Promise<PatternScope<T>>

/** Configured pattern with metadata for chain/harness */
export interface ConfiguredPattern<T> {
  name: string
  fn: ScopedPattern<T>
  config: PatternConfig
}

// ============================================================================
// Tools
// ============================================================================

export interface MCPToolDescription {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface ToolCallResult {
  success: boolean
  data: unknown
  error?: string
}

export type ToolSet = Record<string, string[]> & { all: string[] }

// ============================================================================
// Approval
// ============================================================================

export interface ApprovalRequest {
  action: string
  payload: unknown
  reason: string
}

export interface WithApproval {
  pendingAction?: ApprovalRequest
  approved?: boolean
}

// ============================================================================
// Results
// ============================================================================

export interface HarnessResult<T> {
  response: string
  data: T
  status: CtxStatus
  duration_ms: number
}

// ============================================================================
// Thread (deprecated - use UnifiedContext)
// ============================================================================

/**
 * @deprecated Use ContextEvent instead. ThreadEvent uses string timestamps
 * and 'tool_response' instead of 'tool_result'.
 */
export interface ThreadEvent {
  type:
    | 'user_message'
    | 'tool_call'
    | 'tool_response'
    | 'assistant_message'
    | 'approval_request'
    | 'approval_response'
    | 'error'
  timestamp: string
  data: unknown
}

/** @deprecated Use UnifiedContext.events instead */
export type SerializedThread = ThreadEvent[]

// ============================================================================
// Loop History (for thread mode synthesis)
// ============================================================================

/** Single iteration in a loop pattern */
export interface LoopIteration {
  turn: number
  action: import('../../../baml_client/types').ControllerAction
  result: unknown
  timestamp: number
}

/** Full history of a loop pattern's execution */
export interface LoopHistory {
  iterations: LoopIteration[]
  startTime: number
  endTime?: number
}

/** Data that includes loop history */
export interface WithLoopHistory {
  loopHistory?: LoopHistory
}

// ============================================================================
// Synthesizer Types
// ============================================================================

/** Mode for synthesizer pattern */
export type SynthesizerMode = 'message' | 'response' | 'thread'

/** Input to synthesizer based on mode */
export interface SynthesizerInput {
  mode: SynthesizerMode
  userMessage: string
  intent: string
  response?: string
  data?: unknown
  loopHistory?: LoopHistory
}

/** Custom synthesis function type */
export type SynthesisFn = (input: SynthesizerInput) => Promise<string>

/** Configuration for synthesizer pattern */
export interface SynthesizerConfig extends PatternConfig {
  mode: SynthesizerMode
  /** Custom synthesis function (defaults to BAML CreateToolResponse) */
  synthesize?: SynthesisFn
  /** Skip synthesis if response already exists */
  skipIfHasResponse?: boolean
}

/** Data interface for synthesizer */
export interface SynthesizerData {
  response?: string
  synthesizedResponse?: string
  intent?: string
  loopHistory?: LoopHistory
}

// ============================================================================
// Event Data Payloads
// ============================================================================

/** Data payload for user_message event */
export interface UserMessageEventData {
  content: string
}

/** Data payload for assistant_message event */
export interface AssistantMessageEventData {
  content: string
}

/** Data payload for tool_call event */
export interface ToolCallEventData {
  tool: string
  args: unknown
}

/** Data payload for tool_result event */
export interface ToolResultEventData {
  tool: string
  result: unknown
  success: boolean
  error?: string
}

/** Data payload for controller_action event */
export interface ControllerActionEventData {
  action: import('../../../baml_client/types').ControllerAction
}

/** Data payload for critic_result event */
export interface CriticResultEventData {
  result: import('../../../baml_client/types').CriticResult
}

/** Data payload for pattern_enter event */
export interface PatternEnterEventData {
  pattern: string
}

/** Data payload for pattern_exit event */
export interface PatternExitEventData {
  status: CtxStatus
  error?: string
}

/** Data payload for approval_request event */
export interface ApprovalRequestEventData {
  request: ApprovalRequest
}

/** Data payload for approval_response event */
export interface ApprovalResponseEventData {
  approved: boolean
  reason?: string
}

/** Data payload for error event */
export interface ErrorEventData {
  error: string
  stack?: string
}

// ============================================================================
// LLM Call Observability
// ============================================================================

/** LLM call observability data - attached to events involving LLM calls */
export interface LLMCallData {
  /** BAML function name (e.g., 'LoopController', 'Critic', 'Synthesize') */
  functionName: string
  /** Input parameters passed to the BAML function */
  variables: Record<string, unknown>
  /** Rendered prompt / HTTP request body */
  rawInput?: string
  /** Raw LLM response string before parsing */
  rawOutput?: string
  /** Token usage statistics */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  /** Call duration in milliseconds */
  durationMs?: number
}

// ============================================================================
// Helper Functions Types
// ============================================================================

/** Function to check if event type should be tracked */
export type ShouldTrackFn = (type: EventType, trackHistory: TrackHistory) => boolean

// ============================================================================
// Constants
// ============================================================================

export const MAX_TOOL_TURNS = 5
export const MAX_RETRIES = 3

/** Default trackHistory by pattern type */
export const DEFAULT_TRACK_HISTORY: Record<string, TrackHistory> = {
  simpleLoop: 'tool_result',
  actorCritic: 'tool_result',
  synthesizer: 'assistant_message',
  router: false,
  chain: false,
  withApproval: false
}

/** Default commitStrategy by pattern type */
export const DEFAULT_COMMIT_STRATEGY: Record<string, CommitStrategy> = {
  simpleLoop: 'on-success',
  actorCritic: 'on-success',
  synthesizer: 'always',
  router: 'always',
  chain: 'always',
  withApproval: 'on-success'
}
