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

/** Drop the singleton so the next getMcpClient() reconnects. Used by the
 *  reconnect-once retry below when an operation fails with a transport-level
 *  error (the gateway restarted while we held a stale connection). */
async function resetMcpClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {
      // best-effort; the connection is already broken
    }
  }
  client = null;
  transport = null;
}

/** Heuristic: does this error look like a dead/closed transport rather than
 *  a tool-level failure? Covers the typical shapes that surface when the
 *  MCP gateway restarts under us. */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('connection closed') ||
    msg.includes('transport') ||
    msg.includes('terminated') ||
    msg.includes('aborted')
  );
}

/** Run an MCP operation with a single reconnect attempt on connection errors.
 *  The first failure resets the client singleton; the second attempt builds a
 *  fresh transport. If that still fails, the error is propagated.
 *
 *  Tool-level errors (the gateway responding with a structured failure) are
 *  not retried — only transport-level errors trigger reconnect. */
async function withReconnect<T>(op: (c: Client) => Promise<T>): Promise<T> {
  try {
    const c = await getMcpClient();
    return await op(c);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    await resetMcpClient();
    const c = await getMcpClient();
    return await op(c);
  }
}

// ============================================================================
// Tool Operations
// ============================================================================

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  try {
    const result = await withReconnect((c) => c.callTool({ name, arguments: args }));

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
    const { tools } = await withReconnect((c) => c.listTools());
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {}
    }));
  } catch (err) {
    // Reconnect already tried once. If we still failed here, this is a real
    // problem (gateway down, URL misconfigured, etc.) — log it loudly so the
    // operator can see it. Returning [] still degrades gracefully for callers
    // that don't want to crash on a missing tool list, but the cause is no
    // longer hidden the way it was before this change.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mcp-client] listTools failed after reconnect:', msg);
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
