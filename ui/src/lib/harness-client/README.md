# Harness Client

Server-side module that bridges the UI with the `harness-patterns` framework. Handles session management, agent registration, and event streaming.

## File Structure

```
harness-client/
├── actions.server.ts          # processMessage(), processMessageStreaming(), approveAction(), rejectAction()
├── session.server.ts          # In-memory session store (serialized UnifiedContext per sessionId)
├── registry.server.ts         # Registers all agents, exports getAgentMetadata()
├── graph-extractor.ts         # ContextEvent → GraphElement[] extraction (MCP + driver formats; recognises enriched payloads)
├── neo4j-enricher.server.ts   # `onToolResult` recipe — fetches 1-hop neighborhood for touched nodes
├── types.ts                   # GraphElement (extends Cytoscape ElementDefinition)
├── index.ts                   # Public exports
└── examples/                  # 10 pre-built agent configurations (see examples/README.md)
```

## API

### `processMessage(sessionId, message)`

Synchronous agent execution. Delegates to `processMessageWithAgent(sessionId, message, 'default')`.

### `processMessageStreaming(sessionId, message, agentId, onEvent)`

Streaming variant — calls the harness with an `onEvent` callback that fires for each committed `ContextEvent`. Used by the SSE endpoint (`/api/events`).

```typescript
const result = await processMessageStreaming(
  sessionId,
  message,
  'default',
  (evt: ContextEvent) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`))
  }
)
```

### `approveAction(sessionId)` / `rejectAction(sessionId)`

Resume a paused session after user approval or rejection of a write operation.

### `getAgentMetadata()`

Returns metadata for all registered agents (id, name, description, icon).

## Graph Extraction

`extractGraphElements(events)` parses `ContextEvent[]` (specifically `tool_result` events) into `GraphElement[]` for Cytoscape visualization.

Handles two Neo4j result formats:
- **MCP format**: Flat records `{ n: { name, description }, r: [startNode, "TYPE", endNode] }`
- **Neo4j driver format**: Structured objects with `identity`, `labels[]`, `properties{}`

Also handles Memory MCP results (`entities[]`, `relations[]`).

Pattern IDs are mapped to graph sources (`neo4j`, `memory`) for tab filtering in the UI.

### Schema suppression and the plain-object guard (#14)

`get_neo4j_schema` returns an APOC-shaped object (`{ Concept: { type: 'node', count, properties, relationships }, HAS_CONCEPT: { type: 'relationship', count }, … }`) — metadata, not graph data. The extractor short-circuits on this tool name and returns `[]`. The plain-object fallback also rejects values shaped like a schema info bag (`type: 'node' | 'relationship'` with `count`) and refuses to synthesise a node from any object lacking a string `name` / `id` / `title`. Together these stop the schema's relationship-type names from being rendered as fake nodes.

### Enriched-result payload (`_neighborhood` + `_touched`)

When a Neo4j tool's result is wrapped by the enricher hook, the extractor sees:

```ts
{
  rows:          <original tool result>,
  _neighborhood: { rows: [...] },     // 1-hop fetched directly via the driver
  _touched:      ['Redis', 'Cache']    // node names from the original rows
}
```

The extractor processes both `rows` and `_neighborhood.rows` through the same MCP-format parser, deduplicates, then post-processes: any node whose `data.id` is in `_touched` is tagged with `data.touched = true`. The Neo4j panel maps that flag to a magenta highlight via `extraStyles` so the user can see what the agent actually queried (vs. surrounding context).

## Neo4j enricher (`onToolResult` recipe)

`neo4j-enricher.server.ts` exports a `OnToolResult`-shaped function that:

1. Skips non-enrichable tools (only `read_neo4j_cypher` / `write_neo4j_cypher`) and result payloads with no `name` strings.
2. Walks the result for node names (capped at 50).
3. Runs `MATCH (n) WHERE n.name IN $names OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 100` directly on the `neo4j-driver` singleton (`ui/src/lib/neo4j/client.ts`).
4. Serialises records to the MCP cypher tuple shape (`[startProps, "TYPE", endProps]`) — **always in the relationship's actual direction** (`rel.start → rel.end`), not the query-binding order. This keeps edge IDs stable across queries that touch the same rel from either endpoint, so dedup collapses what would otherwise be duplicate edges.
5. Returns the enriched payload above.

Wire it into a pattern via the `onToolResult` config knob (see `harness-patterns/README.md` for the hook spec).

Failures are non-fatal: `simpleLoop` / `actorCritic` catch the throw, log a `recoverable` `error` event, and proceed with the original (un-enriched) result.

## Session Lifecycle

1. First message: `processMessageStreaming()` creates a new `UnifiedContext` and runs the agent
2. Subsequent messages: Deserializes the stored context via `continueSession()`
3. Approval flow: `withApproval()` pattern pauses → `approveAction()`/`rejectAction()` resumes via `resumeHarness()`
4. Agent change: `clearSession()` removes the stored context
