/**
 * Support Panel Component
 *
 * Tabbed interface for knowledge graph visualization and observability tools
 * Tabs: Graph | Observability | Actions | Documents | Tools
 */

import { Tabs } from '@ark-ui/solid/tabs';
import { Show, createSignal } from 'solid-js';
import { GraphVisualization } from './GraphVisualization';
import { ObservabilityPanel } from './ObservabilityPanel';
import { ToolsPanel } from './ToolsPanel';
import type { ElementDefinition } from 'cytoscape';
import type { TelemetryStore } from '~/lib/baml-agent/telemetry-store';

// ============================================================================
// Types
// ============================================================================

export interface PromptStat {
  functionName: string;
  tokens: { input: number; output: number };
  latency: number;
  timestamp: Date;
  status: 'success' | 'error';
}

export interface SupportPanelProps {
  graphElements: ElementDefinition[];
  highlightedIds?: string[];
  promptStats?: PromptStat[];
  telemetryStore?: TelemetryStore;
  onNodeClick?: (nodeId: string, nodeData: Record<string, unknown>) => void;
  onEdgeClick?: (edgeId: string, edgeData: Record<string, unknown>) => void;
  onClearGraph?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const SupportPanel = (props: SupportPanelProps) => {
  const [selectedTab, setSelectedTab] = createSignal('graph');

  return (
    <div flex="~ col" h="full" bg="dark-bg-primary">
      <Tabs.Root
        value={selectedTab()}
        onValueChange={(details) => setSelectedTab(details.value)}
        flex="~ col"
        h="full"
      >
        {/* Tab List */}
        <Tabs.List
          bg="dark-bg-secondary"
          border="b dark-border-primary"
          flex="~"
          p="x-2"
          gap="1"
        >
          <Tabs.Trigger
            value="graph"
            p="x-4 y-2"
            text="sm dark-text-primary"
            cursor="pointer"
            border="b-2 transparent"
            transition="all"
            data-state={selectedTab() === 'graph' ? 'active' : 'inactive'}
            style={{
              "border-bottom-color": selectedTab() === 'graph' ? '#00ffff' : 'transparent',
              "color": selectedTab() === 'graph' ? '#00ffff' : '#a1a1aa'
            }}
          >
            Graph
          </Tabs.Trigger>

          <Tabs.Trigger
            value="stats"
            p="x-4 y-2"
            text="sm dark-text-primary"
            cursor="pointer"
            border="b-2 transparent"
            transition="all"
            data-state={selectedTab() === 'stats' ? 'active' : 'inactive'}
            style={{
              "border-bottom-color": selectedTab() === 'stats' ? '#00ffff' : 'transparent',
              "color": selectedTab() === 'stats' ? '#00ffff' : '#a1a1aa'
            }}
          >
            Observability
          </Tabs.Trigger>

          <Tabs.Trigger
            value="actions"
            p="x-4 y-2"
            text="sm dark-text-tertiary"
            cursor="not-allowed"
            opacity="50"
            disabled
          >
            Actions
          </Tabs.Trigger>

          <Tabs.Trigger
            value="docs"
            p="x-4 y-2"
            text="sm dark-text-tertiary"
            cursor="not-allowed"
            opacity="50"
            disabled
          >
            Documents
          </Tabs.Trigger>

          <Tabs.Trigger
            value="tools"
            p="x-4 y-2"
            text="sm dark-text-primary"
            cursor="pointer"
            border="b-2 transparent"
            transition="all"
            data-state={selectedTab() === 'tools' ? 'active' : 'inactive'}
            style={{
              "border-bottom-color": selectedTab() === 'tools' ? '#ff6600' : 'transparent',
              "color": selectedTab() === 'tools' ? '#ff6600' : '#a1a1aa'
            }}
          >
            Tools
          </Tabs.Trigger>
        </Tabs.List>

        {/* Tab Content */}
        <div flex="1" overflow="hidden">
          {/* Graph Tab */}
          <Tabs.Content value="graph" h="full" flex="~ col">
            {/* Graph Controls Bar */}
            <Show when={props.graphElements.length > 0}>
              <div
                flex="~"
                items="center"
                justify="between"
                p="2 3"
                bg="dark-bg-tertiary"
                border="b dark-border-primary"
              >
                <div text="xs dark-text-secondary">
                  {props.graphElements.filter(e => !e.data?.source).length} nodes,{' '}
                  {props.graphElements.filter(e => e.data?.source).length} edges
                </div>
                <button
                  onClick={() => props.onClearGraph?.()}
                  p="x-2 y-1"
                  text="xs red-400"
                  bg="red-600/10 hover:red-600/20"
                  border="1 red-500/30"
                  rounded="md"
                  cursor="pointer"
                  transition="all"
                >
                  Clear Graph
                </button>
              </div>
            </Show>
            <div flex="1" overflow="hidden">
              <GraphVisualization
                elements={props.graphElements}
                highlightedIds={props.highlightedIds}
                onNodeClick={props.onNodeClick}
                onEdgeClick={props.onEdgeClick}
              />
            </div>
          </Tabs.Content>

          {/* Observability Tab */}
          <Tabs.Content value="stats" h="full">
            <Show
              when={props.telemetryStore}
              fallback={
                <div flex="~" items="center" justify="center" h="full" bg="dark-bg-primary">
                  <div text="center">
                    <svg
                      width="64"
                      height="64"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      style={{"margin":"0 auto", "color":"#4f46e5", "opacity":"0.5"}}
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                    <div text="lg dark-text-secondary" font="medium" m="t-4">
                      Observability Panel
                    </div>
                    <div text="sm dark-text-tertiary" m="t-2" max-w="sm">
                      No telemetry store available
                    </div>
                  </div>
                </div>
              }
            >
              <ObservabilityPanel store={props.telemetryStore!} />
            </Show>
          </Tabs.Content>

          {/* Actions Tab (Future) */}
          <Tabs.Content value="actions" h="full">
            <PlaceholderPanel
              icon="M13 10V3L4 14h7v7l9-11h-7z"
              title="Actions Panel"
              description="Context-based action suggestions, n8n workflow triggers, and file operations"
              phase="Phase 6"
            />
          </Tabs.Content>

          {/* Documents Tab (Future) */}
          <Tabs.Content value="docs" h="full">
            <PlaceholderPanel
              icon="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              title="Document Panel"
              description="File uploads, Google Drive integration, and context management"
              phase="Phase 7"
            />
          </Tabs.Content>

          {/* Tools Tab */}
          <Tabs.Content value="tools" h="full">
            <ToolsPanel />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
};

// ============================================================================
// Placeholder Component
// ============================================================================

interface PlaceholderPanelProps {
  icon: string;
  title: string;
  description: string;
  phase: string;
}

const PlaceholderPanel = (props: PlaceholderPanelProps) => (
  <div flex="~" items="center" justify="center" h="full" bg="dark-bg-primary">
    <div text="center">
      <svg
        width="64"
        height="64"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        style={{"margin":"0 auto", "color":"#4f46e5", "opacity":"0.5"}}
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d={props.icon}
        />
      </svg>
      <div text="lg dark-text-secondary" font="medium" m="t-4">
        {props.title}
      </div>
      <div text="sm dark-text-tertiary" m="t-2" max-w="sm">
        {props.description}
      </div>
      <div text="xs dark-text-tertiary" m="t-4">
        Coming in {props.phase}
      </div>
    </div>
  </div>
);
