/**
 * Pattern Exports
 */

// Patterns
export { simpleLoop, type SimpleLoopData } from './simpleLoop.server'
export { actorCritic, type ActorCriticData } from './actorCritic.server'
export { withApproval, approvalPredicates, type ApprovalPredicate, type WithApprovalData } from './withApproval.server'
export { chain, configurePattern } from './chain.server'
export { synthesizer } from './synthesizer.server'

// EventView
export { EventViewImpl, createEventView } from './event-view.server'

// Re-export config types from main types
export type {
  SimpleLoopConfig,
  ActorCriticConfig,
  SynthesizerConfig,
  SynthesizerMode,
  SynthesizerInput,
  SynthesisFn,
  SynthesizerData,
  LoopHistory,
  LoopIteration,
  PatternConfig,
  ViewConfig,
  CommitStrategy,
  TrackHistory,
  ConfiguredPattern,
  ScopedPattern,
  PatternScope,
  EventView,
  UnifiedContext,
  ContextEvent,
  EventType
} from '../types'
