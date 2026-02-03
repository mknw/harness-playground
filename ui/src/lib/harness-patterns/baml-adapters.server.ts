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
import type { ControllerFn, CriticFn, CodeModeControllerFn, ControllerAction, CriticResult, ScriptExecutionEvent } from './types'
import type { ToolDescription, LoopTurn, Attempt } from '../../../baml_client/types'
import { listTools as mcpListTools } from './mcp-client.server'

assertServerOnImport()

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
 * @returns ControllerFn compatible with simpleLoop pattern
 */
export function createLoopControllerAdapter(
  toolNames: string[],
  contextPrefix?: string
): ControllerFn {
  return async (
    user_message: string,
    intent: string,
    previous_results: string,
    n_turn: number,
    schema?: string
  ): Promise<ControllerAction> => {
    const { b } = await import('../../../baml_client')

    // Get tool descriptions for available tools
    const tools = await filterToolDescriptions(toolNames)

    // Parse previous results into LoopTurn format
    const turns: LoopTurn[] = parseResultsToTurns(previous_results, n_turn)

    // Build context from schema and prefix
    let context: string | undefined
    if (schema || contextPrefix) {
      const parts: string[] = []
      if (contextPrefix) parts.push(contextPrefix)
      if (schema) parts.push(`GRAPH SCHEMA:\n${schema}`)
      context = parts.join('\n\n')
    }

    return b.LoopController(user_message, intent, tools, turns, context)
  }
}

/**
 * Parse previous_results JSON string into LoopTurn array.
 */
function parseResultsToTurns(previous_results: string, _currentTurn: number): LoopTurn[] {
  if (!previous_results || previous_results === '[]') return []

  try {
    const results = JSON.parse(previous_results)
    if (!Array.isArray(results)) return []

    return results.map((r, i) => ({
      n: i,
      reasoning: undefined,
      tool_call: undefined,
      tool_result: {
        tool: 'unknown',
        result: JSON.stringify(r),
        success: true,
        error: null
      }
    }))
  } catch {
    // If not valid JSON, return empty
    return []
  }
}

// ============================================================================
// Adapters for actorCritic
// ============================================================================

/**
 * Create a CodeModeControllerFn adapter that uses the generic ActorController.
 *
 * @param toolNames - Array of tool names available
 * @returns CodeModeControllerFn compatible with actorCritic pattern
 */
export function createActorControllerAdapter(toolNames: string[]): CodeModeControllerFn {
  return async (
    user_message: string,
    intent: string,
    available_tools: string[],
    previous_attempts: ScriptExecutionEvent[]
  ): Promise<ControllerAction> => {
    const { b } = await import('../../../baml_client')

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

    return b.ActorController(user_message, intent, tools, attempts)
  }
}

/**
 * Create a CriticFn adapter that uses the generic Critic.
 *
 * @returns CriticFn compatible with actorCritic pattern
 */
export function createCriticAdapter(): CriticFn {
  return async (
    intent: string,
    previous_attempts: ScriptExecutionEvent[]
  ): Promise<CriticResult> => {
    const { b } = await import('../../../baml_client')

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

    return b.Critic(intent, attempts)
  }
}

// ============================================================================
// Domain-Specific Controller Adapters
// ============================================================================

/** Neo4j controller - uses LoopController with graph schema context */
export function createNeo4jController(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a Neo4j Knowledge Graph Agent.
Use Cypher queries with LIMIT clauses for safety.
Available tools: read_neo4j_cypher, write_neo4j_cypher, get_neo4j_schema, Return.
When you have enough information, use "Return" tool.`
  )
}

/** Web search controller - uses LoopController for web search tasks */
export function createWebSearchController(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a Web Search Agent.
Search for information on the web and fetch content as needed.
Available tools: search, fetch, fetch_content, Return.
When you have enough information, use "Return" tool.`
  )
}

/** Memory controller - uses LoopController for memory graph operations */
export function createMemoryController(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a Memory Knowledge Graph Agent.
Store and retrieve entities and relationships in the memory graph.
Available tools: create_entities, create_relations, add_observations,
delete_entities, delete_relations, delete_observations,
open_nodes, search_nodes, read_graph, Return.
When you have completed the task, use "Return" tool.`
  )
}

/** Context7 documentation controller */
export function createContext7Controller(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a Documentation Lookup Agent using Context7.
Look up library documentation by first resolving the library ID,
then fetching relevant docs for the topic.
Available tools: resolve-library-id, get-library-docs, Return.
When you have the documentation needed, use "Return" tool.`
  )
}

/** GitHub controller */
export function createGitHubController(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a GitHub Agent.
Search code, issues, and repositories. Fetch file contents and PR details.
When you have enough information, use "Return" tool.`
  )
}

/** Filesystem controller */
export function createFilesystemController(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a Filesystem Agent.
Read, write, search, and edit files within the workspace.
Be careful with write operations - verify paths before modifying.
When the task is complete, use "Return" tool.`
  )
}

/** Redis controller */
export function createRedisController(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a Redis Agent.
Store and retrieve data using Redis data structures.
Available operations: strings, hashes, lists, sets, sorted sets, JSON, vectors.
When the task is complete, use "Return" tool.`
  )
}

/** Database controller */
export function createDatabaseController(toolNames: string[]): ControllerFn {
  return createLoopControllerAdapter(
    toolNames,
    `You are a Database Agent.
Execute SQL queries against PostgreSQL, MySQL, or SQLite databases.
Use parameterized queries when possible. Be careful with write operations.
When the task is complete, use "Return" tool.`
  )
}
