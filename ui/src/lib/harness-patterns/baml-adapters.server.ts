/**
 * BAML Adapters - Server Only
 *
 * Adapters that bridge the pattern's expected function signatures
 * with the new generic BAML functions.
 *
 * The new BAML has generic functions:
 * - LoopController(user_message, intent, tools, turns, context?)
 * - ActorController(user_message, intent, tools, attempts)
 * - Critic(intent, attempts)
 * - Router(message, routes, history)
 * - Synthesize(user_message, intent, turns)
 *
 * The patterns expect:
 * - ControllerFn(user_message, intent, previous_results, n_turn, ...extra)
 * - CriticFn(intent, previous_attempts)
 * - CodeModeControllerFn(user_message, intent, available_tools, previous_attempts)
 */

import { assertServerOnImport } from './assert.server'
import type { ControllerFn, CriticFn, CodeModeControllerFn, ControllerAction, CriticResult, ScriptExecutionEvent, LLMCallData } from './types'
import type { ToolDescription, LoopTurn, Attempt, PriorResult, FewShot } from '../../../baml_client/types'
import { listTools as mcpListTools } from './mcp-client.server'
import { Collector, BamlValidationError } from '@boundaryml/baml'
import { getBamlFiles } from '../../../baml_client/inlinedbaml'

assertServerOnImport()

// ============================================================================
// Types for LLM Call Results
// ============================================================================

/** Result from a controller call with optional LLM observability data */
export interface ControllerCallResult {
  action: ControllerAction
  llmCall?: LLMCallData
}

/** Result from a critic call with optional LLM observability data */
export interface CriticCallResult {
  result: CriticResult
  llmCall?: LLMCallData
}

/** Controller function that returns action + observability data */
export type ControllerFnWithLLMData = (
  user_message: string,
  intent: string,
  previous_results: string,
  n_turn: number,
  schema?: string,
  collector?: Collector,
  priorResults?: PriorResult[],
  fewShots?: FewShot[]
) => Promise<ControllerCallResult>

/** Critic function that returns result + observability data */
export type CriticFnWithLLMData = (
  intent: string,
  previous_attempts: ScriptExecutionEvent[],
  collector?: Collector
) => Promise<CriticCallResult>

/** Extract LLM call data from a collector */
export function extractLLMCallData(
  collector: Collector,
  functionName: string,
  variables: Record<string, unknown>,
  startTime: number,
  parsedOutput?: unknown
): LLMCallData | undefined {
  const last = collector.last
  if (!last) return undefined

  // Prefer the call BAML actually selected (handles fallbacks); fall back to the last attempted call
  const calls = (last.calls ?? []) as Array<{
    selected?: boolean
    provider?: string
    clientName?: string
    httpRequest?: { body?: unknown }
  }>
  const selectedCall = calls.find((c) => c.selected) ?? calls[calls.length - 1]

  // BAML's httpRequest.body is an HttpBody class instance with .text()/.json()/.raw() methods.
  // JSON.stringify on the class returns "{}" because it has no enumerable own properties.
  let rawInput: string | undefined
  const body = selectedCall?.httpRequest?.body as
    | { text?: () => string }
    | string
    | Record<string, unknown>
    | undefined
  if (typeof body === 'string') {
    rawInput = body
  } else if (body && typeof (body as { text?: () => string }).text === 'function') {
    try {
      rawInput = (body as { text: () => string }).text()
    } catch {
      // body.text() may throw on malformed bodies — leave undefined
    }
  } else if (body && typeof body === 'object') {
    rawInput = JSON.stringify(body, null, 2)
  }

  const provider = selectedCall?.provider
  const clientName = selectedCall?.clientName

  return {
    functionName,
    variables,
    promptTemplate: getPromptTemplate(functionName),
    rawInput,
    rawOutput: last.rawLlmResponse ?? undefined,
    parsedOutput,
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

// ============================================================================
// Prompt Template Extraction
// ============================================================================

/** Cache for extracted prompt templates keyed by function name */
let promptTemplateCache: Record<string, string> | null = null

/** Extract prompt template for a BAML function. Reads from inlinedbaml when
 * available (production builds), and falls back to the on-disk baml_src/
 * directory (dev environments without a generated baml_client). */
function getPromptTemplate(functionName: string): string | undefined {
  if (!promptTemplateCache) {
    promptTemplateCache = {}
    loadTemplatesFromInlinedBaml(promptTemplateCache)
    if (Object.keys(promptTemplateCache).length === 0) {
      loadTemplatesFromDisk(promptTemplateCache)
    }
  }
  return promptTemplateCache[functionName]
}

function loadTemplatesFromInlinedBaml(cache: Record<string, string>): void {
  try {
    const files = getBamlFiles() as Record<string, string>
    for (const source of Object.values(files)) {
      extractPromptTemplates(source, cache)
    }
  } catch {
    // baml_client not generated — caller falls back to disk
  }
}

function loadTemplatesFromDisk(cache: Record<string, string>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    const bamlSrc = path.resolve(process.cwd(), 'baml_src')
    if (!fs.existsSync(bamlSrc)) return
    for (const entry of fs.readdirSync(bamlSrc)) {
      if (!entry.endsWith('.baml')) continue
      const source = fs.readFileSync(path.join(bamlSrc, entry), 'utf8')
      extractPromptTemplates(source, cache)
    }
  } catch {
    // filesystem unavailable — templates remain unset
  }
}

/** Parse BAML source to extract function prompt blocks */
function extractPromptTemplates(source: string, cache: Record<string, string>): void {
  // Match: function FunctionName(...) -> ReturnType { ... prompt #"..."# }
  const funcRegex = /function\s+(\w+)\s*\([^)]*\)\s*->\s*\S+\s*\{[^}]*?prompt\s+#"([\s\S]*?)"#/g
  let match: RegExpExecArray | null
  while ((match = funcRegex.exec(source)) !== null) {
    cache[match[1]] = match[2]
  }
}

// ============================================================================
// Tool Description Cache
// ============================================================================

let toolDescCache: ToolDescription[] | null = null

async function getToolDescriptions(): Promise<ToolDescription[]> {
  if (!toolDescCache) {
    const tools = await mcpListTools()
    toolDescCache = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      args_schema: t.inputSchema ? JSON.stringify(t.inputSchema) : undefined
    }))
  }
  return toolDescCache
}

/** Filter tool descriptions by tool names */
async function filterToolDescriptions(toolNames: string[]): Promise<ToolDescription[]> {
  const all = await getToolDescriptions()
  const nameSet = new Set(toolNames)
  return all.filter((t) => nameSet.has(t.name))
}

// ============================================================================
// Adapters for simpleLoop
// ============================================================================

/**
 * Create a ControllerFn adapter for simpleLoop that uses the generic LoopController.
 *
 * @param toolNames - Array of tool names available to this controller
 * @param contextPrefix - Optional context prefix for the prompt (e.g., domain-specific instructions)
 * @returns ControllerFnWithLLMData compatible with simpleLoop pattern
 */
export function createLoopControllerAdapter(
  toolNames: string[],
  contextPrefix?: string
): ControllerFnWithLLMData {
  return async (
    user_message: string,
    intent: string,
    previous_results: string,
    n_turn: number,
    schema?: string,
    collector?: Collector,
    priorResults?: PriorResult[],
    fewShots?: FewShot[]
  ): Promise<ControllerCallResult> => {
    const { b } = await import('../../../baml_client')
    const startTime = Date.now()

    // Get tool descriptions for available tools
    const tools = await filterToolDescriptions(toolNames)

    // Parse previous results into LoopTurn format
    const turns: LoopTurn[] = parseResultsToTurns(previous_results, n_turn)

    // Build context from schema and contextPrefix only (prior tool results go into priorResults)
    let context: string | undefined
    if (schema || contextPrefix) {
      const parts: string[] = []
      if (contextPrefix) parts.push(contextPrefix)
      if (schema) parts.push(`GRAPH SCHEMA:\n${schema}`)
      context = parts.join('\n\n')
    }

    const variables = { user_message, intent, tools, turns, context, turns_previous_runs: priorResults, few_shots: fewShots }

    // Call with or without collector.
    // On BamlValidationError, BAML's built-in fallback won't retry (it only covers network/API
    // errors). Manually escalate: first to GroqGPT120B (fast, reliable structured output at
    // moderate context), then to GroqFast as a last resort.
    let action: ControllerAction
    try {
      action = collector
        ? await b.LoopController(user_message, intent, tools, turns, context, priorResults, fewShots, { collector })
        : await b.LoopController(user_message, intent, tools, turns, context, priorResults, fewShots)
    } catch (e) {
      if (!(e instanceof BamlValidationError)) throw e
      try {
        action = await b.LoopController(user_message, intent, tools, turns, context, priorResults, fewShots, { client: 'GroqGPT120B' })
      } catch (e2) {
        if (!(e2 instanceof BamlValidationError)) throw e2
        action = await b.LoopController(user_message, intent, tools, turns, context, priorResults, fewShots, { client: 'GroqFast' })
      }
    }

    // Extract LLM call data if collector present
    const llmCall = collector
      ? extractLLMCallData(collector, 'LoopController', variables, startTime, action)
      : undefined

    return { action, llmCall }
  }
}

/**
 * Parse previous_results JSON string into LoopTurn array.
 * Expects LoopTurn[] JSON produced by simpleLoop's internal turn tracking.
 */
function parseResultsToTurns(previous_results: string, _currentTurn: number): LoopTurn[] {
  if (!previous_results || previous_results === '[]') return []

  try {
    const parsed = JSON.parse(previous_results)
    if (!Array.isArray(parsed)) return []
    // Accept LoopTurn[] format (has numeric 'n' field from simpleLoop tracking)
    if (parsed.length > 0 && typeof parsed[0].n === 'number') {
      return parsed as LoopTurn[]
    }
    return []
  } catch {
    return []
  }
}

// ============================================================================
// PriorResult Merging — used by simpleLoop to combine `withReferences`
// attachments with the existing `priorTurnCount` mechanism, and to annotate
// each ref with the turn it was first inlined via ref:<id>.
// ============================================================================

/** Drop duplicate `ref_id` entries; first occurrence wins. */
export function dedupByRefId(refs: PriorResult[]): PriorResult[] {
  const seen = new Set<string>()
  const out: PriorResult[] = []
  for (const r of refs) {
    if (seen.has(r.ref_id)) continue
    seen.add(r.ref_id)
    out.push(r)
  }
  return out
}

/** Annotate each ref with the **first** `turn.n` whose `expansions[]` contains
 *  its `ref_id`. Refs never expanded get `expanded_in_turn: null` (explicitly,
 *  not absent) — MiniJinja distinguishes None from undefined, and `is none`
 *  in the prompt template only matches None. If we left the field absent the
 *  template's `is not none` test would incorrectly fire for unannotated refs. */
export function annotateExpansions(refs: PriorResult[], turns: LoopTurn[]): PriorResult[] {
  const firstTurn = new Map<string, number>()
  for (const t of turns) {
    for (const e of t.expansions ?? []) {
      if (!firstTurn.has(e.ref_id)) firstTurn.set(e.ref_id, t.n)
    }
  }
  return refs.map(r => ({
    ...r,
    expanded_in_turn: firstTurn.get(r.ref_id) ?? null
  }))
}

// ============================================================================
// Adapters for actorCritic
// ============================================================================

/** Code mode controller function that returns action + observability data */
export type CodeModeControllerFnWithLLMData = (
  user_message: string,
  intent: string,
  available_tools: string[],
  previous_attempts: ScriptExecutionEvent[],
  collector?: Collector
) => Promise<ControllerCallResult>

/**
 * Create a CodeModeControllerFn adapter that uses the generic ActorController.
 *
 * @param toolNames - Array of tool names available
 * @returns CodeModeControllerFnWithLLMData compatible with actorCritic pattern
 */
export function createActorControllerAdapter(toolNames: string[]): CodeModeControllerFnWithLLMData {
  return async (
    user_message: string,
    intent: string,
    available_tools: string[],
    previous_attempts: ScriptExecutionEvent[],
    collector?: Collector
  ): Promise<ControllerCallResult> => {
    const { b } = await import('../../../baml_client')
    const startTime = Date.now()

    // Get tool descriptions
    const tools = await filterToolDescriptions(toolNames)

    // Convert ScriptExecutionEvent to Attempt format
    const attempts: Attempt[] = previous_attempts.map((event, i) => ({
      n: i + 1,
      action: {
        reasoning: '',
        tool_name: 'code-mode',
        tool_args: event.script,
        status: event.error ? 'error' : 'success',
        is_final: false
      },
      result: event.output,
      error: event.error ?? undefined,
      feedback: undefined
    }))

    const variables = { user_message, intent, tools, attempts }

    // Call with or without collector
    const action = collector
      ? await b.ActorController(user_message, intent, tools, attempts, { collector })
      : await b.ActorController(user_message, intent, tools, attempts)

    // Extract LLM call data if collector present
    const llmCall = collector
      ? extractLLMCallData(collector, 'ActorController', variables, startTime, action)
      : undefined

    return { action, llmCall }
  }
}

/**
 * Create a CriticFn adapter that uses the generic Critic.
 *
 * @returns CriticFnWithLLMData compatible with actorCritic pattern
 */
export function createCriticAdapter(): CriticFnWithLLMData {
  return async (
    intent: string,
    previous_attempts: ScriptExecutionEvent[],
    collector?: Collector
  ): Promise<CriticCallResult> => {
    const { b } = await import('../../../baml_client')
    const startTime = Date.now()

    // Convert ScriptExecutionEvent to Attempt format
    const attempts: Attempt[] = previous_attempts.map((event, i) => ({
      n: i + 1,
      action: {
        reasoning: '',
        tool_name: 'code-mode',
        tool_args: event.script,
        status: event.error ? 'error' : 'success',
        is_final: false
      },
      result: event.output,
      error: event.error ?? undefined,
      feedback: undefined
    }))

    const variables = { intent, attempts }

    // Call with or without collector
    const result = collector
      ? await b.Critic(intent, attempts, { collector })
      : await b.Critic(intent, attempts)

    // Extract LLM call data if collector present
    const llmCall = collector
      ? extractLLMCallData(collector, 'Critic', variables, startTime, result)
      : undefined

    return { result, llmCall }
  }
}

// ============================================================================
// Tool Result Summarization
// ============================================================================

/**
 * Summarize a tool result using a lightweight model.
 * Non-fatal: returns empty string on failure.
 */
export async function describeToolResultOp(
  tool: string,
  toolArgs: string,
  reasoning: string,
  result: string
): Promise<string> {
  try {
    const { b } = await import('../../../baml_client')
    return await b.ResultDescribe(tool, toolArgs, reasoning, result)
  } catch {
    return ''
  }
}

// ============================================================================
// Domain-Specific Controller Adapters
// ============================================================================

/** Neo4j controller - uses LoopController with graph schema context (schema injected via config.schema) */
export function createNeo4jController(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}

/** Web search controller */
export function createWebSearchController(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}

/** Memory controller */
export function createMemoryController(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}

/** Context7 documentation controller */
export function createContext7Controller(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}

/** GitHub controller */
export function createGitHubController(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}

/** Filesystem controller */
export function createFilesystemController(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}

/** Redis controller */
export function createRedisController(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}

/** Database controller */
export function createDatabaseController(toolNames: string[]): ControllerFnWithLLMData {
  return createLoopControllerAdapter(toolNames)
}
