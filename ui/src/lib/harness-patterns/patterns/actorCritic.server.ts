/**
 * Actor-Critic Pattern
 *
 * Generate-evaluate loop with retry on failure.
 * Designed for code mode: generates scripts, executes them, evaluates results.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api'
import { assertServerOnImport } from '../assert.server'
import { callTool } from '../mcp-client.server'
import type {
  CodeModeControllerFn,
  CriticFn,
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

assertServerOnImport()

const tracer = trace.getTracer('harness-patterns.actorCritic')

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
  actor: CodeModeControllerFn,
  critic: CriticFn,
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
    return tracer.startActiveSpan('pattern.actorCritic', async (span) => {
      span.setAttribute('patternId', scope.id)
      span.setAttribute('maxRetries', maxRetries)
      span.setAttribute('tools', tools.join(','))

      const previousAttempts: ScriptExecutionEvent[] = []
      let errorMessage: string | undefined

      try {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          span.addEvent('attempt.start', { attempt })

          // Get user message from view
          const userMessage = view.messages().last(1).get()[0]
          const userContent = userMessage
            ? (userMessage.data as { content: string }).content
            : ''
          const intent = scope.data.intent ?? userContent

          // Call actor
          const action = await tracer.startActiveSpan('actor', async (actorSpan) => {
            actorSpan.setAttribute('attempt', attempt)
            try {
              const result = await actor(userContent, intent, availableTools, previousAttempts)
              actorSpan.setStatus({ code: SpanStatusCode.OK })
              return result
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error)
              actorSpan.setStatus({ code: SpanStatusCode.ERROR, message: msg })
              throw error
            } finally {
              actorSpan.end()
            }
          })

          // Track controller action
          trackEvent(
            scope,
            'controller_action',
            { action } as ControllerActionEventData,
            resolved.trackHistory
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
          const evaluation = await tracer.startActiveSpan('critic', async (criticSpan) => {
            criticSpan.setAttribute('attempt', attempt)
            try {
              const evalResult = await critic(intent, previousAttempts)
              criticSpan.setAttribute('sufficient', evalResult.is_sufficient)
              criticSpan.setStatus({ code: SpanStatusCode.OK })

              // Track critic result
              trackEvent(
                scope,
                'critic_result',
                { result: evalResult } as CriticResultEventData,
                resolved.trackHistory
              )

              return {
                ok: evalResult.is_sufficient,
                feedback: evalResult.is_sufficient
                  ? undefined
                  : evalResult.suggested_approach ?? evalResult.explanation
              }
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error)
              criticSpan.setStatus({ code: SpanStatusCode.ERROR, message: msg })
              throw error
            } finally {
              criticSpan.end()
            }
          })

          if (evaluation.ok) {
            scope.data = {
              ...scope.data,
              attempt,
              lastAction: action,
              result: result.data
            }
            span.setStatus({ code: SpanStatusCode.OK })
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

        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage })
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
    name: 'actorCritic',
    fn,
    config: resolved
  }
}
