# UI Roadmap

## Completed

### Graph Visualization (Phase 1)
- [x] Fix MCP result format parsing in graph-extractor (flat records + relationship tuples)
- [x] Incremental graph updates (additive, preserve positions)
- [x] UI controls: node size, edge width, font size, edge labels toggle (collapsible panel)
- [x] Show node properties inline from GraphElement data
- [x] Node label badges in properties panel

### Interactive Chat-Graph Linking
- [x] Entity name extraction from graph elements (node labels + edge labels)
- [x] Annotate assistant message HTML with interactive entity spans
- [x] Hover entity in chat highlights matching graph elements
- [x] Click entity in chat toggles persistent highlight
- [x] CSS styling for `.graph-entity` spans (dashed underline, cyan glow on hover/toggle)

### Graph Editing
- [x] Inline property editing (click pencil icon, edit value, save via Cypher)
- [x] Relation creation mode (click "Create Relation" on source node, then click target)
- [x] Node creation form ("+ Node" toolbar button — Name, Label, Description, persisted via Cypher)
- [x] Parameterized Cypher write server action (`write-action.ts`)

### Graph Tab — Deferred Rendering & Sync Toggle
- [x] Graph renders correctly when tab is inactive during a query (ResizeObserver-based deferred rendering)
- [x] "Conversation Sync" toggle button (⏸/▶) next to "Clear Graph" — pauses live graph updates, freezing the current snapshot

## Deferred

### Graph-to-Chat Linking (reverse direction)
- Graph node click/hover highlights matching mentions in chat messages
- Requires scanning rendered chat HTML for matching entity text and adding highlight class

### Chat Response Entity Extraction (advanced)
- NER-based entity extraction for entities not yet in the graph
- Suggested entity/relation creation from assistant responses

### Graph Layout Improvements
- cola.js / dagre layout plugins for better hierarchical/force layouts
- Layout persistence across sessions
- Minimap for large graphs

### actorCritic Generalization
- Decouple actorCritic from code_mode (currently hardcoded to `ScriptExecutionEvent`)
- Make it a general-purpose actor-critic usable with MCP tools
- Add data stash support (rememberPriorTurns / priorTurnCount)

### Multi-turn Conversation History (Phase 2: Synthesizer + Loop)
- Add `history: Message[]` to BAML `Synthesize` function
- Add optional `history: Message[]` to BAML `LoopController`
- Pass conversation history from EventView to synthesizer and loop patterns

### Actions Tab
- Context-based action suggestions
- n8n workflow trigger UI (list workflows, manual trigger with parameters, webhook config)
- File operations (upload to knowledge graph, export graph data)

### Documents Tab
- File upload interface with drag-and-drop
- Document ingestion into Neo4j: entity extraction, relationship inference, auto node/edge creation
- URL content fetching and ingestion
- Google Drive document import

### Multi-turn Conversation History (Phase 1: Router)
- [x] Fix `applyConfig` bug in EventViewImpl (was calling cloning methods, discarding return values)
- [x] Add `fromLastNTurns` rolling window to ViewConfig + EventView fluent API
- [x] Router extracts message history from last N turns and passes to BAML Router
- [x] Default: `{ fromLast: false, fromLastNTurns: 5, eventTypes: ['user_message', 'assistant_message'] }`

### Data Stash — Cross-Turn Tool Result Memory
- [x] `rememberPriorTurns` / `priorTurnCount` config on `SimpleLoopConfig`
- [x] `ResultDescribe` BAML function for async tool result summarization (`DescribeFallback` client)
- [x] `ToolResultEventData` extended with `summary`, `hidden`, `archived` fields
- [x] `serializeCompact()` and `resolveRefs()` respect hidden/archived flags
- [x] Background summarization fires after SSE response (fire-and-forget from `api/events.ts`)
- [x] Data Stash tab in SupportPanel with Current Turn / Previous Turns / Archived sections
- [x] Hide/unhide/archive/unarchive via `POST /api/stash` with optimistic UI updates

### All Tab — Turn-Based Graph Explorer
- [x] `lazyMount` + `unmountOnExit` on Tabs.Root (prevents hidden Cytoscape instances)
- [x] FloatingPanel turn picker with horizontal turn columns
- [x] Per-turn color-coded Cytoscape visualization
- [x] Turn color legend overlay (bottom-right corner)
- [x] `extraStyles` prop on `GraphVisualization` for dynamic style injection
- [x] `turn-utils.ts` — `splitIntoTurns()`, `extractTurnGraphElements()` utilities

### Settings & Token Budget (Rolling Context Window)
- [x] `HarnessSettings` type with configurable limits: maxToolTurns, maxRetries, maxResultChars, maxResultForSummary, priorTurnCount, routerTurnWindow
- [x] `settings-store.ts` — client-side SolidJS store with localStorage persistence
- [x] `settings-context.server.ts` — request-scoped AsyncLocalStorage; patterns call `getRequestSettings()` at runtime
- [x] `SettingsPanel.tsx` — FloatingPanel in sidebar with sliders + number inputs, reset to defaults
- [x] `token-budget.server.ts` — `trimToFit()` drops oldest history entries when prompt exceeds model context window
- [x] `MODEL_CONTEXT_WINDOWS` map for all BAML clients (GroqFast 32K, GroqReasoning 131K, etc.)
- [x] `max_tokens` set on all BAML clients to prevent unbounded output
- [x] Rolling context window applied in router (history), simpleLoop (turns), and synthesizer (turns)

## Next steps

### Neo4j Tab Real-Time Sync
- Real-time sync of Neo4j tab graph with ongoing conversation (currently accumulates but doesn't reflect deletes/updates)

### Data Stash Improvements
- Improve data result tooltip display in Data Stash (richer formatting, expandable detail)
- Fix `presetIcons` type mismatch in `uno.config.ts` (version skew between `@unocss/preset-icons@66.6` and `unocss@66.5`)
- Investigate graph visualizer not updating when data and connections are fetched separately

### Known Bugs
- Context window overflow: `.harness-logs/context-cl-2-2026-04-23-payload-error.json` — addressed by `max_tokens` on all BAML clients + `trimToFit()` rolling window; monitor for recurrence
- Duplicate assistant message: chat interface returned the same assistant message twice (graph showed correctly, only redis nodes in Neo4j tab)

## Future features
- Show "error, trying again" interesting run within knowledge graph: `.harness-logs/context-cl-3-2026-04-18-consider-error.json`.
