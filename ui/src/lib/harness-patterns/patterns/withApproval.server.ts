/**
 * Approval Wrapper Pattern
 *
 * Wraps a pattern to pause for user approval on matching actions.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api'
import { assertServerOnImport } from '../assert.server'
import type {
  ControllerAction,
  WithApproval,
  ApprovalRequest,
  PatternScope,
  EventView,
  ConfiguredPattern,
  PatternConfig,
  ApprovalRequestEventData,
  ApprovalResponseEventData
} from '../types'
import { trackEvent, resolveConfig, createScope } from '../context.server'

assertServerOnImport()

const tracer = trace.getTracer('harness-patterns.withApproval')

/**
 * Predicate to determine if an action needs approval.
 */
export type ApprovalPredicate = (action: ControllerAction) => boolean

/** Data interface that includes approval state */
export interface WithApprovalData extends WithApproval {
  lastAction?: ControllerAction
  response?: string
}

/**
 * Wrap a ConfiguredPattern to pause for approval on certain actions.
 *
 * When an action matches the predicate:
 * 1. Pattern pauses with status 'paused'
 * 2. pendingAction is set in ctx.data
 * 3. Caller must resume with ctx.data.approved = true/false
 *
 * @param wrappedPattern - The pattern to wrap
 * @param predicate - Function to determine if action needs approval
 * @param config - Optional pattern configuration
 * @returns ConfiguredPattern ready for chain
 *
 * @example
 * const safeLoop = withApproval(
 *   simpleLoop(b.Neo4jController, tools.neo4j, { schema }),
 *   approvalPredicates.writes
 * )
 */
export function withApproval<T extends WithApprovalData>(
  wrappedPattern: ConfiguredPattern<T>,
  predicate: ApprovalPredicate,
  config?: PatternConfig
): ConfiguredPattern<T> {
  const resolved = resolveConfig('withApproval', config)

  const fn = async (
    scope: PatternScope<T>,
    view: EventView
  ): Promise<PatternScope<T>> => {
    return tracer.startActiveSpan('pattern.withApproval', async (span) => {
      span.setAttribute('patternId', scope.id)
      span.setAttribute('wrappedPattern', wrappedPattern.name)

      try {
        // Check if resuming from approval
        if (scope.data.pendingAction && scope.data.approved !== undefined) {
          span.addEvent('approval.resume', { approved: scope.data.approved })

          // Track approval response
          trackEvent(
            scope,
            'approval_response',
            { approved: scope.data.approved } as ApprovalResponseEventData,
            resolved.trackHistory
          )

          if (!scope.data.approved) {
            scope.data = {
              ...scope.data,
              pendingAction: undefined,
              approved: undefined,
              response: 'Operation cancelled by user.'
            }
            span.setStatus({ code: SpanStatusCode.OK })
            return scope
          }

          // Clear approval state and continue
          scope.data = {
            ...scope.data,
            pendingAction: undefined,
            approved: undefined
          }
        }

        // Create a child scope for the wrapped pattern
        const childScope = createScope<T>(wrappedPattern.config.patternId!, scope.data)

        // Execute wrapped pattern
        const result = await wrappedPattern.fn(childScope, view)

        // Merge child events into our scope (respecting our commit strategy)
        scope.events.push(...result.events)
        scope.data = result.data

        // Check if any action needs approval
        const lastAction = scope.data.lastAction

        if (lastAction && predicate(lastAction)) {
          const pendingAction: ApprovalRequest = {
            action: lastAction.tool_name,
            payload: lastAction.tool_args,
            reason: lastAction.status || `Action "${lastAction.tool_name}" requires approval`
          }

          // Track approval request
          trackEvent(
            scope,
            'approval_request',
            { request: pendingAction } as ApprovalRequestEventData,
            resolved.trackHistory
          )

          scope.data = { ...scope.data, pendingAction }
          span.addEvent('approval.required', { action: lastAction.tool_name })
          span.setStatus({ code: SpanStatusCode.OK })
          return scope
        }

        span.setStatus({ code: SpanStatusCode.OK })
        return scope
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: msg })
        trackEvent(scope, 'error', { error: msg }, true)
        return scope
      } finally {
        span.end()
      }
    })
  }

  return {
    name: 'withApproval',
    fn,
    config: resolved
  }
}

/**
 * Common approval predicates.
 */
export const approvalPredicates = {
  /** Approve any write operation */
  writes: (action: ControllerAction) => action.tool_name.toLowerCase().includes('write'),

  /** Approve any delete operation */
  deletes: (action: ControllerAction) => action.tool_name.toLowerCase().includes('delete'),

  /** Approve any mutation (write, delete, create, update) */
  mutations: (action: ControllerAction) => {
    const name = action.tool_name.toLowerCase()
    return ['write', 'delete', 'create', 'update', 'insert', 'remove'].some((m) =>
      name.includes(m)
    )
  }
}
