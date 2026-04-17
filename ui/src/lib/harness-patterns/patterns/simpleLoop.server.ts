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
import type { LoopTurn } from '../../../../baml_client/types'
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
import { trackEvent, resolveConfig, generateId } from '../context.server'
import type { ControllerFnWithLLMData } from '../baml-adapters.server'

assertServerOnImport()

// ============================================================================
// Reference Resolution
// ============================================================================

/**
 * Resolve `ref:<eventId>` values in tool args by expanding them
 * to the full tool result data from the UnifiedContext.
 */
function resolveRefs(
  args: Record<string, unknown>,
  view: EventView
): Record<string, unknown> {
  const resolved = { ...args }
  const allEvents = view.fromAll().get()
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && value.startsWith('ref:')) {
      const eventId = value.slice(4)
      const event = allEvents.find(e => e.id === eventId)
      if (event && event.type === 'tool_result') {
        resolved[key] = (event.data as ToolResultEventData).result
      }
    }
  }
  return resolved
}

export interface SimpleLoopData {
  turn?: number
  intent?: string
  lastAction?: ControllerAction
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
    const turns: LoopTurn[] = []
    let hasError = false
    let errorMessage: string | undefined

    // Build prior tool context from previous turns (compact pointers for older results)
    const priorToolContext = view.fromAll().tools().serializeCompact({ recentTurns: 0 }) || undefined

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        // Build previous results as LoopTurn[] JSON for the controller
        const previousResults = JSON.stringify(turns)

        // Extract intent from data or use input from view
        // Use ofType('user_message') to get the actual user query, not the router's assistant_message
        const userMessage = view.ofType('user_message').last(1).get()[0]
        const userContent = userMessage
          ? (userMessage.data as { content: string }).content
          : ''
        const intent = data.intent ?? userContent

        // Call BAML controller — catch validation errors gracefully
        // so partial results from earlier turns are preserved
        let action: ControllerAction
        const collector = new Collector('simpleLoop')
        try {
          const controllerResult = await controller(
            userContent,
            intent,
            previousResults,
            turn,
            config?.schema,
            collector,
            priorToolContext
          )
          action = controllerResult.action

          // Track controller action event with LLM call data
          trackEvent(
            scope,
            'controller_action',
            { action } as ControllerActionEventData,
            resolved.trackHistory,
            controllerResult.llmCall
          )
        } catch (controllerError) {
          const msg = controllerError instanceof Error ? controllerError.message : String(controllerError)
          // Exit loop gracefully with partial results instead of losing everything
          hasError = true
          errorMessage = msg
          break
        }

        // Check if done (is_final flag OR tool_name === 'Return')
        if (action.is_final || action.tool_name === 'Return') {
          scope.data = {
            ...scope.data,
            lastAction: action,
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

        // Generate correlation ID for this tool call/result pair
        const callId = generateId('tc')

        // Resolve ref: pointers in args (expands to full tool result data from prior events)
        const resolvedArgs = resolveRefs(args, view)

        // Track tool call event (with original args for readability)
        trackEvent(
          scope,
          'tool_call',
          { callId, tool: action.tool_name, args } as ToolCallEventData,
          resolved.trackHistory
        )

        // Execute tool with resolved args
        const result = await callTool(action.tool_name, resolvedArgs)

        // Track tool result event
        trackEvent(
          scope,
          'tool_result',
          {
            callId,
            tool: action.tool_name,
            result: result.data,
            success: result.success,
            error: result.error
          } as ToolResultEventData,
          resolved.trackHistory
        )

        // Record completed turn for LoopController history.
        // Truncate result to avoid overflowing reasoning models on subsequent turns.
        const MAX_RESULT_CHARS = 2000
        const resultStr = JSON.stringify(result.data)
        turns.push({
          n: turn,
          reasoning: action.reasoning,
          tool_call: { tool: action.tool_name, args: action.tool_args },
          tool_result: {
            tool: action.tool_name,
            result: resultStr.length > MAX_RESULT_CHARS
              ? resultStr.slice(0, MAX_RESULT_CHARS) + '…[truncated]'
              : resultStr,
            success: result.success,
            error: result.error ?? null
          }
        })

        if (!result.success) {
          hasError = true
          errorMessage = result.error ?? 'Tool call failed'
          break
        }

        // Update scope data
        scope.data = {
          ...scope.data,
          turn,
          lastAction: action
        }
      }

      if (hasError) {
        // Track error event
        trackEvent(scope, 'error', { error: errorMessage }, true)

        // Propagate error state to scope.data for downstream patterns
        scope.data = {
          ...scope.data,
          hasError: true,
          errorMessage
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
        errorMessage: msg
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
