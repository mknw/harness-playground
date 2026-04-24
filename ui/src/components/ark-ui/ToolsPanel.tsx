/**
 * Tools Panel Component
 *
 * Interface for managing tool configuration:
 * - Execution mode toggle (Static / Code)
 * - Catalog mode toggle (Minimal / Global)
 * - Individual tool selection checkboxes
 */

import { Switch } from '@ark-ui/solid/switch';
import { Checkbox } from '@ark-ui/solid/checkbox';
import { createSignal, createResource, For, Show } from 'solid-js';
import {
  getToolConfig,
  setExecutionMode,
  setCatalogMode,
  toggleTool,
  getAvailableTools,
  MINIMAL_TOOLS,
  fetchCodedTools,
  type ExecutionMode,
  type CatalogMode,
  type CodedTool
} from '~/lib/tool-config';

// ============================================================================
// Component
// ============================================================================

export const ToolsPanel = () => {
  // Local state (mirrors server state)
  const [executionMode, setExecutionModeLocal] = createSignal<ExecutionMode>('static');
  const [catalogMode, setCatalogModeLocal] = createSignal<CatalogMode>('minimal');
  const [selectedTools, setSelectedToolsLocal] = createSignal<string[]>([...MINIMAL_TOOLS]);
  const [isLoading, setIsLoading] = createSignal(false);

  // Fetch initial config (resource used for side effects)
  const [_config] = createResource(async () => {
    const cfg = await getToolConfig();
    setExecutionModeLocal(cfg.executionMode);
    setCatalogModeLocal(cfg.catalogMode);
    setSelectedToolsLocal(cfg.selectedTools);
    return cfg;
  });

  // Fetch available tools based on catalog mode
  const [availableTools] = createResource(catalogMode, getAvailableTools);

  // Fetch coded tools from Neo4j repository
  const [codedTools, { refetch: refetchCodedTools }] = createResource(fetchCodedTools);

  // Handle execution mode toggle
  const handleExecutionModeChange = async (checked: boolean) => {
    setIsLoading(true);
    const mode: ExecutionMode = checked ? 'code' : 'static';
    setExecutionModeLocal(mode);
    await setExecutionMode(mode);
    setIsLoading(false);
  };

  // Handle catalog mode toggle
  const handleCatalogModeChange = async (checked: boolean) => {
    setIsLoading(true);
    const mode: CatalogMode = checked ? 'global' : 'minimal';
    setCatalogModeLocal(mode);
    const updated = await setCatalogMode(mode);
    setSelectedToolsLocal(updated.selectedTools);
    setIsLoading(false);
  };

  // Handle individual tool toggle
  const handleToolToggle = async (toolName: string) => {
    const updated = await toggleTool(toolName);
    setSelectedToolsLocal(updated.selectedTools);
  };

  // Check if tool is selected
  const isToolSelected = (toolName: string) => selectedTools().includes(toolName);

  return (
    <div flex="~ col" h="full" bg="dark-bg-primary" overflow="auto">
      {/* Header */}
      <div p="4" border="b dark-border-primary">
        <h2 text="lg dark-text-primary" font="semibold">Tool Configuration</h2>
        <p text="sm dark-text-tertiary" m="t-1">
          Configure execution mode, catalog, and available tools
        </p>
      </div>

      {/* Loading indicator */}
      <Show when={isLoading()}>
        <div p="2" bg="dark-bg-secondary" text="xs dark-text-secondary" text-align="center">
          Updating configuration...
        </div>
      </Show>

      {/* Mode Switches */}
      <div p="4" border="b dark-border-primary" flex="~ col" gap="4">
        {/* Execution Mode Switch */}
        <div flex="~" items="center" justify="between">
          <div>
            <div text="sm dark-text-primary" font="medium">Execution Mode</div>
            <div text="xs dark-text-tertiary" m="t-0.5">
              {executionMode() === 'static'
                ? 'Static: Uses namespace-specific planners'
                : 'Code: Uses tool composition planner with repository'}
            </div>
          </div>
          <Switch.Root
            checked={executionMode() === 'code'}
            onCheckedChange={(details) => handleExecutionModeChange(details.checked)}
          >
            <Switch.Control
              w="14"
              h="7"
              bg={executionMode() === 'code' ? 'neon-cyan' : 'dark-bg-tertiary'}
              rounded="full"
              p="1"
              cursor="pointer"
              transition="all"
              border="1 dark-border-primary"
              flex="~"
              items="center"
            >
              <Switch.Thumb
                w="5"
                h="5"
                bg="dark-text-primary"
                rounded="full"
                transition="transform 200ms"
                style={{
                  transform: executionMode() === 'code' ? 'translateX(1.75rem)' : 'translateX(0)'
                }}
              />
            </Switch.Control>
            <Switch.HiddenInput />
          </Switch.Root>
        </div>

        {/* Catalog Mode Switch */}
        <div flex="~" items="center" justify="between">
          <div>
            <div text="sm dark-text-primary" font="medium">Catalog Mode</div>
            <div text="xs dark-text-tertiary" m="t-0.5">
              {catalogMode() === 'minimal'
                ? 'Minimal: Neo4j + Web Search only'
                : 'Global: All 50+ MCP servers'}
            </div>
          </div>
          <Switch.Root
            checked={catalogMode() === 'global'}
            onCheckedChange={(details) => handleCatalogModeChange(details.checked)}
          >
            <Switch.Control
              w="14"
              h="7"
              bg={catalogMode() === 'global' ? 'neon-purple' : 'dark-bg-tertiary'}
              rounded="full"
              p="1"
              cursor="pointer"
              transition="all"
              border="1 dark-border-primary"
              flex="~"
              items="center"
            >
              <Switch.Thumb
                w="5"
                h="5"
                bg="dark-text-primary"
                rounded="full"
                transition="transform 200ms"
                style={{
                  transform: catalogMode() === 'global' ? 'translateX(1.75rem)' : 'translateX(0)'
                }}
              />
            </Switch.Control>
            <Switch.HiddenInput />
          </Switch.Root>
        </div>
      </div>

      {/* Available Tools Section */}
      <div p="4" border="b dark-border-primary" flex="~ col" overflow="hidden" style={{ "max-height": "40vh" }}>
        <div flex="~" items="center" justify="between" m="b-3" flex-shrink="0">
          <h3 text="sm dark-text-primary" font="medium">Available Tools</h3>
          <span text="xs dark-text-tertiary">
            {selectedTools().length} of {availableTools()?.length || 0} selected
          </span>
        </div>

        <Show when={availableTools.loading}>
          <div text="xs dark-text-tertiary">Loading tools...</div>
        </Show>

        <Show when={!availableTools.loading && availableTools()}>
          <div flex="~ col 1" gap="2" overflow="auto" p="r-1">
            <For each={availableTools()}>
              {(tool) => (
                <div
                  flex="~"
                  items="center"
                  gap="3"
                  p="2"
                  bg="dark-bg-secondary hover:dark-bg-tertiary"
                  rounded="md"
                  cursor="pointer"
                  transition="all"
                  flex-shrink="0"
                  onClick={(e) => {
                    // Only toggle if not clicking the checkbox directly
                    if (!(e.target as HTMLElement).closest('[data-scope="checkbox"]')) {
                      handleToolToggle(tool);
                    }
                  }}
                >
                  <Checkbox.Root
                    checked={isToolSelected(tool)}
                    onCheckedChange={(_details) => {
                      // Prevent propagation handled via onClick guard above
                      handleToolToggle(tool);
                    }}
                  >
                    <Checkbox.Control
                      w="4"
                      h="4"
                      border="1 dark-border-primary"
                      rounded="sm"
                      bg={isToolSelected(tool) ? 'neon-cyan' : 'transparent'}
                      flex="~"
                      items="center"
                      justify="center"
                    >
                      <Show when={isToolSelected(tool)}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2 6L5 9L10 3"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            style={{ color: '#0d1117' }}
                          />
                        </svg>
                      </Show>
                    </Checkbox.Control>
                    <Checkbox.HiddenInput />
                  </Checkbox.Root>

                  <div flex="1">
                    <div text="sm dark-text-primary">{tool}</div>
                    <div text="xs dark-text-tertiary">
                      {getToolDescription(tool)}
                    </div>
                  </div>

                  {/* Indicator for minimal tools */}
                  <Show when={MINIMAL_TOOLS.includes(tool)}>
                    <span
                      text="xs"
                      p="x-1.5 y-0.5"
                      bg="neon-cyan/10"
                      border="1 neon-cyan/30"
                      rounded="full"
                      style={{ color: '#00ffff' }}
                    >
                      Core
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Coded Tools Repository Section */}
      <div p="4">
        <div flex="~" items="center" justify="between" m="b-3">
          <h3 text="sm dark-text-primary" font="medium">Coded Tools Repository</h3>
          <button
            onClick={() => refetchCodedTools()}
            p="x-2 y-1"
            text="xs dark-text-secondary hover:dark-text-primary"
            bg="dark-bg-secondary hover:dark-bg-tertiary"
            border="1 dark-border-primary"
            rounded="md"
            cursor="pointer"
            transition="all"
          >
            Refresh
          </button>
        </div>

        <Show when={codedTools.loading}>
          <div text="xs dark-text-tertiary">Loading coded tools...</div>
        </Show>

        <Show when={!codedTools.loading && codedTools()?.length === 0}>
          <div
            p="4"
            bg="dark-bg-secondary"
            rounded="md"
            text="center"
          >
            <div text="sm dark-text-secondary">No coded tools yet</div>
            <div text="xs dark-text-tertiary" m="t-1">
              Tools will appear here as they are created and saved during code mode execution
            </div>
          </div>
        </Show>

        <Show when={!codedTools.loading && (codedTools()?.length || 0) > 0}>
          <div flex="~ col" gap="2">
            <For each={codedTools()}>
              {(tool) => (
                <CodedToolCard tool={tool} />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

// ============================================================================
// Coded Tool Card Component
// ============================================================================

interface CodedToolCardProps {
  tool: CodedTool;
}

const CodedToolCard = (props: CodedToolCardProps) => {
  const [isExpanded, setIsExpanded] = createSignal(false);

  return (
    <div
      bg="dark-bg-secondary"
      border="1 dark-border-primary"
      rounded="md"
      overflow="hidden"
    >
      {/* Header */}
      <div
        flex="~"
        items="center"
        justify="between"
        p="3"
        cursor="pointer"
        hover:bg="dark-bg-tertiary"
        onClick={() => setIsExpanded(!isExpanded())}
      >
        <div flex="1">
          <div flex="~" items="center" gap="2">
            <span text="sm dark-text-primary" font="medium">
              {props.tool.name}
            </span>
            <span
              text="xs"
              p="x-1.5 y-0.5"
              bg="neon-orange/10"
              border="1 neon-orange/30"
              rounded="full"
              style={{ color: '#ff6600' }}
            >
              {props.tool.usageCount} uses
            </span>
          </div>
          <div text="xs dark-text-tertiary" m="t-0.5">
            {props.tool.description}
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          style={{
            color: '#a1a1aa',
            transform: isExpanded() ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s'
          }}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded Script View */}
      <Show when={isExpanded()}>
        <div border="t dark-border-primary" p="3" bg="dark-bg-primary">
          <div text="xs dark-text-tertiary" m="b-2">Script:</div>
          <pre
            text="xs dark-text-secondary"
            bg="dark-bg-tertiary"
            p="3"
            rounded="md"
            overflow="auto"
            max-h="200px"
            style={{ "white-space": "pre-wrap", "word-break": "break-all" }}
          >
            {props.tool.script}
          </pre>
          <div text="xs dark-text-tertiary" m="t-2">
            Created: {new Date(props.tool.createdAt).toLocaleString()}
            {props.tool.updatedAt && ` | Updated: ${new Date(props.tool.updatedAt).toLocaleString()}`}
          </div>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Helper Functions
// ============================================================================

/** Get human-readable description for a tool */
function getToolDescription(tool: string): string {
  const descriptions: Record<string, string> = {
    read_neo4j_cypher: 'Execute read queries on Neo4j',
    write_neo4j_cypher: 'Execute write queries on Neo4j',
    get_neo4j_schema: 'Fetch Neo4j database schema',
    search: 'Search the web via DuckDuckGo',
    fetch_content: 'Fetch and parse web page content',
    brave_search: 'Search via Brave Search API',
    firecrawl: 'Advanced web scraping',
    github: 'GitHub API operations',
    linear: 'Linear project management',
    slack: 'Slack messaging',
    notion: 'Notion database operations'
  };

  return descriptions[tool] || 'MCP tool';
}
