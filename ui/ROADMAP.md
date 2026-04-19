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

## Next steps

## Future features
- Show "error, trying again" interesting run within knowledge graph: `.harness-logs/context-cl-3-2026-04-18-consider-error.json`.
