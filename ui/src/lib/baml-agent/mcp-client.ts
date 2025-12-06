/**
 * MCP Client Wrapper
 *
 * Provides a clean interface to the MCP Gateway using @modelcontextprotocol/sdk.
 * Handles connection management, tool calls, and error handling.
 *
 * Usage:
 * - getMcpClient(): Get or create a connected client
 * - callTool(name, args): Execute an MCP tool
 * - listTools(): Get available tools
 * - closeMcpClient(): Close the connection
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ============================================================================
// Configuration
// ============================================================================

const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL || 'http://localhost:8811/mcp';

// ============================================================================
// Client Singleton
// ============================================================================

let client: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;

/**
 * Get or create an MCP client connected to the gateway
 */
export async function getMcpClient(): Promise<Client> {
  if (client) {
    return client;
  }

  client = new Client({
    name: 'kg-agent',
    version: '1.0.0'
  });

  transport = new StreamableHTTPClientTransport(
    new URL(MCP_GATEWAY_URL)
  );

  await client.connect(transport);
  console.log('🔗 MCP Client connected to', MCP_GATEWAY_URL);

  return client;
}

// ============================================================================
// Tool Operations
// ============================================================================

export interface ToolCallResult {
  success: boolean;
  data: unknown;
  error?: string;
}

/**
 * Call an MCP tool through the gateway
 *
 * @param name - Tool name (e.g., 'read_neo4j_cypher', 'search', 'fetch')
 * @param args - Tool arguments as a record
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  try {
    const c = await getMcpClient();
    const result = await c.callTool({ name, arguments: args });

    // Extract content from MCP response
    if (result.content && Array.isArray(result.content)) {
      // Handle text content
      const textContent = result.content.find(c => c.type === 'text');
      if (textContent && 'text' in textContent) {
        try {
          return {
            success: true,
            data: JSON.parse(textContent.text)
          };
        } catch {
          return {
            success: true,
            data: textContent.text
          };
        }
      }
    }

    // Handle structured content
    if (result.structuredContent) {
      return {
        success: true,
        data: result.structuredContent
      };
    }

    // Fallback to raw result
    return {
      success: true,
      data: result
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('MCP tool call failed:', name, errorMessage);

    return {
      success: false,
      data: null,
      error: errorMessage
    };
  }
}

/**
 * List available tools from the MCP gateway
 */
export async function listTools(): Promise<string[]> {
  try {
    const c = await getMcpClient();
    const { tools } = await c.listTools();
    return tools.map(t => t.name);
  } catch (error) {
    console.error('Failed to list MCP tools:', error);
    return [];
  }
}

/**
 * Get detailed tool information from the MCP gateway
 */
export async function getToolDetails(): Promise<Array<{
  name: string;
  description?: string;
  inputSchema?: unknown;
}>> {
  try {
    const c = await getMcpClient();
    const { tools } = await c.listTools();
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
  } catch (error) {
    console.error('Failed to get MCP tool details:', error);
    return [];
  }
}

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Close the MCP client connection
 */
export async function closeMcpClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
      console.log('🔌 MCP Client disconnected');
    } catch (error) {
      console.error('Error closing MCP client:', error);
    } finally {
      client = null;
      transport = null;
    }
  }
}

/**
 * Check if the MCP client is connected
 */
export function isConnected(): boolean {
  return client !== null;
}

/**
 * Reset the MCP client (close and clear)
 * Useful for reconnecting after errors
 */
export async function resetMcpClient(): Promise<void> {
  await closeMcpClient();
}

// ============================================================================
// Convenience Functions for Common Tools
// ============================================================================

/**
 * Execute a Neo4j read query via MCP
 */
export async function neo4jRead(query: string): Promise<ToolCallResult> {
  return callTool('read_neo4j_cypher', { query });
}

/**
 * Execute a Neo4j write query via MCP
 */
export async function neo4jWrite(query: string): Promise<ToolCallResult> {
  return callTool('write_neo4j_cypher', { query });
}

/**
 * Get Neo4j schema via MCP
 */
export async function neo4jSchema(): Promise<ToolCallResult> {
  return callTool('get_neo4j_schema', {});
}

/**
 * Perform a web search via MCP
 */
export async function webSearch(query: string): Promise<ToolCallResult> {
  return callTool('search', { query });
}

/**
 * Fetch URL content via MCP
 */
export async function fetchUrl(url: string): Promise<ToolCallResult> {
  return callTool('fetch', { url });
}
