# KG-Agent UI

SolidStart application providing a chat interface for agentic knowledge graph operations. Combines a composable pattern framework (`harness-patterns`) with MCP tool servers for Neo4j, web search, memory, filesystem, and more.

## Quick Start

```bash
pnpm install
docker compose up -d          # Neo4j, MCP Gateway, Redis
pnpm baml-generate            # Generate BAML client from baml_src/
pnpm dev                      # Dev server on port 3444
```

## Architecture

```
src/
├── routes/
│   ├── index.tsx              # Main page (Splitter: Chat + SupportPanel)
│   └── api/events.ts          # SSE endpoint for streaming agent events
├── components/ark-ui/
│   ├── ChatInterface.tsx      # Sends messages, streams SSE, entity highlighting
│   ├── ChatMessages.tsx       # Markdown rendering with interactive graph entity spans
│   ├── GraphVisualization.tsx  # Cytoscape.js graph with controls, editing, relation creation
│   ├── SupportPanel.tsx       # Tabbed panel: Neo4j, Memory, All, Observability, Tools
│   └── ObservabilityPanel.tsx  # Event timeline + LLM call detail
├── lib/
│   ├── harness-patterns/      # Core agent framework (see harness-patterns/README.md)
│   ├── harness-client/
│   │   ├── actions.server.ts  # processMessage(), processMessageStreaming()
│   │   ├── session.server.ts  # In-memory session store
│   │   ├── registry.server.ts # Registers all agents
│   │   ├── graph-extractor.ts # ContextEvent → GraphElement[] (MCP + driver formats)
│   │   └── examples/          # 10 pre-built agent configurations
│   ├── neo4j/
│   │   ├── queries.ts         # Schema, manual Cypher, node properties
│   │   └── write-action.ts    # Parameterized Cypher writes from graph UI
│   └── graph/
│       ├── transform.ts       # Neo4j driver → Cytoscape transforms
│       └── extractors.ts      # ToolEvent → graph element extraction
└── baml_client/               # Auto-generated from baml_src/ (never edit)
```

## Key Features

### SSE Event Streaming
Agent events stream to the client in real-time via `POST /api/events`. The UI updates the graph visualization and observability panel incrementally as events arrive.

### Interactive Graph Visualization
- Cytoscape.js rendering with dark theme and multiple layouts
- Incremental graph updates (additive, preserves positions)
- Entity names in chat messages are interactive: hover highlights graph elements, click toggles persistent highlight
- Visual controls: node size, edge width, font size, edge labels
- Node property editing and relation creation directly from the graph

### Graph Data Extraction
`graph-extractor.ts` handles two Neo4j result formats:
- **MCP format**: Flat record objects where nodes are `{ name, description, ... }` and relationships are `[startNode, "TYPE", endNode]` tuples
- **Neo4j driver format**: Objects with `identity`/`elementId`, `labels[]`, `properties{}`

### Agent Framework
See [harness-patterns/README.md](src/lib/harness-patterns/README.md) for the full API reference.

## Commands

```bash
pnpm dev              # Dev server (port 3444)
pnpm dev:exposed      # Bind to 0.0.0.0 (for Docker/Playwright)
pnpm build            # baml-generate + vinxi build
pnpm test:run         # All tests (vitest)
pnpm test             # Watch mode
pnpm baml-generate    # Regenerate baml_client/
pnpm baml-test        # Run BAML tests
```

## Adding a New Agent

1. Create `src/lib/harness-client/examples/<name>.server.ts` exporting an `AgentConfig`
2. Register it in `src/lib/harness-client/registry.server.ts`

See [examples/README.md](src/lib/harness-client/examples/README.md) for detailed patterns.

---

## Documentation Index

| File | Contents |
|------|----------|
| [ROADMAP.md](ROADMAP.md) | Completed work and deferred frontend tasks |
| [src/lib/harness-patterns/README.md](src/lib/harness-patterns/README.md) | Harness patterns full API reference |
| [src/lib/harness-client/examples/README.md](src/lib/harness-client/examples/README.md) | Example agent implementations (10 agents) |
| [../docs/UI_ARCHITECTURE.md](../docs/UI_ARCHITECTURE.md) | Component structure, data flow, Chat-Graph linking |
| [../docs/INDEX.md](../docs/INDEX.md) | Full project documentation index |
