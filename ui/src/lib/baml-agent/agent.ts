/**
 * Agent Integration Layer
 *
 * Provides a clean interface between BAML planning and tool execution.
 * Uses MCP client for external tools and direct Neo4j driver for performance.
 *
 * Architecture:
 * - MCP Client: web_search, fetch, code_mode tools via gateway
 * - Direct Neo4j: read/write cypher for lower latency
 * - Return handling: Early exit from tool loops
 */

import { callTool as mcpCallTool } from './mcp-client';
import { getNeo4jDriver } from '../neo4j/client';
import { getSchemaForAgent, executeWriteCypher } from '../neo4j/queries';
import type { ToolNamespace, ToolExecutionPlan } from './state';

// ============================================================================
// Types
// ============================================================================

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

export type { ToolNamespace };

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Execute a tool based on namespace and plan
 *
 * Routes to appropriate execution method:
 * - Neo4j tools use direct driver for performance
 * - Other tools go through MCP gateway
 *
 * @param namespace - The tool namespace (neo4j, web_search, code_mode)
 * @param toolName - The actual tool name (e.g., 'read_neo4j_cypher')
 * @param payload - JSON string or object with tool arguments
 */
export async function executeTool(
  namespace: ToolNamespace,
  toolName: string,
  payload: string | Record<string, unknown>
): Promise<ToolResult> {
  // Handle "Return" action - no execution needed, signals early exit
  if (toolName === 'Return') {
    return { success: true, data: null };
  }

  try {
    const args = typeof payload === 'string' ? JSON.parse(payload) : payload;
    let data: unknown;

    // Route based on namespace and tool
    if (namespace === 'neo4j') {
      data = await executeNeo4jTool(toolName, args);
    } else {
      // web_search, code_mode - use MCP gateway
      data = await executeMcpTool(toolName, args);
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Execute a tool from a ToolExecutionPlan
 * Convenience wrapper for the tool loop
 */
export async function executeToolPlanDirect(
  plan: ToolExecutionPlan,
  namespace: ToolNamespace
): Promise<ToolResult> {
  return executeTool(namespace, plan.toolName, plan.payload);
}

// ============================================================================
// Neo4j Direct Execution
// ============================================================================

/**
 * Execute Neo4j tools directly via neo4j-driver
 * Bypasses MCP gateway for better performance
 */
async function executeNeo4jTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // Schema fetch
  if (toolName === 'get_neo4j_schema' || toolName === 'Schema') {
    const result = await getSchemaForAgent();
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch schema');
    }
    return result.schema;
  }

  // Read/Write queries
  const query = args.query as string;
  if (!query) {
    throw new Error('Query is required for Neo4j operations');
  }

  // Write operations
  if (toolName === 'write_neo4j_cypher' || toolName === 'Write') {
    const result = await executeWriteCypher(query);
    if (!result.success) {
      throw new Error(result.error || 'Write query failed');
    }
    return result.raw;
  }

  // Read operations (default)
  const session = getNeo4jDriver().session();
  try {
    const result = await session.run(query);
    return result.records.map(r => r.toObject());
  } finally {
    await session.close();
  }
}

// ============================================================================
// MCP Gateway Execution
// ============================================================================

/**
 * Execute tools via MCP gateway
 * Used for web_search, fetch, code_mode
 */
async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await mcpCallTool(toolName, args);

  if (!result.success) {
    throw new Error(result.error || 'MCP tool call failed');
  }

  return result.data;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Check if a tool name represents the Return action
 */
export function isReturnAction(toolName: string): boolean {
  return toolName === 'Return';
}

/**
 * Check if a tool requires write approval
 */
export function requiresWriteApproval(toolName: string): boolean {
  const writeTools = ['write_neo4j_cypher', 'Write'];
  return writeTools.includes(toolName);
}

/**
 * Get the display name for a tool
 */
export function getToolDisplayName(toolName: string): string {
  const displayNames: Record<string, string> = {
    'read_neo4j_cypher': 'Neo4j Read',
    'write_neo4j_cypher': 'Neo4j Write',
    'get_neo4j_schema': 'Neo4j Schema',
    'search': 'Web Search',
    'fetch': 'Fetch URL',
    'run_tools_with_javascript': 'Code Mode',
    'Return': 'Return Results'
  };
  return displayNames[toolName] || toolName;
}

/**
 * Get the namespace for a tool name
 */
export function getToolNamespace(toolName: string): ToolNamespace | null {
  if (['read_neo4j_cypher', 'write_neo4j_cypher', 'get_neo4j_schema', 'Read', 'Write', 'Schema'].includes(toolName)) {
    return 'neo4j';
  }
  if (['search', 'fetch', 'Search', 'Fetch'].includes(toolName)) {
    return 'web_search';
  }
  if (['run_tools_with_javascript', 'Execute'].includes(toolName)) {
    return 'code_mode';
  }
  return null;
}
