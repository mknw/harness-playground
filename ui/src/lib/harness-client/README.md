# Harness Client

Server-side module that bridges the UI with the `harness-patterns` framework. Handles session management, agent registration, and event streaming.

## File Structure

```
harness-client/
├── actions.server.ts      # processMessage(), processMessageStreaming(), approveAction(), rejectAction()
├── session.server.ts      # In-memory session store (serialized UnifiedContext per sessionId)
├── registry.server.ts     # Registers all agents, exports getAgentMetadata()
├── graph-extractor.ts     # ContextEvent → GraphElement[] extraction
├── types.ts               # GraphElement (extends Cytoscape ElementDefinition)
├── index.ts               # Public exports
└── examples/              # 10 pre-built agent configurations (see examples/README.md)
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

## Session Lifecycle

1. First message: `processMessageStreaming()` creates a new `UnifiedContext` and runs the agent
2. Subsequent messages: Deserializes the stored context via `continueSession()`
3. Approval flow: `withApproval()` pattern pauses → `approveAction()`/`rejectAction()` resumes via `resumeHarness()`
4. Agent change: `clearSession()` removes the stored context
