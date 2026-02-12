/**
 * Simple Loop Pattern
 *
 * ReAct-style decide-execute loop.
 * Calls BAML controller function directly, extracting params from context.
 */

import { Collector } from '@boundaryml/baml'
import { assertServerOnImport } from '../assert.server'
import { callTool } from '../mcp-client.server'
import { repairJson } from '../json-repair'
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
  /** Whether an error occurred during loop execution */
  hasError?: boolean
  /** Error message if hasError is true */
  errorMessage?: string
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
        const collector = new Collector('simpleLoop')
        const { action, llmCall } = await controller(
          userContent,
          intent,
          previousResults,
          turn,
          config?.schema,
          collector
        )

        // Track controller action event with LLM call data
        trackEvent(
          scope,
          'controller_action',
          { action } as ControllerActionEventData,
          resolved.trackHistory,
          llmCall
        )

        // Check if done (is_final flag OR tool_name === 'Return')
        if (action.is_final || action.tool_name === 'Return') {
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

        // Parse tool args (lenient — LLMs may output unquoted keys/values)
        let args: Record<string, unknown>
        try {
          args = repairJson(action.tool_args)
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

        // Propagate error state to scope.data for downstream patterns
        scope.data = {
          ...scope.data,
          hasError: true,
          errorMessage,
          results  // Include partial results
        }
      }

      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      trackEvent(scope, 'error', { error: msg }, true)

      // Propagate error state to scope.data for downstream patterns
      scope.data = {
        ...scope.data,
        hasError: true,
        errorMessage: msg,
        results  // Include partial results
      }

      return scope
    }
  }

  return {
    name: 'simpleLoop',
    fn,
    config: resolved
  }
}
