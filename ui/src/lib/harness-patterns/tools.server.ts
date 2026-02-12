/**
 * Tools Wrapper
 *
 * Groups MCP tools by server/namespace for convenient access.
 */

import { assertServerOnImport } from './assert.server'
import { listTools as mcpListTools } from './mcp-client.server'
import type { ToolSet, MCPToolDescription } from './types'

assertServerOnImport()

/**
 * Create a ToolSet from MCP tools.
 * Groups tools by inferred server name.
 *
 * @example
 * const tools = await Tools()
 * tools.neo4j  // ['read_neo4j_cypher', 'write_neo4j_cypher', 'get_neo4j_schema']
 * tools.web    // ['search', 'fetch']
 * tools.all    // all tool names
 */
export async function Tools(): Promise<ToolSet> {
  const mcpTools = await mcpListTools()
  return groupTools(mcpTools)
}

/**
 * Create a ToolSet from an existing list of tool descriptions.
 */
export function ToolsFrom(mcpTools: MCPToolDescription[]): ToolSet {
  return groupTools(mcpTools)
}

function groupTools(mcpTools: MCPToolDescription[]): ToolSet {
  const grouped: Record<string, string[]> = {}

  for (const t of mcpTools) {
    const server = inferServer(t.name)
    grouped[server] ??= []
    grouped[server].push(t.name)
  }

  const all = mcpTools.map((t) => t.name)

  return { ...grouped, all } as ToolSet
}

/**
 * Infer server name from tool name.
 *
 * Patterns:
 * - 'mcp__kg-agent-mcp-gateway__search' → 'search' (MCP gateway format)
 * - 'mcp__kg-agent-mcp-gateway__read_neo4j_cypher' → 'neo4j' (MCP gateway + verb prefix)
 * - 'read_neo4j_cypher' → 'neo4j'
 * - 'get_neo4j_schema' → 'neo4j'
 * - 'web_search' → 'web'
 * - 'fetch' → 'fetch'
 * - 'mcp-find' → 'mcp'
 */
function inferServer(toolName: string): string {
  // Handle MCP gateway format: mcp__server-name__tool_name → infer from tool_name part
  if (toolName.includes('__')) {
    const parts = toolName.split('__')
    const actualToolName = parts[parts.length - 1] // Get last part (the actual tool)
    return inferServer(actualToolName) // Recursively infer from tool name
  }

  // Handle underscore-separated: read_neo4j_cypher → neo4j
  if (toolName.includes('_')) {
    const parts = toolName.split('_')
    // Skip verb prefixes like 'read', 'write', 'get'
    const verbs = ['read', 'write', 'get', 'list', 'create', 'delete', 'update', 'search']
    if (verbs.includes(parts[0]) && parts.length >= 2) {
      return parts[1]
    }
    // web_search → web
    return parts[0]
  }

  // Handle hyphen-separated: mcp-find → mcp
  if (toolName.includes('-')) {
    return toolName.split('-')[0]
  }

  // Single word: fetch → fetch, search → search
  return toolName
}
