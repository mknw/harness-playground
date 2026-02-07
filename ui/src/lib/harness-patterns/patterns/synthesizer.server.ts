/**
 * Synthesizer Pattern
 *
 * Synthesizes a final response from previous pattern's output.
 * Three modes: 'message', 'response', 'thread'
 */

import { assertServerOnImport } from '../assert.server'
import type {
  SynthesizerConfig,
  SynthesizerData,
  SynthesizerInput,
  LoopHistory,
  PatternScope,
  EventView,
  ConfiguredPattern,
  AssistantMessageEventData
} from '../types'
import { trackEvent, resolveConfig } from '../context.server'

assertServerOnImport()

/**
 * Default synthesis function using BAML Synthesize.
 */
async function defaultSynthesize(input: SynthesizerInput): Promise<string> {
  // Dynamic import to avoid circular dependencies
  const { b } = await import('../../../../baml_client')

  // Convert to LoopTurn format for BAML Synthesize
  const turns: import('../../../../baml_client/types').LoopTurn[] = []

  if (input.loopHistory) {
    // Convert loop history to LoopTurn array
    for (const iteration of input.loopHistory.iterations) {
      turns.push({
        n: iteration.turn,
        reasoning: iteration.action.reasoning,
        tool_call: {
          tool: iteration.action.tool_name,
          args: iteration.action.tool_args
        },
        tool_result: {
          tool: iteration.action.tool_name,
          result: JSON.stringify(iteration.result),
          success: true
        }
      })
    }
  } else if (input.response) {
    // Create a single turn with the response as a result
    turns.push({
      n: 0,
      reasoning: 'Direct response',
      tool_result: {
        tool: 'response',
        result: input.response,
        success: true
      }
    })
  }

  return b.Synthesize(input.userMessage, input.intent, turns)
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

    case 'thread': {
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
    try {
      // Skip if already has synthesized response
      if (skipIfHasResponse && scope.data.synthesizedResponse) {
        return scope
      }

      // Build input from view
      const input = buildSynthesisInputFromView(mode, view, scope.data)

      // Validate thread mode
      if (mode === 'thread' && !input.loopHistory) {
        input.mode = 'response'
        input.data = scope.data
      }

      // Call synthesis function
      const synthesizedResponse = await synthesize(input)

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

      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      trackEvent(scope, 'error', { error: msg }, true)
      return scope
    }
  }

  return {
    name: 'synthesizer',
    fn,
    config: resolved
  }
}
