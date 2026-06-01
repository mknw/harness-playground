/**
 * Actor-Critic Pattern
 *
 * Generate-evaluate loop with retry on failure.
 * Designed for code mode: generates scripts, executes them, evaluates results.
 */

import { Collector } from '@boundaryml/baml'
import { assertServerOnImport } from '../assert.server'
import { callTool, listTools as mcpListTools } from '../mcp-client.server'
import { invalidateToolDescriptions } from '../baml-adapters.server'
import { repairJson } from '../json-repair'
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
import type { ErrorEventData } from '../types'
import { getErrorHint } from '../error-hints'
import { trackEvent, resolveConfig, generateId } from '../context.server'
import { getRequestSettings } from '../../settings-context.server'
import { getActiveSandbox } from '../../sandbox/scope.server'
import type { CodeModeControllerFnWithLLMData, CriticFnWithLLMData } from '../baml-adapters.server'
import { LLMCallError } from '../baml-adapters.server'

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
  const availableTools = config?.availableTools ?? tools
  const resolved = resolveConfig('actorCritic', config)

  const fn = async (
    scope: PatternScope<T>,
    view: EventView
  ): Promise<PatternScope<T>> => {
    const maxRetries = config?.maxRetries ?? getRequestSettings().maxRetries
    const previousAttempts: ScriptExecutionEvent[] = []
    let errorMessage: string | undefined

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // Get the original user input. Use `ofType('user_message')` (not
        // `messages()`, which also includes assistant_message) so a router or
        // other upstream pattern emitting an intermediate `assistant_message`
        // (e.g. a transient "Looking into that..." status) can't bump itself
        // into the "last message" slot and end up rendered as the user's input
        // in the actor prompt. `fromAll()` bypasses the per-pattern view scope —
        // the user_message lives at the harness level, outside this loop's id.
        const userMessage = view.fromAll().ofType('user_message').last(1).get()[0]
        const userContent = userMessage
          ? (userMessage.data as { content: string }).content
          : ''
        const intent = scope.data.intent ?? userContent

        // Call actor. We pass `attempt + 1` (1-indexed for the prompt) and
        // maxRetries so the actor's prompt can surface "Attempt N of M" and
        // nudge the model toward `Return` when the budget is nearly exhausted.
        const actorCollector = new Collector('actor')
        const { action, llmCall: actorLlmCall } = await actor(
          userContent,
          intent,
          availableTools,
          previousAttempts,
          actorCollector,
          attempt + 1,
          maxRetries,
        )

        // Track controller action with LLM call data. `turn` and `maxTurns`
        // (mapped from attempt / maxRetries) are exposed so live progress
        // consumers can size their indicators against the runtime values.
        trackEvent(
          scope,
          'controller_action',
          { action, turn: attempt, maxTurns: maxRetries } as ControllerActionEventData,
          resolved.trackHistory,
          actorLlmCall
        )

        // P0 (Return-from-critic redesign): the actor used to be able to exit
        // the loop by calling `tool_name === 'Return'` or setting `is_final`.
        // We removed that — sufficiency-to-exit is the critic's job by
        // definition, and the dual responsibility let the actor self-terminate
        // with fabricated data (see `.harness-logs/one-turn-codemode.json`).
        // If the actor still proposes `Return` (or anything else not on the
        // allowlist), it falls through to the allowlist check below, which
        // rejects it as "Tool not allowed: Return" and continues the loop —
        // letting the critic actually evaluate the next real tool call.
        // `is_final` is preserved on `ControllerAction` for backwards compat
        // but is now advisory; nothing in the loop honours it.

        // Validate tool. The strict allowlist is augmented by an optional
        // `dynamicToolPattern` regex so agents whose backends create tools at
        // runtime (e.g. the kg-agent gateway's `code-mode-<name>` factory)
        // can accept those names without enumerating them upfront. A second
        // augmentation, `dynamicToolAllowlist`, is a per-turn callback for
        // user-curated selections (e.g. the code-mode agent's per-conversation
        // tool picker) — kept in sync with the adapter's `toolNamesProvider`.
        const dynamicAllowlist = config?.dynamicToolAllowlist
          ? await config.dynamicToolAllowlist()
          : []
        // A third augmentation: an active `withSandbox` scope's tool surface.
        // Sandbox-owned (`sandbox_*`) names pass without being listed in
        // `tools` or `dynamicToolAllowlist` (see docs/sandbox-plan.md → "How
        // tools reach the controller"). Outside any sandbox scope this is
        // a no-op.
        const sandbox = getActiveSandbox()
        const allowed =
          tools.includes(action.tool_name) ||
          dynamicAllowlist.includes(action.tool_name) ||
          (sandbox?.ownsTool(action.tool_name) ?? false) ||
          (config?.dynamicToolPattern?.test(action.tool_name) ?? false)
        if (!allowed) {
          const errMsg = `Tool not allowed: ${action.tool_name}`
          // Only surface as a visible error event when the allowlist has
          // SOME entries — that's a real actor mistake (proposed wrong tool
          // name). When the combined allowlist is empty, that's almost
          // always a transient MCP gateway issue, and a per-turn flood of
          // identical "Tool not allowed" events would spam the synth's view
          // and observability UI without helping. The actor still sees the
          // rejection via `previousAttempts` either way (its standard
          // feedback channel), and the gateway-down case resolves on the
          // next turn once `withReconnect` rebuilds the transport and
          // `toolNamesProvider` re-resolves to a non-empty list.
          const allowlistHasContent = tools.length > 0 || dynamicAllowlist.length > 0
          if (allowlistHasContent) {
            trackEvent(
              scope,
              'error',
              {
                error: errMsg,
                severity: 'recoverable',
                hint:
                  'Actor proposed a tool not on the allowlist (and not matched by ' +
                  'dynamicToolPattern / dynamicToolAllowlist).',
                iteration: attempt,
              } as ErrorEventData,
              resolved.trackHistory,
            )
          }
          previousAttempts.push({
            toolName: action.tool_name,
            script: action.tool_args,
            output: '',
            error: errMsg,
          })
          continue
        }

        // Parse args (lenient — LLMs may output unquoted keys/values)
        let args: Record<string, unknown>
        try {
          args = repairJson(action.tool_args)
        } catch {
          // Surface unparseable tool_args as a recoverable error too — same
          // observability reasoning as the allowlist branch above.
          const errMsg = `Invalid tool_args JSON for ${action.tool_name}: ${action.tool_args}`
          trackEvent(
            scope,
            'error',
            {
              error: errMsg,
              severity: 'recoverable',
              hint:
                'Actor produced unparseable tool_args. Common causes: unquoted ' +
                'keys/values, unescaped newlines inside scripts. The actor will ' +
                'see this in previousAttempts and (hopefully) retry with valid JSON.',
              iteration: attempt,
            } as ErrorEventData,
            resolved.trackHistory,
          )
          previousAttempts.push({
            toolName: action.tool_name,
            script: action.tool_args,
            output: '',
            error: errMsg,
          })
          continue
        }

        // Generate correlation ID for this tool call/result pair
        const callId = generateId('tc')

        // Track tool call
        trackEvent(
          scope,
          'tool_call',
          { callId, tool: action.tool_name, args } as ToolCallEventData,
          resolved.trackHistory
        )

        // Execute tool
        const result = await callTool(action.tool_name, args)

        // The kg-agent `code-mode` tool is a factory: a successful call
        // registers a new tool (`code-mode-<args.name>`). Invalidate the
        // adapter's tool-description cache so the next actor invocation
        // re-fetches a fresh listing and includes the newly-created tool in
        // the LLM's prompt. The gateway persists these tools across turns, so
        // this also makes them visible to future user turns in the same session.
        if (result.success && action.tool_name === 'code-mode') {
          invalidateToolDescriptions()
          try {
            await mcpListTools()  // warm the gateway's own cache; non-fatal
          } catch {
            // Non-fatal — the actor can still try to invoke the new tool by name.
          }
        }

        // onToolResult hook: enrich/transform result before commit. See SimpleLoop for full doc.
        if (config?.onToolResult) {
          try {
            const hookResult = await config.onToolResult(
              action.tool_name,
              result,
              { callId, args }
            )
            if (hookResult && 'data' in hookResult && hookResult.data !== undefined) {
              result.data = hookResult.data
            }
          } catch (hookErr) {
            const message = hookErr instanceof Error ? hookErr.message : String(hookErr)
            trackEvent(
              scope,
              'error',
              {
                error: `onToolResult hook failed for ${action.tool_name}: ${message}`,
                severity: 'recoverable',
              },
              true
            )
          }
        }

        // Track result
        const script = typeof args.script === 'string' ? args.script : JSON.stringify(args)
        previousAttempts.push({
          toolName: action.tool_name,
          script,
          output: result.success ? JSON.stringify(result.data) : '',
          error: result.success ? null : (result.error ?? 'Execution failed')
        })

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

        if (!result.success) {
          continue
        }

        // Call critic
        const criticCollector = new Collector('critic')
        const { result: evalResult, llmCall: criticLlmCall } = await critic(intent, previousAttempts, criticCollector)

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
      trackEvent(scope, 'error', {
        error: errorMessage,
        severity: resolved.errorSeverity,
        hint: getErrorHint(errorMessage),
        iteration: maxRetries - 1,
      } as ErrorEventData, true)

      return scope
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // Preserve LLM call data through to the error event so the panel can
      // show the prompt drill-down for failed BAML calls (actor or critic).
      const llmCall = error instanceof LLMCallError ? error.llmCall : undefined
      trackEvent(scope, 'error', {
        error: msg,
        severity: resolved.errorSeverity,
        hint: getErrorHint(msg),
        ...(llmCall ? { kind: 'llm_call' as const } : {}),
      } as ErrorEventData, true, llmCall)
      return scope
    }
  }

  return {
    name: 'actorCritic',
    fn,
    config: resolved,
    estimateTurns: (s) => config?.maxRetries ?? s.maxRetries
  }
}
