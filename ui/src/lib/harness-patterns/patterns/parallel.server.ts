/**
 * Parallel Pattern
 *
 * Execute multiple patterns concurrently via Promise.allSettled, merge events.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api'
import { assertServerOnImport } from '../assert.server'
import type {
  ConfiguredPattern,
  PatternConfig
} from '../types'
import { trackEvent, resolveConfig } from '../context.server'

assertServerOnImport()

const tracer = trace.getTracer('harness-patterns.parallel')

/**
 * Execute multiple patterns concurrently and merge their results.
 *
 * Each branch gets an isolated scope. Fulfilled results are merged;
 * rejected branches are logged as errors.
 *
 * @param patterns - Patterns to execute concurrently
 * @param config - Optional pattern configuration
 * @returns ConfiguredPattern ready for chain
 *
 * @example
 * const research = parallel(
 *   simpleLoop(b.LoopController, tools.web, { patternId: 'web-search' }),
 *   simpleLoop(b.LoopController, tools.github, { patternId: 'github-search' }),
 *   simpleLoop(b.LoopController, tools.context7, { patternId: 'doc-lookup' }),
 * )
 */
export function parallel<T extends Record<string, unknown>>(
  patterns: ConfiguredPattern<T>[],
  config?: PatternConfig
): ConfiguredPattern<T> {
  const resolved = resolveConfig('parallel', config ?? { patternId: 'parallel' })

  return {
    name: 'parallel',
    fn: async (scope, view) => {
      return tracer.startActiveSpan('pattern.parallel', async (span) => {
        span.setAttribute('patternId', scope.id)
        span.setAttribute('branchCount', patterns.length)

        try {
          // Each branch gets an isolated scope with empty events
          const results = await Promise.allSettled(
            patterns.map((p) =>
              p.fn(
                { ...scope, id: p.config.patternId ?? p.name, events: [], startTime: Date.now() },
                view
              )
            )
          )

          // Merge fulfilled events; log rejected branches
          for (const [i, r] of results.entries()) {
            if (r.status === 'fulfilled') {
              scope.events.push(...r.value.events)
              scope.data = { ...scope.data, ...r.value.data }
            } else {
              trackEvent(scope, 'error', {
                error: `Branch ${patterns[i].name} failed: ${r.reason}`
              }, true)
            }
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
    },
    config: resolved
  }
}
