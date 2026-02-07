/**
 * Routing - Server Only
 *
 * Routes user messages to appropriate tool namespaces.
 */

import { assertServerOnImport } from './assert.server'

assertServerOnImport()

// ============================================================================
// BAML Import Helper
// ============================================================================

async function getBAML() {
  const { b } = await import('../../../baml_client')
  return b
}

// ============================================================================
// Routing
// ============================================================================

/** Default routes for the router */
const DEFAULT_ROUTES = [
  { name: 'neo4j', description: 'Database queries and graph operations' },
  { name: 'web_search', description: 'Web lookups and information retrieval' },
  { name: 'code_mode', description: 'Multi-tool script composition' }
]

export async function routeMessageOp(
  message: string,
  history: Array<{ role: string; content: string }>,
  routes: Array<{ name: string; description: string }> = DEFAULT_ROUTES
): Promise<{
  intent: string
  tool_call_needed: boolean
  tool_name: 'neo4j' | 'web_search' | 'code_mode' | null
  response_text: string
}> {
  const b = await getBAML()
  const result = await b.Router(message, routes, history)

  const namespaceMap: Record<string, 'neo4j' | 'web_search' | 'code_mode'> = {
    neo4j: 'neo4j',
    web_search: 'web_search',
    code_mode: 'code_mode'
  }

  return {
    intent: result.intent,
    tool_call_needed: result.needs_tool,
    tool_name: result.route
      ? namespaceMap[result.route] ?? null
      : null,
    response_text: result.response
  }
}
