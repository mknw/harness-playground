/**
 * Router
 *
 * Routes input to patterns based on intent classification.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api'
import { assertServerOnImport } from './assert.server'
import { routeMessageOp } from './routing.server'
import type {
  PatternScope,
  EventView,
  ConfiguredPattern,
  PatternConfig,
  AssistantMessageEventData
} from './types'
import { trackEvent, resolveConfig } from './context.server'

assertServerOnImport()

const tracer = trace.getTracer('harness-patterns.router')

/** Route definitions: name → description */
export type Routes = Record<string, string>

/** Pattern mapping: route name → pattern */
export type RoutePatterns<T> = Record<string, ConfiguredPattern<T>>

export interface RouterData {
  route?: string
  intent?: string
  routerResponse?: string
  response?: string
}

/**
 * Create a router that dispatches to patterns based on intent.
 *
 * @param routes - Route definitions (name → description)
 * @param patterns - Pattern mapping (route name → pattern)
 * @param config - Optional pattern configuration
 *
 * @example
 * const routes = {
 *   neo4j: 'Database queries',
 *   web_search: 'Web lookups'
 * }
 *
 * const r = router(routes, {
 *   neo4j: simpleLoop(b.Neo4jController, tools.neo4j, { patternId: 'neo4j' }),
 *   web_search: simpleLoop(b.WebSearchController, tools.web, { patternId: 'web' })
 * })
 */
export function router<T extends RouterData>(
  routes: Routes,
  patterns: RoutePatterns<T>,
  config?: PatternConfig
): ConfiguredPattern<T> {
  const resolved = resolveConfig('router', config)

  const fn = async (
    scope: PatternScope<T>,
    view: EventView
  ): Promise<PatternScope<T>> => {
    return tracer.startActiveSpan('router', async (span) => {
      span.setAttribute('patternId', scope.id)
      span.setAttribute('routes', Object.keys(routes).join(','))

      try {
        // Get user message from view
        const userMessage = view.messages().last(1).get()[0]
        const userContent = userMessage
          ? (userMessage.data as { content: string }).content
          : ''

        // Route message using BAML
        const result = await routeMessageOp(userContent, [])

        span.setAttribute('intent', result.intent)
        span.setAttribute('toolNeeded', result.tool_call_needed)
        span.setAttribute('route', result.tool_name ?? 'none')

        // No tool needed - return conversational response
        if (!result.tool_call_needed) {
          scope.data = {
            ...scope.data,
            route: undefined,
            intent: result.intent,
            routerResponse: result.response_text,
            response: result.response_text
          }

          // Track assistant message
          trackEvent(
            scope,
            'assistant_message',
            { content: result.response_text } as AssistantMessageEventData,
            resolved.trackHistory
          )

          span.setStatus({ code: SpanStatusCode.OK })
          return scope
        }

        // Find matching pattern
        const routeName = result.tool_name
        if (!routeName) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'No route returned' })
          trackEvent(scope, 'error', { error: 'Router returned tool_call_needed but no tool_name' }, true)
          return scope
        }

        const pattern = patterns[routeName]
        if (!pattern) {
          const errMsg = `No pattern registered for route: ${routeName}. Available: ${Object.keys(patterns).join(', ')}`
          span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg })
          trackEvent(scope, 'error', { error: errMsg }, true)
          return scope
        }

        // Update scope data with routing info
        scope.data = {
          ...scope.data,
          route: routeName,
          intent: result.intent,
          routerResponse: result.response_text
        }

        // Execute the selected pattern
        const patternResult = await pattern.fn(scope, view)

        // Merge results
        scope.events.push(...patternResult.events)
        scope.data = patternResult.data

        // Prepend router response if present
        if (result.response_text && scope.data.response) {
          scope.data = {
            ...scope.data,
            response: `${result.response_text}\n\n${scope.data.response}`
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
  }

  return {
    name: 'router',
    fn,
    config: resolved
  }
}
