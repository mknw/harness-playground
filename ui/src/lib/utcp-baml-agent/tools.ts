/**
 * Tool Handlers (Agentic Layer)
 *
 * Handlers for UTCP-MCP tool calls within the agentic workflow.
 * These use the UTCP client to execute tools via MCP Gateway.
 *
 * Key difference from neo4j/queries.ts:
 * - Uses UTCP-MCP (via mcp-gateway) for tool execution
 * - Integrates with Thread state for event tracking
 * - Part of the agentic flow (BAML reasoning drives these calls)
 */

import { KGTools } from '../utcp/client';
import { transformNeo4jToCytoscape, parseNeo4jResults } from '../graph/transform';
import type { Thread } from './state';
import type { ElementDefinition } from 'cytoscape';

// ============================================================================
// Types
// ============================================================================

export interface ToolResult {
  graphData?: ElementDefinition[];
  parsed?: {
    nodes?: unknown[];
    relationships?: unknown[];
  };
  raw?: unknown;
  error?: string;
}

// ============================================================================
// Neo4j Tool Handlers (via UTCP-MCP)
// ============================================================================

/**
 * Handle a read Cypher query via UTCP-MCP
 *
 * @param query - The Cypher query to execute
 * @param thread - The thread state to record events
 */
export async function handleReadCypher(
  query: string,
  thread: Thread
): Promise<ToolResult> {
  try {
    // Record tool call
    thread.addToolCall('read_neo4j_cypher', { query }, 'read');

    // Execute via UTCP-MCP
    const results = await KGTools.readCypher(query);

    // Parse and transform results
    const parsed = parseNeo4jResults(results);
    const graphData = transformNeo4jToCytoscape(
      parsed.nodes || [],
      parsed.relationships || []
    );

    // Record successful response
    thread.addToolResponse('read_neo4j_cypher', {
      nodeCount: parsed.nodes?.length || 0,
      relationshipCount: parsed.relationships?.length || 0
    });

    return {
      graphData,
      parsed,
      raw: results
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Record error
    thread.addError(errorMessage, { tool: 'read_neo4j_cypher', query });

    return {
      error: errorMessage
    };
  }
}

/**
 * Handle a write Cypher query via UTCP-MCP
 * Note: This should only be called after user approval
 *
 * @param query - The Cypher query to execute
 * @param thread - The thread state to record events
 */
export async function handleWriteCypher(
  query: string,
  thread: Thread
): Promise<ToolResult> {
  try {
    // Record tool call
    thread.addToolCall('write_neo4j_cypher', { query }, 'write');

    // Execute via UTCP-MCP
    const results = await KGTools.writeCypher(query);

    // Parse and transform results
    const parsed = parseNeo4jResults(results);
    const graphData = transformNeo4jToCytoscape(
      parsed.nodes || [],
      parsed.relationships || []
    );

    // Record successful response
    thread.addToolResponse('write_neo4j_cypher', {
      success: true,
      nodeCount: parsed.nodes?.length || 0,
      relationshipCount: parsed.relationships?.length || 0
    });

    return {
      graphData,
      parsed,
      raw: results
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Record error
    thread.addError(errorMessage, { tool: 'write_neo4j_cypher', query });

    return {
      error: errorMessage
    };
  }
}

/**
 * Get the graph schema via UTCP-MCP
 *
 * @param thread - Optional thread state to record events
 */
export async function handleGetSchema(thread?: Thread): Promise<string> {
  try {
    if (thread) {
      thread.addToolCall('get_neo4j_schema', {}, 'schema');
    }

    const schema = await KGTools.getSchema();

    if (thread) {
      thread.addToolResponse('get_neo4j_schema', { success: true });
    }

    return JSON.stringify(schema, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (thread) {
      thread.addError(errorMessage, { tool: 'get_neo4j_schema' });
    }

    throw error;
  }
}

// ============================================================================
// Web Tool Handlers (via UTCP-MCP)
// ============================================================================

/**
 * Fetch content from a URL via UTCP-MCP
 * Useful for enriching knowledge graph with external data
 *
 * @param url - The URL to fetch
 * @param thread - The thread state to record events
 */
export async function handleFetchUrl(
  url: string,
  thread: Thread
): Promise<{ content?: string; error?: string }> {
  try {
    const { WebTools } = await import('../utcp/client');

    thread.addToolCall('fetch', { url }, 'web');

    const result = await WebTools.fetchUrl(url);
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    thread.addToolResponse('fetch', { success: true, contentLength: content?.length || 0 });

    return { content };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    thread.addError(errorMessage, { tool: 'fetch', url });

    return { error: errorMessage };
  }
}

// ============================================================================
// Tool Execution Helper
// ============================================================================

/**
 * Generic tool executor that routes to the appropriate handler
 *
 * @param toolName - Name of the tool to execute
 * @param parameters - Tool parameters
 * @param thread - Thread state
 */
export async function executeTool(
  toolName: string,
  parameters: Record<string, unknown>,
  thread: Thread
): Promise<ToolResult> {
  switch (toolName) {
    case 'read_neo4j_cypher':
      return handleReadCypher(parameters.query as string, thread);

    case 'write_neo4j_cypher':
      return handleWriteCypher(parameters.query as string, thread);

    case 'get_neo4j_schema': {
      const schema = await handleGetSchema(thread);
      return { raw: schema };
    }

    case 'fetch': {
      const fetchResult = await handleFetchUrl(parameters.url as string, thread);
      return { raw: fetchResult.content, error: fetchResult.error };
    }

    default:
      thread.addError(`Unknown tool: ${toolName}`, { toolName, parameters });
      return { error: `Unknown tool: ${toolName}` };
  }
}
