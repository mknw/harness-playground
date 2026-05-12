/**
 * MCP Client - Server Only
 *
 * Provides a clean interface to the MCP Gateway.
 * All tool execution routes through this module.
 */

import { assertServerOnImport } from './assert.server';
import type { ToolCallResult, MCPToolDescription } from './types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

assertServerOnImport();

// ============================================================================
// Configuration
// ============================================================================

const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL || 'http://localhost:8811/mcp';

// ============================================================================
// Client Singleton
// ============================================================================

let client: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;

export async function getMcpClient(): Promise<Client> {
  if (client) {
    return client;
  }

  client = new Client({
    name: 'harness-patterns',
    version: '1.0.0'
  });

  transport = new StreamableHTTPClientTransport(new URL(MCP_GATEWAY_URL));
  await client.connect(transport);

  return client;
}

// ============================================================================
// Tool Operations
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  try {
    const c = await getMcpClient();
    const result = await c.callTool({ name, arguments: args });

    // Extract text content
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content.find((c) => c.type === 'text');
      if (textContent && 'text' in textContent) {
        const demoted = demoteErrorString(textContent.text);
        if (demoted) return demoted;
        try {
          return { success: true, data: JSON.parse(textContent.text) };
        } catch {
          return { success: true, data: textContent.text };
        }
      }
    }

    // Structured content or raw result
    return {
      success: true,
      data: result.structuredContent ?? result
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/** Some MCP servers (notably `mcp-neo4j-cypher`'s `write_neo4j_cypher`) report
 *  failures by returning the error message as a normal text result, leaving
 *  the call's `success` indicator implicitly true. Detect that shape and
 *  demote to `{ success: false, error }` so downstream gating
 *  (`view.hasErrors()`, `iteration.success`, the enricher's success guard)
 *  treats it as a real failure. Matches `"<ToolName> Error:"` prefixes
 *  generically — the immediate offender is `"Neo4j Error:"`. */
const ERROR_STRING_PREFIX = /^[A-Z][A-Za-z0-9]*\s+Error:/;

function demoteErrorString(
  text: string
): { success: false; data: null; error: string } | null {
  if (typeof text === 'string' && ERROR_STRING_PREFIX.test(text)) {
    return { success: false, data: null, error: text };
  }
  return null;
}

export async function listTools(): Promise<MCPToolDescription[]> {
  try {
    const c = await getMcpClient();
    const { tools } = await c.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {}
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Connection Management
// ============================================================================

export async function closeMcpClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } finally {
      client = null;
      transport = null;
    }
  }
}

export function isConnected(): boolean {
  return client !== null;
}
