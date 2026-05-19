/**
 * Tools Panel Component
 *
 * Per-conversation tool allowlist for the code-mode agent. Reads/writes the
 * `data.codeModeAllowedTools` field on the conversation's serialized context
 * (Postgres JSONB) via `getCodeModeAllowedTools` / `setCodeModeAllowedTools`.
 * The code-mode agent's `toolNamesProvider` reads the same field live per
 * actor invocation, so checkbox edits take effect on the next turn without
 * a pattern rebuild.
 *
 * The Execution Mode / Catalog Mode switches are reserved for future planner
 * + catalog hot-swap work — disabled in this revision.
 */

import { Switch } from '@ark-ui/solid/switch';
import { Checkbox } from '@ark-ui/solid/checkbox';
import { createSignal, createResource, For, Show } from 'solid-js';
import {
  getCodeModeAllowedTools,
  setCodeModeAllowedTools,
  fetchCodedTools,
  MINIMAL_TOOLS,
  type CodedTool,
} from '~/lib/tool-config';

// ============================================================================
// Component
// ============================================================================

interface ToolsPanelProps {
  /** Active conversation id. Required for the per-conversation allowlist;
   *  when undefined the panel renders an empty state. */
  sessionId?: string;
}

export const ToolsPanel = (props: ToolsPanelProps) => {
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  // Single round-trip: returns allowed + available + meta-tool defaults.
  // Re-fetches when sessionId changes (selecting a different chat).
  const [state, { refetch }] = createResource(
    () => props.sessionId,
    async (sid) => {
      if (!sid) return null;
      try {
        return await getCodeModeAllowedTools(sid);
      } catch (err) {
        console.error('[ToolsPanel] load failed:', err);
        return null;
      }
    },
  );

  const [codedTools, { refetch: refetchCodedTools }] = createResource(fetchCodedTools);

  /** Compute the next allowlist for a click on `tool` and persist it. Meta-
   *  tools (defaults) are locked-on — clicking them is a no-op. */
  const handleToolToggle = async (tool: string) => {
    const sid = props.sessionId;
    const s = state();
    if (!sid || !s) return;
    if (s.defaults.includes(tool)) return; // locked

    const isSelected = s.allowed.includes(tool);
    const next = isSelected ? s.allowed.filter((t) => t !== tool) : [...s.allowed, tool];

    setIsSaving(true);
    setSaveError(null);
    try {
      await setCodeModeAllowedTools(sid, next);
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const isSelected = (tool: string) => state()?.allowed.includes(tool) ?? false;
  const isLocked = (tool: string) => state()?.defaults.includes(tool) ?? false;

  return (
    <div flex="~ col" h="full" bg="dark-bg-primary" overflow="auto">
      {/* Header */}
      <div p="4" border="b dark-border-primary">
        <h2 text="lg dark-text-primary" font="semibold">Tool Configuration</h2>
        <p text="sm dark-text-tertiary" m="t-1">
          Pick which MCP tools the code-mode agent can call in this conversation
        </p>
      </div>

      {/* No session — empty state */}
      <Show when={!props.sessionId}>
        <div p="6" text="center" flex="~ col 1" justify="center" items="center">
          <div text="sm dark-text-secondary">Start a conversation to configure tools.</div>
          <div text="xs dark-text-tertiary" m="t-1">
            The allowlist is saved per chat thread.
          </div>
        </div>
      </Show>

      <Show when={props.sessionId}>
        {/* Saving indicator + error toast */}
        <Show when={isSaving()}>
          <div p="2" bg="dark-bg-secondary" text="xs dark-text-secondary" text-align="center">
            Saving...
          </div>
        </Show>
        <Show when={saveError()}>
          <div p="2" bg="red-900/30" border="b red-700" text="xs" style={{ color: '#fca5a5' }}>
            Save failed: {saveError()}
          </div>
        </Show>

        {/* Mode Switches — reserved for future planner work */}
        <div p="4" border="b dark-border-primary" flex="~ col" gap="4" opacity="60">
          <div flex="~" items="center" justify="between">
            <div>
              <div text="sm dark-text-primary" font="medium">Execution Mode</div>
              <div text="xs dark-text-tertiary" m="t-0.5">
                Static (namespace planners) — code mode toggle coming soon
              </div>
            </div>
            <Switch.Root checked={false} disabled>
              <Switch.Control
                w="14" h="7" bg="dark-bg-tertiary" rounded="full" p="1"
                border="1 dark-border-primary" flex="~" items="center"
                style={{ cursor: 'not-allowed' }}
              >
                <Switch.Thumb w="5" h="5" bg="dark-text-tertiary" rounded="full" />
              </Switch.Control>
              <Switch.HiddenInput />
            </Switch.Root>
          </div>

          <div flex="~" items="center" justify="between">
            <div>
              <div text="sm dark-text-primary" font="medium">Catalog Mode</div>
              <div text="xs dark-text-tertiary" m="t-0.5">
                Gateway eagerly loads all catalog servers — hot-swap UI coming soon
              </div>
            </div>
            <Switch.Root checked={false} disabled>
              <Switch.Control
                w="14" h="7" bg="dark-bg-tertiary" rounded="full" p="1"
                border="1 dark-border-primary" flex="~" items="center"
                style={{ cursor: 'not-allowed' }}
              >
                <Switch.Thumb w="5" h="5" bg="dark-text-tertiary" rounded="full" />
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
              {state()?.allowed.length ?? 0} of {state()?.available.length ?? 0} selected
            </span>
          </div>

          <Show when={state.loading}>
            <div text="xs dark-text-tertiary">Loading tools...</div>
          </Show>

          <Show when={!state.loading && state()}>
            <div flex="~ col 1" gap="2" overflow="auto" p="r-1">
              <For each={state()!.available}>
                {(tool) => (
                  <div
                    flex="~" items="center" gap="3" p="2"
                    bg="dark-bg-secondary hover:dark-bg-tertiary"
                    rounded="md"
                    cursor={isLocked(tool) ? 'not-allowed' : 'pointer'}
                    transition="all" flex-shrink="0"
                    onClick={(e) => {
                      if (isLocked(tool)) return;
                      if (!(e.target as HTMLElement).closest('[data-scope="checkbox"]')) {
                        handleToolToggle(tool);
                      }
                    }}
                  >
                    <Checkbox.Root
                      checked={isSelected(tool)}
                      disabled={isLocked(tool)}
                      onCheckedChange={() => handleToolToggle(tool)}
                    >
                      <Checkbox.Control
                        w="4" h="4" border="1 dark-border-primary" rounded="sm"
                        bg={isSelected(tool) ? 'neon-cyan' : 'transparent'}
                        flex="~" items="center" justify="center"
                      >
                        <Show when={isSelected(tool)}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path
                              d="M2 6L5 9L10 3"
                              stroke="currentColor" stroke-width="2"
                              stroke-linecap="round" stroke-linejoin="round"
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

                    <Show when={isLocked(tool)}>
                      <span
                        text="xs" p="x-1.5 y-0.5"
                        bg="neon-magenta/10" border="1 neon-magenta/30" rounded="full"
                        style={{ color: '#ff66ff' }}
                      >
                        Required
                      </span>
                    </Show>
                    <Show when={!isLocked(tool) && MINIMAL_TOOLS.includes(tool)}>
                      <span
                        text="xs" p="x-1.5 y-0.5"
                        bg="neon-cyan/10" border="1 neon-cyan/30" rounded="full"
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
            <div p="4" bg="dark-bg-secondary" rounded="md" text="center">
              <div text="sm dark-text-secondary">No coded tools yet</div>
              <div text="xs dark-text-tertiary" m="t-1">
                Tools will appear here as they are created and saved during code mode execution
              </div>
            </div>
          </Show>

          <Show when={!codedTools.loading && (codedTools()?.length || 0) > 0}>
            <div flex="~ col" gap="2">
              <For each={codedTools()}>
                {(tool) => <CodedToolCard tool={tool} />}
              </For>
            </div>
          </Show>
        </div>
      </Show>
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
    <div bg="dark-bg-secondary" border="1 dark-border-primary" rounded="md" overflow="hidden">
      <div
        flex="~" items="center" justify="between" p="3"
        cursor="pointer" hover:bg="dark-bg-tertiary"
        onClick={() => setIsExpanded(!isExpanded())}
      >
        <div flex="1">
          <div flex="~" items="center" gap="2">
            <span text="sm dark-text-primary" font="medium">{props.tool.name}</span>
            <span
              text="xs" p="x-1.5 y-0.5"
              bg="neon-orange/10" border="1 neon-orange/30" rounded="full"
              style={{ color: '#ff6600' }}
            >
              {props.tool.usageCount} uses
            </span>
          </div>
          <div text="xs dark-text-tertiary" m="t-0.5">{props.tool.description}</div>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2"
          style={{
            color: '#a1a1aa',
            transform: isExpanded() ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      <Show when={isExpanded()}>
        <div border="t dark-border-primary" p="3" bg="dark-bg-primary">
          <div text="xs dark-text-tertiary" m="b-2">Script:</div>
          <pre
            text="xs dark-text-secondary" bg="dark-bg-tertiary" p="3" rounded="md"
            overflow="auto" max-h="200px"
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

/** Human-readable description for a few well-known tools. Falls back to a
 *  generic label — the upstream MCP listTools response also carries
 *  descriptions, which we could surface here as a follow-up. */
function getToolDescription(tool: string): string {
  const descriptions: Record<string, string> = {
    'mcp-find': 'Search the MCP catalog for available servers',
    'mcp-add': 'Add a catalog server to the gateway',
    'mcp-exec': 'Invoke a tool on a server one-shot',
    'code-mode': 'Register a code-mode-<name> factory tool',
    read_neo4j_cypher: 'Execute read queries on Neo4j',
    write_neo4j_cypher: 'Execute write queries on Neo4j',
    get_neo4j_schema: 'Fetch Neo4j database schema',
    search: 'Search the web via DuckDuckGo',
    fetch_content: 'Fetch and parse web page content',
  };

  return descriptions[tool] || 'MCP tool';
}
