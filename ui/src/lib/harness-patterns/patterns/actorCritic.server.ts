/**
 * Actor-Critic Pattern
 *
 * Generate-evaluate loop with retry on failure.
 * Designed for code mode: generates scripts, executes them, evaluates results.
 */

import { assertServerOnImport } from '../assert.server'
import { callTool } from '../mcp-client.server'
import type {
  ControllerAction,
  ActorCriticConfig,
  ScriptExecutionEvent,
  PatternScope,
  EventView,
  ConfiguredPattern,
  ToolCallEventData,
  ToolResultEventData,
  ControllerActionEventData,
  CriticResultEventData
} from '../types'
import { MAX_RETRIES } from '../types'
import { trackEvent, resolveConfig } from '../context.server'
import type { CodeModeControllerFnWithLLMData, CriticFnWithLLMData } from '../baml-adapters.server'

assertServerOnImport()

export interface ActorCriticData {
  attempt?: number
  intent?: string
  lastAction?: ControllerAction
  lastResult?: unknown
  feedback?: string
  result?: unknown
  results?: unknown[]
  response?: string
}

/**
 * Create an actor-critic pattern.
 *
 * Calls BAML controller and critic functions directly for code mode workflows.
 *
 * @param actor - BAML controller function (e.g., b.CodeModeController)
 * @param critic - BAML critic function (e.g., b.CodeModeCritic)
 * @param tools - Allowed tool names
 * @param config - Configuration (availableTools, maxRetries, patternId, etc.)
 * @returns ConfiguredPattern ready for chain
 *
 * @example
 * const loop = actorCritic(b.CodeModeController, b.CodeModeCritic, tools.all, {
 *   patternId: 'code-mode',
 *   availableTools,
 *   maxRetries: 3
 * })
 */
export function actorCritic<T extends ActorCriticData>(
  actor: CodeModeControllerFnWithLLMData,
  critic: CriticFnWithLLMData,
  tools: string[],
  config?: ActorCriticConfig
): ConfiguredPattern<T> {
  const maxRetries = config?.maxRetries ?? MAX_RETRIES
  const availableTools = config?.availableTools ?? tools
  const resolved = resolveConfig('actorCritic', config)

  const fn = async (
    scope: PatternScope<T>,
    view: EventView
  ): Promise<PatternScope<T>> => {
    const previousAttempts: ScriptExecutionEvent[] = []
    let errorMessage: string | undefined

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Get user message from view
        const userMessage = view.messages().last(1).get()[0]
        const userContent = userMessage
          ? (userMessage.data as { content: string }).content
          : ''
        const intent = scope.data.intent ?? userContent

        // Call actor
        const { action, llmCall: actorLlmCall } = await actor(userContent, intent, availableTools, previousAttempts)

        // Track controller action with LLM call data
        trackEvent(
          scope,
          'controller_action',
          { action } as ControllerActionEventData,
          resolved.trackHistory,
          actorLlmCall
        )

        // Validate tool
        if (!tools.includes(action.tool_name)) {
          previousAttempts.push({
            script: '',
            output: '',
            error: `Tool not allowed: ${action.tool_name}`
          })
          continue
        }

        // Parse args
        let args: Record<string, unknown>
        try {
          args = JSON.parse(action.tool_args)
        } catch {
          previousAttempts.push({
            script: '',
            output: '',
            error: `Invalid tool_args JSON: ${action.tool_args}`
          })
          continue
        }

        // Track tool call
        trackEvent(
          scope,
          'tool_call',
          { tool: action.tool_name, args } as ToolCallEventData,
          resolved.trackHistory
        )

        // Execute tool
        const result = await callTool(action.tool_name, args)

        // Track result
        const script = typeof args.script === 'string' ? args.script : JSON.stringify(args)
        previousAttempts.push({
          script,
          output: result.success ? JSON.stringify(result.data) : '',
          error: result.success ? null : (result.error ?? 'Execution failed')
        })

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
          continue
        }

        // Call critic
        const { result: evalResult, llmCall: criticLlmCall } = await critic(intent, previousAttempts)

        // Track critic result with LLM call data
        trackEvent(
          scope,
          'critic_result',
          { result: evalResult } as CriticResultEventData,
          resolved.trackHistory,
          criticLlmCall
        )

        const evaluation = {
          ok: evalResult.is_sufficient,
          feedback: evalResult.is_sufficient
            ? undefined
            : evalResult.suggested_approach ?? evalResult.explanation
        }

        if (evaluation.ok) {
          scope.data = {
            ...scope.data,
            attempt,
            lastAction: action,
            result: result.data
          }
          return scope
        }

        // Update for next attempt
        scope.data = {
          ...scope.data,
          attempt,
          lastAction: action,
          lastResult: result.data,
          feedback: evaluation.feedback
        }
      }

      // Exhausted retries
      errorMessage = `Max retries (${maxRetries}) exceeded`
      trackEvent(scope, 'error', { error: errorMessage }, true)

      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      trackEvent(scope, 'error', { error: msg }, true)
      return scope
    }
  }

  return {
    name: 'actorCritic',
    fn,
    config: resolved
  }
}
