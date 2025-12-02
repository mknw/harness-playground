/**
 * Graph Visualization Component
 *
 * Interactive graph visualization using Cytoscape.js
 * Displays Neo4j graph data with dark futuristic theme
 *
 * Features:
 * - Multiple layout options
 * - Manual Cypher query input (non-agentic, uses neo4j-driver directly)
 * - Node/edge click handlers
 */

import cytoscape, { type Core, type ElementDefinition, type LayoutOptions } from 'cytoscape';
import { createSignal, onMount, onCleanup, createEffect, Show, For } from 'solid-js';
import { Collapsible } from '@ark-ui/solid/collapsible';
import { runManualCypher, getNodeProperties } from '~/lib/neo4j/queries';

// ============================================================================
// Types
// ============================================================================

export interface GraphVisualizationProps {
  elements: ElementDefinition[];
  onNodeClick?: (nodeId: string, nodeData: Record<string, unknown>) => void;
  onEdgeClick?: (edgeId: string, edgeData: Record<string, unknown>) => void;
  onElementsChange?: (elements: ElementDefinition[]) => void;
  layout?: 'cose' | 'cola' | 'dagre' | 'circle' | 'grid' | 'breadthfirst';
}

type LayoutName = 'cose' | 'cola' | 'dagre' | 'circle' | 'grid' | 'breadthfirst';

// ============================================================================
// Component
// ============================================================================

export const GraphVisualization = (props: GraphVisualizationProps) => {
  let containerRef: HTMLDivElement | undefined;
  let cy: Core | null = null;

  // eslint-disable-next-line solid/reactivity
  const [selectedLayout, setSelectedLayout] = createSignal<LayoutName>(props.layout ?? 'cose');
  const [nodeCount, setNodeCount] = createSignal(0);
  const [edgeCount, setEdgeCount] = createSignal(0);
  const [isLoading, setIsLoading] = createSignal(true);

  // Manual Cypher input state
  const [cypherInput, setCypherInput] = createSignal('');
  const [cypherError, setCypherError] = createSignal<string | null>(null);
  const [isExecuting, setIsExecuting] = createSignal(false);
  const [queryHistory, setQueryHistory] = createSignal<string[]>([]);

  // Selected node state (for properties panel)
  const [selectedNode, setSelectedNode] = createSignal<{
    id: string;
    label: string;
    labels: string[];
    properties: Record<string, unknown> | null;
    position: { x: number; y: number };
  } | null>(null);
  const [isLoadingProps, setIsLoadingProps] = createSignal(false);

  // ========================================
  // Cytoscape Initialization
  // ========================================

  onMount(() => {
    if (!containerRef) return;

    // Ensure container has valid dimensions before initializing
    const rect = containerRef.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn('Graph container has zero dimensions at mount');
    }

    cy = cytoscape({
      container: containerRef,

      // Dark futuristic style
      style: [
        // Node styles
        {
          selector: 'node',
          style: {
            'background-color': '#00ffff',
            'label': 'data(label)',
            'color': '#e4e4e7',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': -8,
            'font-size': '12px',
            'font-family': 'Inter, sans-serif',
            'border-width': 2,
            'border-color': '#4f46e5',
            'width': 50,
            'height': 50,
            'text-wrap': 'wrap',
            'text-max-width': '100px',
            'text-background-opacity': 1,
            'text-background-color': '#0a0a0f',
            'text-background-padding': '4px',
            'text-background-shape': 'roundrectangle'
          }
        },

        // Edge styles
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#4f46e5',
            'target-arrow-color': '#4f46e5',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '10px',
            'font-family': 'Inter, sans-serif',
            'color': '#a1a1aa',
            'text-rotation': 'autorotate',
            'text-background-opacity': 1,
            'text-background-color': '#0a0a0f',
            'text-background-padding': '3px'
          }
        },

        // Selected node
        {
          selector: 'node:selected',
          style: {
            'background-color': '#ff00ff',
            'border-color': '#ff00ff',
            'border-width': 3
          } as Record<string, string | number>
        },

        // Selected edge
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#ff00ff',
            'target-arrow-color': '#ff00ff',
            'width': 3
          }
        },

        // Hover states
        {
          selector: 'node:active',
          style: {
            'overlay-opacity': 0.2,
            'overlay-color': '#00ffff'
          }
        },

        {
          selector: 'edge:active',
          style: {
            'overlay-opacity': 0.2,
            'overlay-color': '#4f46e5'
          }
        }
      ],

      // Initial layout
      layout: getLayoutOptions(selectedLayout())
    });

    // Event handlers
    // eslint-disable-next-line solid/reactivity
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const data = node.data() as Record<string, unknown>;
      const renderedPos = node.renderedPosition();

      // Show properties panel
      setSelectedNode({
        id: node.id(),
        label: (data.label as string) || 'Node',
        labels: (data.labels as string[]) || [],
        properties: (data.properties as Record<string, unknown>) || null,
        position: { x: renderedPos.x, y: renderedPos.y }
      });

      // Also call external handler if provided
      props.onNodeClick?.(node.id(), data);
    });

    // eslint-disable-next-line solid/reactivity
    cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      props.onEdgeClick?.(edge.id(), edge.data() as Record<string, unknown>);
    });

    // Click on background to close panel
    // eslint-disable-next-line solid/reactivity
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
      }
    });

    // Double-click to center on node
    cy.on('dbltap', 'node', (evt) => {
      cy?.animate({
        center: { eles: evt.target },
        zoom: 1.5
      }, {
        duration: 500
      });
    });

    setIsLoading(false);
  });

  // ========================================
  // Reactive Updates
  // ========================================

  // Update graph when elements change
  createEffect(() => {
    console.log('[GraphViz] Effect triggered, elements count:', props.elements.length);

    if (!cy || !containerRef) {
      console.log('[GraphViz] cy or containerRef not ready');
      return;
    }

    // Check container has valid dimensions before rendering
    const rect = containerRef.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn('Graph container has zero dimensions, skipping render');
      return;
    }

    const elements = props.elements;
    console.log('[GraphViz] Processing elements:', elements.length);

    if (elements.length === 0) {
      cy.elements().remove();
      setNodeCount(0);
      setEdgeCount(0);
      return;
    }

    // Update elements
    cy.elements().remove();
    cy.add(elements);

    // Count nodes and edges
    setNodeCount(cy.nodes().length);
    setEdgeCount(cy.edges().length);

    // Resize canvas to match container
    cy.resize();

    // Run layout
    cy.layout(getLayoutOptions(selectedLayout())).run();

    // Fit to viewport with padding
    cy.fit(undefined, 50);
  });

  // Update layout when changed
  const applyLayout = (layoutName: LayoutName) => {
    if (!cy) return;
    setSelectedLayout(layoutName);
    cy.layout(getLayoutOptions(layoutName)).run();
  };

  // ========================================
  // Manual Cypher Handler
  // ========================================

  const handleRunCypher = async () => {
    const query = cypherInput().trim();
    if (!query) return;

    setIsExecuting(true);
    setCypherError(null);

    try {
      const result = await runManualCypher(query);

      if (result.success && result.graphUpdate) {
        // Notify parent of graph update
        props.onElementsChange?.(result.graphUpdate);

        // Add to history (keep last 10)
        setQueryHistory((prev) => {
          const updated = [query, ...prev.filter((q) => q !== query)];
          return updated.slice(0, 10);
        });

        // Clear input after successful execution
        setCypherInput('');
      } else {
        setCypherError(result.error || 'Unknown error');
      }
    } catch (error) {
      setCypherError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd/Ctrl + Enter to run query
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRunCypher();
    }
  };

  // ========================================
  // Node Properties Handler
  // ========================================

  const handleLoadProperties = async () => {
    const node = selectedNode();
    if (!node) return;

    setIsLoadingProps(true);
    try {
      const result = await getNodeProperties(node.id);
      if (result.success && result.properties) {
        // Update selected node with properties
        setSelectedNode({ ...node, properties: result.properties });

        // Also update Cytoscape node data for future clicks
        cy?.getElementById(node.id).data('properties', result.properties);
      }
    } catch (error) {
      console.error('Failed to load properties:', error);
    } finally {
      setIsLoadingProps(false);
    }
  };

  // ========================================
  // Cleanup
  // ========================================

  onCleanup(() => {
    cy?.destroy();
  });

  // ========================================
  // Render
  // ========================================

  return (
    <div flex="~ col" h="full" w="full" bg="dark-bg-primary" position="relative">
      {/* Toolbar */}
      <div
        bg="dark-bg-secondary"
        border="b dark-border-primary"
        p="2"
        flex="~"
        items="center"
        gap="2"
        z="10"
      >
        {/* Layout selector */}
        <div flex="~" items="center" gap="1">
          <span text="xs dark-text-tertiary">Layout:</span>
          <select
            value={selectedLayout()}
            onChange={(e) => applyLayout(e.currentTarget.value as LayoutName)}
            bg="dark-bg-tertiary"
            text="xs dark-text-primary"
            border="1 dark-border-secondary"
            rounded="md"
            p="x-2 y-1"
            cursor="pointer"
          >
            <option value="cose">Force Directed</option>
            <option value="circle">Circle</option>
            <option value="grid">Grid</option>
            <option value="breadthfirst">Hierarchical</option>
          </select>
        </div>

        {/* Stats */}
        <div flex="~ 1" items="center" gap="4" justify="end" text="xs dark-text-tertiary">
          <span>{nodeCount()} nodes</span>
          <span>{edgeCount()} edges</span>
        </div>

        {/* Actions */}
        <button
          onClick={() => cy?.fit(undefined, 50)}
          p="x-3 y-1"
          text="xs dark-text-primary"
          bg="dark-bg-tertiary hover:dark-bg-hover"
          border="1 dark-border-secondary"
          rounded="md"
          cursor="pointer"
          transition="colors"
        >
          Fit View
        </button>

        <button
          onClick={() => cy?.zoom(cy.zoom() * 1.2)}
          p="x-3 y-1"
          text="xs dark-text-primary"
          bg="dark-bg-tertiary hover:dark-bg-hover"
          border="1 dark-border-secondary"
          rounded="md"
          cursor="pointer"
          transition="colors"
        >
          +
        </button>

        <button
          onClick={() => cy?.zoom(cy.zoom() * 0.8)}
          p="x-3 y-1"
          text="xs dark-text-primary"
          bg="dark-bg-tertiary hover:dark-bg-hover"
          border="1 dark-border-secondary"
          rounded="md"
          cursor="pointer"
          transition="colors"
        >
          −
        </button>
      </div>

      {/* Manual Cypher Query Panel */}
      <Collapsible.Root>
        <Collapsible.Trigger
          w="full"
          p="2"
          bg="dark-bg-secondary"
          border="b dark-border-primary"
          text="xs dark-text-secondary"
          cursor="pointer"
          flex="~"
          items="center"
          gap="2"
          transition="colors"
          hover:bg="dark-bg-hover"
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span>Manual Cypher Query</span>
          <Show when={queryHistory().length > 0}>
            <span text="dark-text-tertiary">({queryHistory().length} recent)</span>
          </Show>
        </Collapsible.Trigger>

        <Collapsible.Content
          bg="dark-bg-secondary"
          border="b dark-border-primary"
          p="3"
        >
          {/* Query Input */}
          <div flex="~ col" gap="2">
            <textarea
              value={cypherInput()}
              onInput={(e) => setCypherInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder="MATCH (n) RETURN n LIMIT 10"
              rows="3"
              w="full"
              p="3"
              bg="dark-bg-tertiary"
              text="sm dark-text-primary font-mono"
              border="1 dark-border-secondary"
              rounded="md"
              outline="none focus:border-neon-cyan/50"
              resize="y"
              disabled={isExecuting()}
            />

            <div flex="~" items="center" gap="2">
              <button
                onClick={handleRunCypher}
                disabled={!cypherInput().trim() || isExecuting()}
                p="x-4 y-2"
                text="sm dark-text-primary"
                bg="neon-cyan/20 hover:neon-cyan/30 disabled:opacity-50"
                border="1 neon-cyan/50"
                rounded="md"
                cursor="pointer disabled:cursor-not-allowed"
                transition="all"
                font="medium"
                flex="~"
                items="center"
                gap="2"
              >
                <Show when={isExecuting()} fallback={<span>Run Query</span>}>
                  <span>Executing...</span>
                </Show>
              </button>

              <span text="xs dark-text-tertiary">Cmd/Ctrl + Enter</span>
            </div>

            {/* Error Display */}
            <Show when={cypherError()}>
              <div
                bg="red-500/10"
                border="1 red-500/30"
                rounded="md"
                p="3"
                text="sm red-400"
              >
                <div font="medium" m="b-1">Query Error</div>
                <div font="mono" text="xs">{cypherError()}</div>
              </div>
            </Show>

            {/* Query History */}
            <Show when={queryHistory().length > 0}>
              <div m="t-2">
                <div text="xs dark-text-tertiary" m="b-1">Recent queries:</div>
                <div flex="~ wrap" gap="1">
                  <For each={queryHistory()}>
                    {(query) => (
                      <button
                        onClick={() => setCypherInput(query)}
                        p="x-2 y-1"
                        text="xs dark-text-secondary font-mono"
                        bg="dark-bg-tertiary hover:dark-bg-hover"
                        border="1 dark-border-secondary"
                        rounded="sm"
                        cursor="pointer"
                        transition="colors"
                        max-w="200px"
                        truncate
                        title={query}
                      >
                        {query.length > 30 ? query.substring(0, 30) + '...' : query}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>

      {/* Graph Container */}
      <div ref={containerRef} flex="1" w="full" min-h="200px" position="relative">
        {/* Loading state */}
        <Show when={isLoading()}>
          <div
            {...({
              position: "absolute",
              top: "0",
              left: "0",
              w: "full",
              h: "full",
              flex: "~",
              items: "center",
              justify: "center",
              bg: "dark-bg-primary",
              z: "20"
            } as Record<string, string>)}
          >
            <span text="dark-text-tertiary">Loading graph...</span>
          </div>
        </Show>

        {/* Empty state */}
        <Show when={!isLoading() && nodeCount() === 0}>
          <div
            {...({
              position: "absolute",
              top: "0",
              left: "0",
              w: "full",
              h: "full",
              flex: "~",
              items: "center",
              justify: "center"
            } as Record<string, string>)}
          >
            <div text="center">
              <svg
                width="96"
                height="96"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{"margin":"0 auto", "color":"#4f46e5", "opacity":"0.3"}}
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                />
              </svg>
              <div text="xl dark-text-secondary" font="medium" m="t-4">
                No Graph Data
              </div>
              <div text="sm dark-text-tertiary" m="t-2">
                Ask a question to visualize the knowledge graph
              </div>
            </div>
          </div>
        </Show>

        {/* Node Properties Panel */}
        <Show when={selectedNode()}>
          {(node) => (
            <div
              style={{
                position: 'absolute',
                left: `${Math.min(node().position.x + 60, (containerRef?.clientWidth || 400) - 280)}px`,
                top: `${Math.max(20, Math.min(node().position.y, (containerRef?.clientHeight || 400) - 200))}px`,
                transform: 'translateY(-50%)'
              }}
              bg="dark-bg-secondary"
              border="1 dark-border-primary"
              rounded="lg"
              p="4"
              min-w="64"
              max-w="72"
              shadow="[0_0_20px_rgba(0,0,0,0.5)]"
              z="50"
            >
              {/* Header */}
              <div flex="~" justify="between" items="start" m="b-3" gap="2">
                <div>
                  <div text="sm dark-text-primary" font="semibold">{node().label}</div>
                  <div text="xs dark-text-tertiary">{node().labels.join(', ')}</div>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  p="1"
                  text="dark-text-tertiary hover:dark-text-primary"
                  bg="transparent hover:dark-bg-hover"
                  rounded="md"
                  cursor="pointer"
                  transition="colors"
                >
                  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Properties */}
              <Show
                when={node().properties && Object.keys(node().properties!).length > 0}
                fallback={
                  <div>
                    <div text="xs dark-text-tertiary" m="b-2">No properties loaded</div>
                    <button
                      onClick={handleLoadProperties}
                      disabled={isLoadingProps()}
                      p="x-3 y-2"
                      w="full"
                      text="xs dark-text-primary"
                      bg="neon-cyan/20 hover:neon-cyan/30 disabled:opacity-50"
                      border="1 neon-cyan/50"
                      rounded="md"
                      cursor="pointer disabled:cursor-wait"
                      transition="all"
                      font="medium"
                    >
                      {isLoadingProps() ? 'Loading...' : 'Load Properties'}
                    </button>
                  </div>
                }
              >
                <div text="xs" max-h="48" overflow="y-auto" space="y-2">
                  <For each={Object.entries(node().properties!)}>
                    {([key, value]) => (
                      <div border="b dark-border-secondary" p="b-2">
                        <div text="dark-text-tertiary" font="medium">{key}</div>
                        <div text="dark-text-primary" style={{ "word-break": "break-word" }}>
                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Node ID footer */}
              <div text="xs dark-text-tertiary" m="t-3" p="t-2" border="t dark-border-secondary" font="mono">
                ID: {node().id.substring(0, 20)}...
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};

// ============================================================================
// Layout Configurations
// ============================================================================

function getLayoutOptions(layoutName: LayoutName): LayoutOptions {
  const baseOptions = {
    animate: true,
    animationDuration: 500,
    animationEasing: 'ease-out' as const
  };

  switch (layoutName) {
    case 'cose':
      return {
        name: 'cose',
        ...baseOptions,
        nodeRepulsion: 400000,
        idealEdgeLength: 100,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0
      };

    case 'circle':
      return {
        name: 'circle',
        ...baseOptions,
        radius: undefined,
        spacingFactor: 1.5
      };

    case 'grid':
      return {
        name: 'grid',
        ...baseOptions,
        rows: undefined,
        cols: undefined
      };

    case 'breadthfirst':
      return {
        name: 'breadthfirst',
        ...baseOptions,
        directed: true,
        spacingFactor: 1.5,
        circle: false
      };

    default:
      return {
        name: 'cose',
        ...baseOptions
      };
  }
}
