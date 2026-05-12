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
  AssistantMessageEventData,
  LLMCallData
} from '../types'
import { DIRECT_RESPONSE_ROUTE } from '../types'
import type { ErrorEventData } from '../types'
import { getErrorHint } from '../error-hints'
import { trackEvent, resolveConfig } from '../context.server'
import { Collector } from '@boundaryml/baml'
import { trimToFit, getContextWindow } from '../token-budget.server'

assertServerOnImport()

/** Result from synthesis with optional LLM call data */
interface SynthesisResult {
  content: string
  llmCall?: LLMCallData
}

/**
 * Default synthesis function using BAML Synthesize.
 * Tracks LLM call data when collector is provided.
 */
async function defaultSynthesize(input: SynthesizerInput, collector?: Collector): Promise<SynthesisResult> {
  // Dynamic import to avoid circular dependencies
  const { b } = await import('../../../../baml_client')
  const startTime = Date.now()

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

  // Trim oldest turns if they would overflow the synthesizer's context window
  const contextWindow = getContextWindow('SynthesizerFallback')
  const trimmedTurns = trimToFit(turns, t => JSON.stringify(t), 500, contextWindow)

  const variables = {
    userMessage: input.userMessage,
    intent: input.intent,
    turns: trimmedTurns,
    hasError: input.hasError ?? false,
    errorMessage: input.errorMessage
  }

  // Call with or without collector, including error context
  const content = collector
    ? await b.Synthesize(
        input.userMessage,
        input.intent,
        trimmedTurns,
        input.hasError ?? false,
        input.errorMessage,
        { collector }
      )
    : await b.Synthesize(
        input.userMessage,
        input.intent,
        trimmedTurns,
        input.hasError ?? false,
        input.errorMessage
      )

  // Extract LLM call data if collector present
  let llmCall: LLMCallData | undefined
  if (collector?.last) {
    const last = collector.last
    let rawInput: string | undefined
    const lastCall = last.calls?.[last.calls.length - 1]
    if (lastCall?.httpRequest?.body) {
      const body = lastCall.httpRequest.body
      rawInput = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
    }

    // Extract prompt template from inlined BAML source
    let promptTemplate: string | undefined
    try {
      const { getBamlFiles } = await import('../../../../baml_client/inlinedbaml')
      const files = getBamlFiles() as Record<string, string>
      for (const source of Object.values(files)) {
        const match = /function\s+Synthesize\s*\([^)]*\)\s*->\s*\S+\s*\{[^}]*?prompt\s+#"([\s\S]*?)"#/.exec(source)
        if (match) {
          promptTemplate = match[1]
          break
        }
      }
    } catch { /* inlined BAML not available */ }

    // Extract provider and client info from the selected call
    const provider = lastCall && 'provider' in lastCall ? (lastCall as { provider: string }).provider : undefined
    const clientName = lastCall && 'clientName' in lastCall ? (lastCall as { clientName: string }).clientName : undefined

    llmCall = {
      functionName: 'Synthesize',
      variables,
      promptTemplate,
      rawInput,
      rawOutput: last.rawLlmResponse ?? undefined,
      parsedOutput: content,
      usage: last.usage ? {
        inputTokens: last.usage.inputTokens ?? 0,
        outputTokens: last.usage.outputTokens ?? 0,
        cachedInputTokens: last.usage.cachedInputTokens ?? 0,
        totalTokens: (last.usage.inputTokens ?? 0) + (last.usage.outputTokens ?? 0)
      } : undefined,
      durationMs: Date.now() - startTime,
      provider,
      clientName
    }
  }

  return { content, llmCall }
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
    intent: data.intent ?? userContent,
    // Read error state from view (scoped by synthesizer's ViewConfig)
    // rather than from data stash, so errors naturally expire with the view window
    hasError: view.hasErrors(),
    errorMessage: view.lastError()
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
  const { mode, synthesize, skipIfHasResponse = false } = config
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

      // Skip BAML synthesis for direct user responses (router already produced the response)
      if ((scope.data as Record<string, unknown>).route === DIRECT_RESPONSE_ROUTE) {
        return scope
      }

      // Build input from view
      const input = buildSynthesisInputFromView(mode, view, scope.data)

      // Validate thread mode
      if (mode === 'thread' && !input.loopHistory) {
        input.mode = 'response'
        input.data = scope.data
      }

      let synthesizedResponse: string
      let llmCall: LLMCallData | undefined

      if (synthesize) {
        // Custom synthesis function - no LLM tracking
        synthesizedResponse = await synthesize(input)
      } else {
        // Use default with collector for LLM observability
        const collector = new Collector('synthesizer')
        const result = await defaultSynthesize(input, collector)
        synthesizedResponse = result.content
        llmCall = result.llmCall
      }

      // Track assistant message event with LLM call data. `final: true`
      // distinguishes the synthesizer's user-facing response from router
      // status messages that share the same event type — chat-history
      // replay reads this flag to skip intermediate emits.
      trackEvent(
        scope,
        'assistant_message',
        { content: synthesizedResponse, final: true } as AssistantMessageEventData,
        resolved.trackHistory,
        llmCall
      )

      scope.data = {
        ...scope.data,
        response: synthesizedResponse,
        synthesizedResponse
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
    name: 'synthesizer',
    fn,
    config: resolved,
    estimateTurns: () => 1
  }
}
