/**
 * Synthesizer Pattern
 *
 * Synthesizes a final response from previous pattern's output.
 * Three modes: 'message', 'response', 'thread'
 */

import { trace, SpanStatusCode } from '@opentelemetry/api'
import { assertServerOnImport } from '../assert.server'
import type {
  SynthesizerConfig,
  SynthesizerData,
  SynthesizerInput,
  SynthesisFn,
  LoopHistory,
  PatternScope,
  EventView,
  ConfiguredPattern,
  AssistantMessageEventData
} from '../types'
import { trackEvent, resolveConfig } from '../context.server'

assertServerOnImport()

const tracer = trace.getTracer('harness-patterns.synthesizer')

/**
 * Format loop history for LLM consumption.
 */
function formatLoopHistory(history: LoopHistory): string {
  const lines: string[] = []

  for (const iteration of history.iterations) {
    lines.push(`<turn n="${iteration.turn}">`)
    lines.push(`  <action>`)
    lines.push(`    <tool>${iteration.action.tool_name}</tool>`)
    lines.push(`    <args>${iteration.action.tool_args}</args>`)
    lines.push(`    <reasoning>${iteration.action.reasoning}</reasoning>`)
    lines.push(`  </action>`)
    lines.push(`  <result>${JSON.stringify(iteration.result)}</result>`)
    lines.push(`</turn>`)
  }

  return lines.join('\n')
}

/**
 * Default synthesis function using BAML CreateToolResponse.
 */
async function defaultSynthesize(input: SynthesizerInput): Promise<string> {
  // Dynamic import to avoid circular dependencies
  const { b } = await import('../../../../baml_client')

  // Format tool_events based on mode
  let toolEvents: string

  switch (input.mode) {
    case 'message':
      // Just the response string
      toolEvents = input.response ?? ''
      break

    case 'response':
      // Object with data and response
      toolEvents = JSON.stringify(
        {
          response: input.response,
          data: input.data
        },
        null,
        2
      )
      break

    case 'thread':
      // Full loop history
      toolEvents = input.loopHistory ? formatLoopHistory(input.loopHistory) : (input.response ?? '')
      break
  }

  return b.CreateToolResponse(toolEvents, input.userMessage, input.intent)
}

/**
 * Build synthesis input from EventView based on mode.
 */
function buildSynthesisInputFromView(
  mode: SynthesizerConfig['mode'],
  view: EventView,
  data: SynthesizerData
): SynthesizerInput {
  // Get user message
  const userMessage = view.fromAll().ofType('user_message').last(1).get()[0]
  const userContent = userMessage
    ? (userMessage.data as { content: string }).content
    : ''

  const input: SynthesizerInput = {
    mode,
    userMessage: userContent,
    intent: data.intent ?? userContent
  }

  switch (mode) {
    case 'message':
      // Just the response string from previous pattern
      input.response = data.response ?? ''
      break

    case 'response':
      // Include data and response
      input.response = data.response
      input.data = data
      break

    case 'thread':
      // Get tool events from view for thread reconstruction
      const toolEvents = view.fromLastPattern().tools().get()
      const actionEvents = view.fromLastPattern().actions().get()

      // Build loop history from events if available
      if (toolEvents.length > 0 || actionEvents.length > 0) {
        const iterations: LoopHistory['iterations'] = []
        let turn = 0

        for (const event of view.fromLastPattern().get()) {
          if (event.type === 'controller_action') {
            const actionData = event.data as { action: import('../types').ControllerAction }
            iterations.push({
              turn: turn++,
              action: actionData.action,
              result: null,
              timestamp: event.ts
            })
          } else if (event.type === 'tool_result' && iterations.length > 0) {
            const resultData = event.data as { result: unknown }
            iterations[iterations.length - 1].result = resultData.result
          }
        }

        input.loopHistory = {
          iterations,
          startTime: toolEvents[0]?.ts ?? Date.now(),
          endTime: Date.now()
        }
      }

      // Fallback to data.loopHistory if available
      if (!input.loopHistory && data.loopHistory) {
        input.loopHistory = data.loopHistory
      }

      input.response = data.response
      break
  }

  return input
}

/**
 * Create a synthesizer pattern.
 *
 * Takes output from previous pattern and synthesizes a final response.
 *
 * @param config - Synthesizer configuration
 * @returns ConfiguredPattern ready for chain
 *
 * @example
 * // Message mode - just the response string
 * const s1 = synthesizer({ mode: 'message' })
 *
 * // Response mode - object with data and response
 * const s2 = synthesizer({ mode: 'response' })
 *
 * // Thread mode - full iteration history
 * const s3 = synthesizer({ mode: 'thread' })
 *
 * // Custom synthesis function
 * const s4 = synthesizer({
 *   mode: 'response',
 *   synthesize: async (input) => `Processed: ${input.response}`
 * })
 */
export function synthesizer<T extends SynthesizerData>(
  config: SynthesizerConfig
): ConfiguredPattern<T> {
  const { mode, synthesize = defaultSynthesize, skipIfHasResponse = false } = config
  const resolved = resolveConfig('synthesizer', config)

  const fn = async (
    scope: PatternScope<T>,
    view: EventView
  ): Promise<PatternScope<T>> => {
    return tracer.startActiveSpan('pattern.synthesizer', async (span) => {
      span.setAttribute('patternId', scope.id)
      span.setAttribute('mode', mode)

      try {
        // Skip if already has synthesized response
        if (skipIfHasResponse && scope.data.synthesizedResponse) {
          span.addEvent('synthesizer.skipped', { reason: 'hasSynthesizedResponse' })
          span.setStatus({ code: SpanStatusCode.OK })
          return scope
        }

        // Build input from view
        const input = buildSynthesisInputFromView(mode, view, scope.data)

        // Validate thread mode
        if (mode === 'thread' && !input.loopHistory) {
          span.addEvent('synthesizer.warning', {
            message: 'thread mode but no loopHistory, falling back to response mode'
          })
          input.mode = 'response'
          input.data = scope.data
        }

        span.addEvent('synthesizer.start', {
          hasResponse: !!input.response,
          hasLoopHistory: !!input.loopHistory
        })

        // Call synthesis function
        const synthesizedResponse = await tracer.startActiveSpan(
          'synthesizer.synthesize',
          async (synthSpan) => {
            try {
              const result = await synthesize(input)
              synthSpan.setStatus({ code: SpanStatusCode.OK })
              return result
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error)
              synthSpan.setStatus({ code: SpanStatusCode.ERROR, message: msg })
              throw error
            } finally {
              synthSpan.end()
            }
          }
        )

        // Track assistant message event
        trackEvent(
          scope,
          'assistant_message',
          { content: synthesizedResponse } as AssistantMessageEventData,
          resolved.trackHistory
        )

        scope.data = {
          ...scope.data,
          response: synthesizedResponse,
          synthesizedResponse
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
    name: 'synthesizer',
    fn,
    config: resolved
  }
}
