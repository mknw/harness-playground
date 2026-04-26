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
import type { LoopTurn, PriorResult } from '../../../../baml_client/types'
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
import type { ErrorEventData } from '../types'
import { getErrorHint } from '../error-hints'
import { trackEvent, resolveConfig, generateId } from '../context.server'
import { getRequestSettings } from '../../settings-context.server'
import { trimToFit, getContextWindow } from '../token-budget.server'
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
        const d = event.data as ToolResultEventData
        // Skip hidden/archived results — refs to excluded data stay unresolved
        if (!d.hidden && !d.archived) {
          resolved[key] = d.result
        }
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
  const resolved = resolveConfig('simpleLoop', config)

  const fn = async (
    scope: PatternScope<T>,
    view: EventView
  ): Promise<PatternScope<T>> => {
    const settings = getRequestSettings()
    const maxTurns = config?.maxTurns ?? settings.maxToolTurns
    const data = scope.data
    const turns: LoopTurn[] = []
    let hasError = false
    let errorMessage: string | undefined
    let errorTurn: number | undefined

    // Build structured references to tool results from previous tasks.
    // These are passed as turns_previous_runs (separate from the current task's turns)
    // so the LLM can clearly distinguish prior context from current work.
    // Summaries (populated async after prior responses) are used when available.
    let priorResults: PriorResult[] | undefined
    if (config?.rememberPriorTurns !== false) {
      const turnCount = config?.priorTurnCount ?? settings.priorTurnCount
      const priorEvents = view.fromLastNTurns(turnCount).ofType('tool_result').get()
        .filter(e => {
          const d = e.data as ToolResultEventData
          return !!e.id && !d.hidden && !d.archived
            && (d.success || config?.includeFailedResults)
        })
      if (priorEvents.length > 0) {
        priorResults = priorEvents.map(e => {
          const d = e.data as ToolResultEventData
          const rawResult = typeof d.result === 'string' ? d.result : JSON.stringify(d.result)
          const preview = d.summary ?? rawResult.slice(0, 200).replace(/\n/g, ' ')
          return {
            ref_id: e.id!,
            tool: d.tool,
            summary: preview + (!d.summary && rawResult.length > 200 ? '...' : '')
          }
        })
      }
    }

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        // Trim oldest turns if they would overflow the controller's context window
        const contextWindow = getContextWindow('ControllerFallback')
        // ~500 chars base prompt overhead (template, schema, intent, etc.)
        const trimmedTurns = trimToFit(turns, t => JSON.stringify(t), 500, contextWindow)
        const previousResults = JSON.stringify(trimmedTurns)

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
            priorResults
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
          errorTurn = turn
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
          errorTurn = turn
          break
        }

        // Parse tool args (lenient — LLMs may output unquoted keys/values)
        let args: Record<string, unknown>
        try {
          args = repairJson(action.tool_args)
        } catch {
          hasError = true
          errorMessage = `Invalid tool_args JSON: ${action.tool_args}`
          errorTurn = turn
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
        const MAX_RESULT_CHARS = settings.maxResultChars
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
          errorTurn = turn
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
        // Track error event — downstream patterns read errors via view.errors()
        trackEvent(scope, 'error', {
          error: errorMessage,
          severity: resolved.errorSeverity,
          hint: getErrorHint(errorMessage ?? ''),
          turn: errorTurn,
        } as ErrorEventData, true)
      }

      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      trackEvent(scope, 'error', {
        error: msg,
        severity: resolved.errorSeverity,
        hint: getErrorHint(msg),
      } as ErrorEventData, true)
      return scope
    }
  }

  return {
    name: 'simpleLoop',
    fn,
    config: resolved
  }
}
