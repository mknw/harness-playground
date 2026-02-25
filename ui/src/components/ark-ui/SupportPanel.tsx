/**
 * Support Panel Component
 *
 * Tabbed interface for knowledge graph visualization and observability tools
 * Tabs: Neo4j Graph | Memory Graph | Observability | Actions | Documents | Tools
 */

import { Tabs } from '@ark-ui/solid/tabs';
import { Show, createSignal, createMemo } from 'solid-js';
import { GraphVisualization } from './GraphVisualization';
import { ObservabilityPanel } from './ObservabilityPanel';
import { ToolsPanel } from './ToolsPanel';
import type { ElementDefinition } from 'cytoscape';
import type { ContextEvent, UnifiedContext } from '~/lib/harness-patterns';

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

// Re-export GraphElement from shared types
export type { GraphElement } from '~/lib/harness-client/types'
import type { GraphElement } from '~/lib/harness-client/types'

export interface SupportPanelProps {
  graphElements: GraphElement[];
  highlightedIds?: string[];
  promptStats?: PromptStat[];
  contextEvents?: ContextEvent[];
  unifiedContext?: UnifiedContext;
  onNodeClick?: (nodeId: string, nodeData: Record<string, unknown>) => void;
  onEdgeClick?: (edgeId: string, edgeData: Record<string, unknown>) => void;
  onClearGraph?: () => void;
  onClearEvents?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const SupportPanel = (props: SupportPanelProps) => {
  const [selectedTab, setSelectedTab] = createSignal('stats');

  // Filter graph elements by source
  const neo4jElements = createMemo(() =>
    props.graphElements.filter(e =>
      e.source === 'neo4j' || !e.source // Default to neo4j if source not specified
    )
  );

  const memoryElements = createMemo(() =>
    props.graphElements.filter(e => e.source === 'memory')
  );

  // Combined elements for "All" view
  const allElements = createMemo(() => props.graphElements);

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
          flex="~ wrap"
          p="x-2"
          gap="1"
        >
          <Tabs.Trigger
            value="neo4j-graph"
            p="x-3 y-2"
            text="sm dark-text-primary"
            cursor="pointer"
            border="b-2 transparent"
            transition="all"
            data-state={selectedTab() === 'neo4j-graph' ? 'active' : 'inactive'}
            style={{
              "border-bottom-color": selectedTab() === 'neo4j-graph' ? '#00ffff' : 'transparent',
              "color": selectedTab() === 'neo4j-graph' ? '#00ffff' : '#a1a1aa'
            }}
          >
            <span mr="1">🗄️</span>
            Neo4j
          </Tabs.Trigger>

          <Tabs.Trigger
            value="memory-graph"
            p="x-3 y-2"
            text="sm dark-text-primary"
            cursor="pointer"
            border="b-2 transparent"
            transition="all"
            data-state={selectedTab() === 'memory-graph' ? 'active' : 'inactive'}
            style={{
              "border-bottom-color": selectedTab() === 'memory-graph' ? '#a855f7' : 'transparent',
              "color": selectedTab() === 'memory-graph' ? '#a855f7' : '#a1a1aa'
            }}
          >
            <span mr="1">🧠</span>
            Memory
          </Tabs.Trigger>

          <Tabs.Trigger
            value="all-graph"
            p="x-3 y-2"
            text="sm dark-text-primary"
            cursor="pointer"
            border="b-2 transparent"
            transition="all"
            data-state={selectedTab() === 'all-graph' ? 'active' : 'inactive'}
            style={{
              "border-bottom-color": selectedTab() === 'all-graph' ? '#22c55e' : 'transparent',
              "color": selectedTab() === 'all-graph' ? '#22c55e' : '#a1a1aa'
            }}
          >
            <span mr="1">🕸️</span>
            All
          </Tabs.Trigger>

          <Tabs.Trigger
            value="stats"
            p="x-3 y-2"
            text="sm dark-text-primary"
            cursor="pointer"
            border="b-2 transparent"
            transition="all"
            data-state={selectedTab() === 'stats' ? 'active' : 'inactive'}
            style={{
              "border-bottom-color": selectedTab() === 'stats' ? '#f59e0b' : 'transparent',
              "color": selectedTab() === 'stats' ? '#f59e0b' : '#a1a1aa'
            }}
          >
            Observability
          </Tabs.Trigger>

          <Tabs.Trigger
            value="tools"
            p="x-3 y-2"
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

          <Tabs.Trigger
            value="actions"
            p="x-3 y-2"
            text="sm dark-text-tertiary"
            cursor="not-allowed"
            opacity="50"
            disabled
          >
            Actions
          </Tabs.Trigger>

          <Tabs.Trigger
            value="docs"
            p="x-3 y-2"
            text="sm dark-text-tertiary"
            cursor="not-allowed"
            opacity="50"
            disabled
          >
            Documents
          </Tabs.Trigger>
        </Tabs.List>

        {/* Tab Content */}
        <div flex="1" overflow="hidden">
          {/* Neo4j Graph Tab */}
          <Tabs.Content value="neo4j-graph" h="full" flex="~ col">
            <GraphTabContent
              elements={neo4jElements()}
              highlightedIds={props.highlightedIds}
              onNodeClick={props.onNodeClick}
              onEdgeClick={props.onEdgeClick}
              onClearGraph={props.onClearGraph}
              emptyMessage="No Neo4j graph data yet. Query your knowledge base to see results."
              emptyIcon="🗄️"
            />
          </Tabs.Content>

          {/* Memory Graph Tab */}
          <Tabs.Content value="memory-graph" h="full" flex="~ col">
            <GraphTabContent
              elements={memoryElements()}
              highlightedIds={props.highlightedIds}
              onNodeClick={props.onNodeClick}
              onEdgeClick={props.onEdgeClick}
              onClearGraph={props.onClearGraph}
              emptyMessage="No memory graph data yet. Use agents that interact with the Memory MCP to see data."
              emptyIcon="🧠"
            />
          </Tabs.Content>

          {/* All Graphs Tab */}
          <Tabs.Content value="all-graph" h="full" flex="~ col">
            <GraphTabContent
              elements={allElements()}
              highlightedIds={props.highlightedIds}
              onNodeClick={props.onNodeClick}
              onEdgeClick={props.onEdgeClick}
              onClearGraph={props.onClearGraph}
              emptyMessage="No graph data yet. Interact with the agent to see results."
              emptyIcon="🕸️"
            />
          </Tabs.Content>

          {/* Observability Tab - ContextEvents based */}
          <Tabs.Content value="stats" h="full">
            <ObservabilityPanel
              events={props.contextEvents ?? []}
              context={props.unifiedContext}
              onClear={props.onClearEvents}
            />
          </Tabs.Content>

          {/* Tools Tab */}
          <Tabs.Content value="tools" h="full">
            <ToolsPanel />
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
        </div>
      </Tabs.Root>
    </div>
  );
};

// ============================================================================
// Graph Tab Content Component
// ============================================================================

interface GraphTabContentProps {
  elements: ElementDefinition[];
  highlightedIds?: string[];
  onNodeClick?: (nodeId: string, nodeData: Record<string, unknown>) => void;
  onEdgeClick?: (edgeId: string, edgeData: Record<string, unknown>) => void;
  onClearGraph?: () => void;
  emptyMessage: string;
  emptyIcon: string;
}

const GraphTabContent = (props: GraphTabContentProps) => {
  const nodeCount = () => props.elements.filter(e => !e.data?.source).length;
  const edgeCount = () => props.elements.filter(e => e.data?.source).length;

  return (
    <>
      {/* Graph Controls Bar */}
      <Show when={props.elements.length > 0}>
        <div
          flex="~"
          items="center"
          justify="between"
          p="2 3"
          bg="dark-bg-tertiary"
          border="b dark-border-primary"
        >
          <div text="xs dark-text-secondary">
            {nodeCount()} nodes, {edgeCount()} edges
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

      {/* Graph or Empty State */}
      <div flex="1" overflow="hidden">
        <Show
          when={props.elements.length > 0}
          fallback={
            <div flex="~ col" items="center" justify="center" h="full" text="center">
              <span text="4xl mb-4">{props.emptyIcon}</span>
              <span text="sm dark-text-secondary" max-w="xs">
                {props.emptyMessage}
              </span>
            </div>
          }
        >
          <GraphVisualization
            elements={props.elements}
            highlightedIds={props.highlightedIds}
            onNodeClick={props.onNodeClick}
            onEdgeClick={props.onEdgeClick}
          />
        </Show>
      </div>
    </>
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
