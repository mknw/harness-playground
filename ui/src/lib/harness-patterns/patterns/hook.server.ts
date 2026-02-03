/**
 * Hook Pattern
 *
 * Side-effect pattern triggered by lifecycle events.
 * Can run synchronously or as background fire-and-forget.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api'
import { assertServerOnImport } from '../assert.server'
import type {
  PatternScope,
  EventView,
  ConfiguredPattern,
  PatternConfig
} from '../types'
import { resolveConfig } from '../context.server'

assertServerOnImport()

const tracer = trace.getTracer('harness-patterns.hook')

// ============================================================================
// Types
// ============================================================================

export type HookTrigger = 'session_close' | 'error' | 'approval_timeout' | 'custom'

export interface HookConfig extends PatternConfig {
  trigger: HookTrigger
  /** Run async, don't block response */
  background?: boolean
}

// ============================================================================
// Pattern
// ============================================================================

/**
 * Wrap a pattern as a lifecycle hook.
 *
 * Hooks run the wrapped pattern but can optionally run in the background
 * without blocking the main chain. Useful for session cleanup, distillation,
 * logging, etc.
 *
 * @param pattern - The pattern to run as a hook
 * @param config - Hook configuration (trigger, background)
 * @returns ConfiguredPattern ready for chain
 *
 * @example
 * const distillHook = hook(distillChain, {
 *   patternId: 'session-close-hook',
 *   trigger: 'session_close',
 *   background: true
 * })
 */
export function hook<T extends Record<string, unknown>>(
  pattern: ConfiguredPattern<T>,
  config: HookConfig
): ConfiguredPattern<T> {
  const resolved = resolveConfig('hook', config)

  return {
    name: `hook:${config.trigger}(${pattern.name})`,
    fn: async (scope, view) => {
      return tracer.startActiveSpan(`pattern.hook.${config.trigger}`, async (span) => {
        span.setAttribute('patternId', scope.id)
        span.setAttribute('trigger', config.trigger)
        span.setAttribute('background', config.background ?? false)

        try {
          if (config.background) {
            // Fire-and-forget: schedule for execution after response
            queueMicrotask(async () => {
              try {
                await pattern.fn(scope, view)
              } catch (e) {
                console.error(`Hook ${config.trigger} failed:`, e)
              }
            })
            span.setStatus({ code: SpanStatusCode.OK })
            return scope
          }

          // Synchronous: run and wait
          const result = await pattern.fn(scope, view)
          scope.events.push(...result.events)
          scope.data = { ...scope.data, ...result.data }

          span.setStatus({ code: SpanStatusCode.OK })
          return scope
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          span.setStatus({ code: SpanStatusCode.ERROR, message: msg })
          // Hooks should not block the main flow on error
          console.error(`Hook ${config.trigger} error:`, msg)
          return scope
        } finally {
          span.end()
        }
      })
    },
    config: resolved
  }
}
