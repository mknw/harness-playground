/**
 * Router
 *
 * Routes input to patterns based on intent classification.
 */

import { assertServerOnImport } from './assert.server'
import { routeMessageOp } from './routing.server'
import { Collector } from '@boundaryml/baml'
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

      // Convert routes Record<string,string> to Array<{name,description}>
      const routeArray = Object.entries(routes).map(([name, description]) => ({
        name,
        description
      }))

      // Route message using BAML with collector for observability
      const collector = new Collector('router')
      const result = await routeMessageOp(userContent, [], routeArray, collector)

      // No tool needed - return conversational response
      if (!result.tool_call_needed) {
        const responseText = result.response_text || ''
        scope.data = {
          ...scope.data,
          route: undefined,
          intent: result.intent,
          routerResponse: responseText,
          response: responseText
        }

        // Track assistant message with LLM call data
        trackEvent(
          scope,
          'assistant_message',
          { content: responseText } as AssistantMessageEventData,
          resolved.trackHistory,
          result.llmCall
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

      // Track the routing decision as an assistant message with LLM data
      const statusText = result.response_text || ''
      if (statusText) {
        trackEvent(
          scope,
          'assistant_message',
          { content: statusText } as AssistantMessageEventData,
          resolved.trackHistory,
          result.llmCall
        )
      }

      // Update scope data with routing info
      scope.data = {
        ...scope.data,
        route: routeName,
        intent: result.intent,
        routerResponse: statusText
      }

      // Execute the selected pattern
      const patternResult = await pattern.fn(scope, view)

      // Merge results
      scope.events.push(...patternResult.events)
      scope.data = patternResult.data

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
