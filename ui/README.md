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
│   ├── GraphVisualization.tsx  # Cytoscape.js graph with controls, editing, extraStyles
│   ├── SupportPanel.tsx       # Tabbed panel (lazyMount): Neo4j, Memory, All, Context manager, Tools
│   ├── AllGraphTab.tsx        # Turn-based graph explorer (FloatingPanel + color-coded Cytoscape)
│   ├── SettingsPanel.tsx      # Harness settings FloatingPanel (sliders, number inputs)
│   └── ObservabilityPanel.tsx  # Event timeline + LLM call detail
├── lib/
│   ├── harness-patterns/      # Core agent framework (see harness-patterns/README.md)
│   ├── harness-client/
│   │   ├── actions.server.ts        # processMessage(), processMessageStreaming(), listConversations(), loadConversation()
│   │   ├── session.server.ts        # In-process pattern cache + Postgres-backed serialized context (per-user)
│   │   ├── registry.server.ts       # Registers all agents
│   │   ├── graph-extractor.ts       # ContextEvent → GraphElement[] (MCP + driver + enriched payload)
│   │   ├── neo4j-enricher.server.ts # `onToolResult` recipe — fetches 1-hop neighborhood for touched nodes
│   │   └── examples/                # 10 pre-built agent configurations
│   ├── db/
│   │   ├── client.server.ts         # Lazy pg.Pool singleton + idempotent schema bootstrap
│   │   └── conversations.server.ts  # Conversations repo (load/save/list/delete + deriveTitle)
│   ├── settings.ts            # HarnessSettings type, defaults, MODEL_CONTEXT_WINDOWS
│   ├── settings-store.ts      # Client-side reactive store (localStorage persistence)
│   ├── settings-context.server.ts # Request-scoped settings via AsyncLocalStorage
│   ├── turn-utils.ts          # splitIntoTurns(), extractTurnGraphElements()
│   ├── turn-colors.ts         # Per-turn color palette for graph visualization
│   ├── graph-merge.ts         # mergeGraphElements() — accumulator dedup + touched-flag refresh
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

### Conversation Persistence
Conversations are persisted to Postgres in a single `conversations` table; the `context` column holds the full `serializeContext()` blob. The sidebar lists per-user threads via `listConversations()`, and selecting a thread calls `loadConversation()` which rehydrates events into the graph + observability panel. Titles are sticky (first 60 chars of the first user message). Auth is gated by Stack Auth (or `dev-bypass-user` when `VITE_DEV_BYPASS_AUTH=true`). See [`src/lib/harness-client/README.md`](src/lib/harness-client/README.md#session-lifecycle) for the session lifecycle.

### Interactive Graph Visualization
- Cytoscape.js rendering with dark theme and multiple layouts
- Incremental graph updates (additive, preserves positions)
- Entity names in chat messages are interactive: hover highlights graph elements, click toggles persistent highlight
- Visual controls: node size, edge width, font size, edge labels
- Node property editing and relation creation directly from the graph
- **All tab — Turn Explorer**: FloatingPanel with horizontal turn columns, multi-select turns, color-coded per-turn visualization with legend overlay
- `lazyMount` + `unmountOnExit` on tabs prevents idle Cytoscape instances

### Settings & Token Budget
Harness parameters (max tool turns, retries, result truncation, etc.) are configurable via the Settings panel in the sidebar. Settings are persisted to localStorage and sent with each request. On the server, `AsyncLocalStorage` makes them available to all patterns without threading through function signatures. A `trimToFit()` utility in `token-budget.server.ts` drops oldest history entries when the prompt would overflow a model's context window.

### Graph Data Extraction
`graph-extractor.ts` handles two Neo4j result formats:
- **MCP format**: Flat record objects where nodes are `{ name, description, ... }` and relationships are `[startNode, "TYPE", endNode]` tuples
- **Neo4j driver format**: Objects with `identity`/`elementId`, `labels[]`, `properties{}`

It also recognises the **enriched payload** produced by `neo4j-enricher.server.ts` (`{ rows, _neighborhood, _touched }`) — the Neo4j panel uses the `data.touched` flag to highlight the nodes the agent's query actually targeted, while neighborhood context renders in the default cyan. `get_neo4j_schema` results are suppressed entirely (#14: prevented relationship-type names from being rendered as fake nodes). See [`harness-client/README.md`](src/lib/harness-client/README.md#graph-extraction) for the full pipeline.

### Agent Framework
See [harness-patterns/README.md](src/lib/harness-patterns/README.md) for the full API reference. Cross-pattern data flow is handled by `withReferences` ([design](../docs/harness-patterns/with-references.md)) — every default-agent route is wrapped so the inner pattern receives an LLM-curated set of relevant prior `tool_result` events on entry, plus a synthetic `expandPreviousResult` tool the controller can call to load full content.

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
