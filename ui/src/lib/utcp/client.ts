/**
 * UTCP Client - Universal Tool Calling Protocol
 *
 * This module provides a unified interface for calling tools across multiple protocols:
 * - MCP (Model Context Protocol) for Neo4j and other MCP servers
 * - HTTP for n8n webhooks and REST APIs
 *
 * Architecture: UTCP-first with MCP integration via @utcp/mcp
 */

import { CodeModeUtcpClient } from '@utcp/code-mode';
import { McpCallTemplateSerializer } from '@utcp/mcp';
import { HttpCallTemplateSerializer } from '@utcp/http';
import '@utcp/mcp';  // Auto-registers MCP protocol
import '@utcp/http';  // Auto-registers HTTP protocol
import '@utcp/dotenv-loader';  // Auto-registers .env loader
import { getEndpoints } from '../config/endpoints';

// ============================================================================
// Client Instance Management
// ============================================================================

let clientInstance: CodeModeUtcpClient | null = null;

/**
 * Get or create the UTCP client singleton
 * Uses CodeModeUtcpClient for advanced features like tool composition
 */
export async function getUtcpClient(): Promise<CodeModeUtcpClient> {
  if (clientInstance) {
    return clientInstance;
  }

  const endpoints = getEndpoints();
  const mcpSerializer = new McpCallTemplateSerializer();
  const httpSerializer = new HttpCallTemplateSerializer();

  // ========================================
  // MCP Gateway Integration
  // ========================================
  // Connects to Docker's MCP Gateway which hosts:
  // - neo4j-cypher: Neo4j database tools
  // - fetch: Web content retrieval

  const mcpTemplate = mcpSerializer.validateDict({
    name: 'kg_mcp',
    call_template_type: 'mcp',
    config: {
      mcpServers: {
        'neo4j-cypher': {
          transport: 'sse',  // MCP Gateway uses streaming (SSE) transport
          url: endpoints.mcpGateway,
          timeout: 60,  // 60 seconds for complex queries
          sse_read_timeout: 600,  // 10 minutes for long-running operations
          terminate_on_close: true
        },
        'fetch': {
          transport: 'sse',  // MCP Gateway uses streaming (SSE) transport
          url: endpoints.mcpGateway,
          timeout: 30,
          sse_read_timeout: 300,
          terminate_on_close: true
        }
      }
    }
  });

  // ========================================
  // n8n Webhook Integration
  // ========================================
  // Direct HTTP integration (not via MCP)
  // Allows triggering n8n workflows

  const n8nTemplate = httpSerializer.validateDict({
    name: 'n8n_webhooks',
    call_template_type: 'http',
    http_method: 'POST',
    url: `${endpoints.n8n}/webhook/\${webhook_id}`,
    headers: {
      'Content-Type': 'application/json'
    },
    body_field: 'data',
    timeout: 30000  // 30 seconds
  });

  // ========================================
  // Initialize Client
  // ========================================

  clientInstance = await CodeModeUtcpClient.create(
    process.cwd(),
    {
      variables: {},
      load_variables_from: [],
      tool_repository: 'local',
      tool_search_strategy: 'local_then_remote',
      post_processing: 'none',
      manual_call_templates: [mcpTemplate, n8nTemplate]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CodeModeUtcpClient has loose typing
    } as any
  );

  console.log('✅ UTCP Client initialized successfully');
  console.log('   - MCP Gateway:', endpoints.mcpGateway);
  console.log('   - n8n:', endpoints.n8n);

  return clientInstance;
}

/**
 * Close the UTCP client and cleanup resources
 * Important: Call this to properly terminate MCP sessions
 */
export async function closeUtcpClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
    console.log('✅ UTCP Client closed');
  }
}

// ============================================================================
// Type-Safe Tool Wrappers
// ============================================================================

/**
 * Knowledge Graph Tools
 * Type-safe wrappers for Neo4j operations via MCP
 *
 * Tool naming convention: kg_mcp.neo4j-cypher.{tool_name}
 */
export const KGTools = {
  /**
   * Get the Neo4j graph schema
   * Returns information about node labels, relationship types, and properties
   */
  async getSchema(): Promise<unknown> {
    const client = await getUtcpClient();
    return await client.callTool('kg_mcp.neo4j-cypher.get_neo4j_schema', {});
  },

  /**
   * Execute a read-only Cypher query
   * @param query - The Cypher query to execute
   */
  async readCypher(query: string): Promise<unknown> {
    const client = await getUtcpClient();
    return await client.callTool('kg_mcp.neo4j-cypher.read_neo4j_cypher', {
      query
    });
  },

  /**
   * Execute a write Cypher query (creates, updates, deletes)
   * @param query - The Cypher query to execute
   */
  async writeCypher(query: string): Promise<unknown> {
    const client = await getUtcpClient();
    return await client.callTool('kg_mcp.neo4j-cypher.write_neo4j_cypher', {
      query
    });
  }
};

/**
 * Web Tools
 * Fetch content from URLs via MCP fetch server
 */
export const WebTools = {
  /**
   * Fetch content from a URL
   * @param url - The URL to fetch
   */
  async fetchUrl(url: string): Promise<unknown> {
    const client = await getUtcpClient();
    return await client.callTool('kg_mcp.fetch.fetch', { url });
  }
};

/**
 * n8n Workflow Tools
 * Trigger n8n workflows via HTTP webhooks
 */
export const N8nTools = {
  /**
   * Trigger an n8n workflow
   * @param webhookId - The webhook ID configured in n8n
   * @param data - Data to pass to the workflow
   */
  async triggerWorkflow(webhookId: string, data: unknown): Promise<unknown> {
    const client = await getUtcpClient();
    return await client.callTool('n8n_webhooks.post', {
      webhook_id: webhookId,
      data
    });
  }
};

// ============================================================================
// Advanced Features
// ============================================================================

/**
 * Execute a TypeScript tool chain using CodeMode
 * Allows composing multiple tool calls with TypeScript logic
 *
 * @param code - TypeScript code to execute with tool access
 * @param timeout - Execution timeout in milliseconds (default: 30000)
 */
export async function executeToolChain(
  code: string,
  timeout: number = 30000
): Promise<{ result: unknown; logs: string[] }> {
  const client = await getUtcpClient();
  return await client.callToolChain(code, timeout);
}

/**
 * Get all available tools from the UTCP client
 * Useful for tool discovery and debugging
 */
export async function getAvailableTools(): Promise<unknown[]> {
  const client = await getUtcpClient();
  return await client.getTools();
}

/**
 * Search for tools by query
 * @param query - Search query string
 * @param limit - Maximum number of results
 */
export async function searchTools(query: string, limit?: number): Promise<unknown[]> {
  const client = await getUtcpClient();
  return await client.searchTools(query, limit);
}
