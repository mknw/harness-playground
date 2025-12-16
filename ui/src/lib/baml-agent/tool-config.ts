/**
 * Tool Configuration State Management
 *
 * Manages execution mode, catalog selection, and tool availability
 * for the Tools tab interface.
 */

// ============================================================================
// Types (shared between client and server)
// ============================================================================

/** Execution mode determines which planning flow to use */
export type ExecutionMode = 'static' | 'code';

/** Catalog mode determines which tools are available */
export type CatalogMode = 'minimal' | 'global';

/** Tool configuration state */
export interface ToolConfig {
  executionMode: ExecutionMode;
  catalogMode: CatalogMode;
  selectedTools: string[];
}

/** Default minimal tools - defined as function to avoid initialization issues */
export function getMinimalTools(): string[] {
  return [
    'read_neo4j_cypher',
    'write_neo4j_cypher',
    'get_neo4j_schema',
    'search',
    'fetch_content'
  ];
}

/** Default minimal tools constant (for client-side use) */
export const MINIMAL_TOOLS = getMinimalTools();

// ============================================================================
// Server Functions
// ============================================================================

// Server-side state - lazily initialized to avoid SSR issues
let _currentConfig: ToolConfig | null = null;

function getCurrentConfig(): ToolConfig {
  if (!_currentConfig) {
    _currentConfig = {
      executionMode: 'static',
      catalogMode: 'minimal',
      selectedTools: getMinimalTools()
    };
  }
  return _currentConfig;
}

/**
 * Get the current tool configuration
 */
export async function getToolConfig(): Promise<ToolConfig> {
  "use server";
  const config = getCurrentConfig();
  return { ...config };
}

/**
 * Set the execution mode (static or code)
 */
export async function setExecutionMode(mode: ExecutionMode): Promise<ToolConfig> {
  "use server";
  const config = getCurrentConfig();
  config.executionMode = mode;
  return { ...config };
}

/**
 * Set the catalog mode and update available tools
 * This triggers hot-swap via MCP Gateway
 */
export async function setCatalogMode(mode: CatalogMode): Promise<ToolConfig> {
  "use server";
  const config = getCurrentConfig();
  config.catalogMode = mode;

  // When switching to minimal, reset to default minimal tools
  if (mode === 'minimal') {
    config.selectedTools = getMinimalTools();
  }

  // Note: Actual MCP Gateway hot-swap would happen here
  // For now, we just update the local state
  // await hotSwapCatalog(mode);

  return { ...config };
}

/**
 * Update selected tools
 */
export async function setSelectedTools(tools: string[]): Promise<ToolConfig> {
  "use server";
  const config = getCurrentConfig();
  config.selectedTools = [...tools];
  return { ...config };
}

/**
 * Toggle a specific tool on/off
 */
export async function toggleTool(toolName: string): Promise<ToolConfig> {
  "use server";
  const config = getCurrentConfig();

  const index = config.selectedTools.indexOf(toolName);
  if (index === -1) {
    config.selectedTools.push(toolName);
  } else {
    config.selectedTools.splice(index, 1);
  }

  return { ...config };
}

/**
 * Reset to default configuration
 */
export async function resetToolConfig(): Promise<ToolConfig> {
  "use server";

  _currentConfig = {
    executionMode: 'static',
    catalogMode: 'minimal',
    selectedTools: getMinimalTools()
  };

  return { ..._currentConfig };
}

// ============================================================================
// MCP Gateway Hot-Swap (placeholder)
// ============================================================================

/**
 * Hot-swap catalog via MCP Gateway
 * Uses mcp-add and mcp-remove to enable/disable servers without restart
 */
export async function hotSwapCatalog(mode: CatalogMode): Promise<void> {
  "use server";

  // TODO: Implement actual MCP Gateway hot-swap
  // This would call the MCP Gateway API to:
  // 1. For 'global': enable all servers from catalog.yaml
  // 2. For 'minimal': remove all except MINIMAL_TOOLS servers

  console.log(`[ToolConfig] Hot-swap catalog to: ${mode}`);
}

/**
 * Get available tools from MCP Gateway
 * Returns tool names that can be selected in the UI
 */
export async function getAvailableTools(): Promise<string[]> {
  "use server";
  const config = getCurrentConfig();

  // TODO: Query MCP Gateway for actual available tools
  // For now, return static list based on catalog mode

  if (config.catalogMode === 'minimal') {
    return getMinimalTools();
  }

  // Global mode - return expanded list
  // In production, this would query the MCP Gateway
  return [
    ...getMinimalTools(),
    // Additional tools would be fetched from catalog.yaml
    'brave_search',
    'firecrawl',
    'github',
    'linear',
    'slack',
    'notion'
    // ... more from catalog
  ];
}
