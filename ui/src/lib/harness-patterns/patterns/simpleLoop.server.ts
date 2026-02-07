/**
 * Simple Loop Pattern
 *
 * ReAct-style decide-execute loop.
 * Calls BAML controller function directly, extracting params from context.
 */

import { assertServerOnImport } from '../assert.server'
import { callTool } from '../mcp-client.server'
import type {
  ControllerAction,
  SimpleLoopConfig,
  PatternScope,
  EventView,
  ConfiguredPattern,
  ToolCallEventData,
  ToolResultEventData,
  ControllerActionEventData
} from '../types'
import { MAX_TOOL_TURNS } from '../types'
import { trackEvent, resolveConfig } from '../context.server'
import type { ControllerFnWithLLMData } from '../baml-adapters.server'

assertServerOnImport()

export interface SimpleLoopData {
  turn?: number
  intent?: string
  lastAction?: ControllerAction
  lastResult?: unknown
  results?: unknown[]
  response?: string
}

/**
 * Create a simple loop pattern.
 *
 * Calls the BAML controller function directly, extracting params from context.
 *
 * @param controller - BAML controller function (e.g., b.Neo4jController)
 * @param tools - Allowed tool names
 * @param config - Optional configuration (schema, maxTurns, patternId, etc.)
 * @returns ConfiguredPattern ready for chain
 *
 * @example
 * const loop = simpleLoop(b.Neo4jController, tools.neo4j, {
 *   patternId: 'neo4j-query',
 *   schema,
 *   trackHistory: 'tool_result',
 *   commitStrategy: 'on-success'
 * })
 */
export function simpleLoop<T extends SimpleLoopData>(
  controller: ControllerFnWithLLMData,
  tools: string[],
  config?: SimpleLoopConfig
): ConfiguredPattern<T> {
  const maxTurns = config?.maxTurns ?? MAX_TOOL_TURNS
  const resolved = resolveConfig('simpleLoop', config)

  const fn = async (
    scope: PatternScope<T>,
    view: EventView
  ): Promise<PatternScope<T>> => {
    const data = scope.data
    const results: unknown[] = [...(data.results ?? [])]
    let hasError = false
    let errorMessage: string | undefined

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        // Get previous results from view (serialized for LLM)
        const previousFromView = view.tools().serialize()
        const previousResults = previousFromView || JSON.stringify(results)

        // Extract intent from data or use input from view
        const userMessage = view.messages().last(1).get()[0]
        const userContent = userMessage
          ? (userMessage.data as { content: string }).content
          : ''
        const intent = data.intent ?? userContent

        // Call BAML controller
        const { action, llmCall } = await controller(
          userContent,
          intent,
          previousResults,
          turn,
          config?.schema
        )

        // Track controller action event with LLM call data
        trackEvent(
          scope,
          'controller_action',
          { action } as ControllerActionEventData,
          resolved.trackHistory,
          llmCall
        )

        // Check if done
        if (action.is_final) {
          scope.data = {
            ...scope.data,
            lastAction: action,
            results,
            turn
          }
          break
        }

        // Validate tool
        if (!tools.includes(action.tool_name)) {
          hasError = true
          errorMessage = `Tool not allowed: ${action.tool_name}. Allowed: ${tools.join(', ')}`
          break
        }

        // Parse tool args
        let args: Record<string, unknown>
        try {
          args = JSON.parse(action.tool_args)
        } catch {
          hasError = true
          errorMessage = `Invalid tool_args JSON: ${action.tool_args}`
          break
        }

        // Track tool call event
        trackEvent(
          scope,
          'tool_call',
          { tool: action.tool_name, args } as ToolCallEventData,
          resolved.trackHistory
        )

        // Execute tool
        const result = await callTool(action.tool_name, args)
        results.push(result.data)

        // Track tool result event
        trackEvent(
          scope,
          'tool_result',
          {
            tool: action.tool_name,
            result: result.data,
            success: result.success,
            error: result.error
          } as ToolResultEventData,
          resolved.trackHistory
        )

        if (!result.success) {
          hasError = true
          errorMessage = result.error ?? 'Tool call failed'
          break
        }

        // Update scope data
        scope.data = {
          ...scope.data,
          turn,
          lastAction: action,
          lastResult: result.data,
          results
        }
      }

      if (hasError) {
        // Track error event
        trackEvent(scope, 'error', { error: errorMessage }, true)
      }

      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      trackEvent(scope, 'error', { error: msg }, true)
      return scope
    }
  }

  return {
    name: 'simpleLoop',
    fn,
    config: resolved
  }
}
