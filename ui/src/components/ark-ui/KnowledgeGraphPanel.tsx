export const KnowledgeGraphPanel = () => {
  return (
    <div flex="~ col" h="full" bg="dark-bg-primary">
      {/* Header */}
      <div p="4" border="b dark-border-primary">
        <h2 text="lg dark-text-primary" font="semibold">
          Knowledge Graph
        </h2>
        <p text="sm dark-text-secondary" m="t-1">
          Visual representation of entities and relationships
        </p>
      </div>

      {/* Graph Content Area */}
      <div flex="1" p="4" overflow="hidden">
        {/* Placeholder for graph visualization */}
        <div
          flex="~"
          items="center"
          justify="center"
          h="full"
          border="2 dashed dark-border-secondary"
          rounded="lg"
          bg="dark-bg-secondary/30"
        >
          <div text="center">
            <div text="6xl neon-cyan/30" m="b-4">
              <svg
                width="96"
                height="96"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{"margin":"0 auto"}}
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                />
              </svg>
            </div>
            <div text="xl dark-text-secondary" font="medium">
              Knowledge Graph Visualization
            </div>
            <div text="sm dark-text-tertiary" m="t-2" max-w="md">
              This panel will display the knowledge graph visualization based on the chat context.
              Nodes and relationships will appear here as you interact with the system.
            </div>
          </div>
        </div>
      </div>

      {/* Footer / Controls */}
      <div p="4" border="t dark-border-primary" flex="~" gap="2" justify="end" bg="dark-bg-secondary/50">
        <button
          p="x-3 y-2"
          text="sm dark-text-primary"
          bg="dark-bg-tertiary hover:dark-bg-hover"
          border="1 dark-border-secondary"
          rounded="md"
          transition="colors"
        >
          Reset View
        </button>
        <button
          p="x-3 y-2"
          text="sm white"
          bg="cyber-700 hover:cyber-600"
          rounded="md"
          transition="all"
          shadow="hover:[0_0_15px_rgba(79,70,229,0.5)]"
        >
          Export Graph
        </button>
      </div>
    </div>
  )
}
