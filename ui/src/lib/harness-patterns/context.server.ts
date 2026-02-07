/**
 * UnifiedContext - Server Only
 *
 * Factory functions for creating and managing UnifiedContext.
 * This is the single source of truth for session state.
 */

import { assertServerOnImport } from './assert.server'
import type {
  UnifiedContext,
  PatternScope,
  ContextEvent,
  EventType,
  CommitStrategy,
  TrackHistory,
  PatternConfig,
  UserMessageEventData,
  LLMCallData
} from './types'

assertServerOnImport()

// ============================================================================
// ID Generation
// ============================================================================

/** Generate a short unique ID */
export function generateId(prefix = ''): string {
  const id = Math.random().toString(36).substring(2, 8)
  return prefix ? `${prefix}-${id}` : id
}

// ============================================================================
// UnifiedContext Factory
// ============================================================================

/** Create a new UnifiedContext */
export function createContext<T = Record<string, unknown>>(
  input: string,
  initialData?: T,
  sessionId?: string
): UnifiedContext<T> {
  const now = Date.now()
  const ctx: UnifiedContext<T> = {
    sessionId: sessionId ?? generateId('session'),
    createdAt: now,
    events: [],
    status: 'running',
    data: initialData ?? ({} as T),
    input
  }

  // Add initial user message event
  ctx.events.push({
    type: 'user_message',
    ts: now,
    patternId: 'harness',
    data: { content: input } as UserMessageEventData
  })

  return ctx
}

/** Serialize context to JSON string */
export function serializeContext<T>(ctx: UnifiedContext<T>): string {
  return JSON.stringify(ctx)
}

/** Deserialize context from JSON string */
export function deserializeContext<T>(json: string): UnifiedContext<T> {
  return JSON.parse(json) as UnifiedContext<T>
}

// ============================================================================
// PatternScope Factory
// ============================================================================

/** Create a new PatternScope for pattern execution */
export function createScope<T>(
  patternId: string,
  data: T
): PatternScope<T> {
  return {
    id: patternId,
    events: [],
    data,
    startTime: Date.now()
  }
}

// ============================================================================
// Event Helpers
// ============================================================================

/** Create a context event */
export function createEvent(
  type: EventType,
  patternId: string,
  data: unknown,
  llmCall?: LLMCallData
): ContextEvent {
  return {
    type,
    ts: Date.now(),
    patternId,
    data,
    ...(llmCall && { llmCall })
  }
}

/** Check if an event type should be tracked based on trackHistory config */
export function shouldTrack(type: EventType, trackHistory: TrackHistory): boolean {
  if (typeof trackHistory === 'boolean') {
    return trackHistory
  }
  if (typeof trackHistory === 'string') {
    return trackHistory === type
  }
  if (Array.isArray(trackHistory)) {
    return trackHistory.includes(type)
  }
  return false
}

/** Add event to scope if it should be tracked */
export function trackEvent(
  scope: PatternScope<unknown>,
  type: EventType,
  data: unknown,
  trackHistory: TrackHistory,
  llmCall?: LLMCallData
): void {
  if (shouldTrack(type, trackHistory)) {
    scope.events.push(createEvent(type, scope.id, data, llmCall))
  }
}

// ============================================================================
// Commit Strategies
// ============================================================================

/** Commit scope events to context based on strategy */
export function commitEvents<T>(
  ctx: UnifiedContext<T>,
  scope: PatternScope<unknown>,
  strategy: CommitStrategy
): void {
  switch (strategy) {
    case 'always':
      ctx.events.push(...scope.events)
      break
    case 'on-success':
      if (ctx.status !== 'error') {
        ctx.events.push(...scope.events)
      }
      break
    case 'last':
      if (scope.events.length > 0) {
        ctx.events.push(scope.events.at(-1)!)
      }
      break
    case 'never':
      // Discard all events
      break
  }
}

// ============================================================================
// Pattern Lifecycle Helpers
// ============================================================================

/** Add pattern_enter event to context */
export function enterPattern<T>(
  ctx: UnifiedContext<T>,
  patternId: string,
  patternName: string
): void {
  ctx.events.push({
    type: 'pattern_enter',
    ts: Date.now(),
    patternId,
    data: { pattern: patternName }
  })
}

/** Add pattern_exit event to context */
export function exitPattern<T>(
  ctx: UnifiedContext<T>,
  patternId: string
): void {
  ctx.events.push({
    type: 'pattern_exit',
    ts: Date.now(),
    patternId,
    data: { status: ctx.status, error: ctx.error }
  })
}

// ============================================================================
// Context Status Helpers
// ============================================================================

/** Set context status to error */
export function setError<T>(
  ctx: UnifiedContext<T>,
  error: string,
  patternId = 'unknown'
): void {
  ctx.status = 'error'
  ctx.error = error
  ctx.events.push({
    type: 'error',
    ts: Date.now(),
    patternId,
    data: { error }
  })
}

/** Set context status to done */
export function setDone<T>(ctx: UnifiedContext<T>): void {
  ctx.status = 'done'
}

/** Set context status to paused */
export function setPaused<T>(ctx: UnifiedContext<T>): void {
  ctx.status = 'paused'
}

// ============================================================================
// Default Config Helpers
// ============================================================================

import { DEFAULT_TRACK_HISTORY, DEFAULT_COMMIT_STRATEGY } from './types'

/** Get default trackHistory for a pattern type */
export function getDefaultTrackHistory(patternType: string): TrackHistory {
  return DEFAULT_TRACK_HISTORY[patternType] ?? false
}

/** Get default commitStrategy for a pattern type */
export function getDefaultCommitStrategy(patternType: string): CommitStrategy {
  return DEFAULT_COMMIT_STRATEGY[patternType] ?? 'always'
}

/** Merge pattern config with defaults */
export function resolveConfig(
  patternType: string,
  config?: PatternConfig
): Required<Pick<PatternConfig, 'patternId' | 'commitStrategy' | 'trackHistory'>> & PatternConfig {
  return {
    patternId: config?.patternId ?? generateId(patternType),
    commitStrategy: config?.commitStrategy ?? getDefaultCommitStrategy(patternType),
    trackHistory: config?.trackHistory ?? getDefaultTrackHistory(patternType),
    viewConfig: config?.viewConfig
  }
}
