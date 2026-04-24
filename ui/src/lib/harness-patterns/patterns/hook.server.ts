/**
 * Hook Pattern
 *
 * Side-effect pattern triggered by lifecycle events.
 * Can run synchronously or as background fire-and-forget.
 */

import { assertServerOnImport } from '../assert.server'
import type {
  ConfiguredPattern,
  PatternConfig
} from '../types'
import { resolveConfig, createEvent } from '../context.server'

assertServerOnImport()

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
          return scope
        }

        // Synchronous: run and wait
        const beforeLen = scope.events.length
        const result = await pattern.fn(scope, view)

        // Wrap inner pattern events with enter/exit markers
        const innerPatternId = pattern.config.patternId ?? pattern.name
        const innerEvents = result.events.splice(beforeLen)
        result.events.push(createEvent('pattern_enter', innerPatternId, { pattern: pattern.name }))
        result.events.push(...innerEvents)
        result.events.push(createEvent('pattern_exit', innerPatternId, { status: 'completed' }))
        scope.data = { ...scope.data, ...result.data }

        return scope
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        // Hooks should not block the main flow on error
        console.error(`Hook ${config.trigger} error:`, msg)
        return scope
      }
    },
    config: resolved
  }
}
