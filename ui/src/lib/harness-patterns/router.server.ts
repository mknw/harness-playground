/**
 * Router
 *
 * Routes input to patterns based on intent classification.
 */

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
    try {
      // Get user message from view
      const userMessage = view.messages().last(1).get()[0]
      const userContent = userMessage
        ? (userMessage.data as { content: string }).content
        : ''

      // Route message using BAML
      const result = await routeMessageOp(userContent, [])

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

        return scope
      }

      // Find matching pattern
      const routeName = result.tool_name
      if (!routeName) {
        trackEvent(scope, 'error', { error: 'Router returned tool_call_needed but no tool_name' }, true)
        return scope
      }

      const pattern = patterns[routeName]
      if (!pattern) {
        const errMsg = `No pattern registered for route: ${routeName}. Available: ${Object.keys(patterns).join(', ')}`
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

      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      trackEvent(scope, 'error', { error: msg }, true)
      return scope
    }
  }

  return {
    name: 'router',
    fn,
    config: resolved
  }
}
