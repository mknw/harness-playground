# Knowledge Graph Agent — Project Roadmap

> UI-specific tasks: see [ui/ROADMAP.md](../ui/ROADMAP.md)

---

## Planned / Deferred

### Observability
- [ ] Collapsible sections for large JSON payloads in EventDetailOverlay
- [ ] Show tool input arguments in detail overlay (currently only output/result is shown)

### Code Mode (re-implementation using harness-patterns)
Composable code execution with an evaluate loop. The previous implementation (`lib/baml-agent/`) has been removed. A new implementation should be built on top of harness-patterns.

Core requirements:
- [ ] Evaluate loop with `MAX_RETRIES` and graceful exit after N failures
- [ ] Per-iteration output capture passed as context to the evaluator
- [ ] Rich failure context for each retry iteration (what was tried, what failed, script diff)
- [ ] Intermediate logging per iteration

### MCP Infrastructure
- [ ] MCP catalog hot-swap without gateway restart (currently requires restart after config changes)

### UI
See [ui/ROADMAP.md](../ui/ROADMAP.md) for frontend-specific work: graph editing, Actions tab, Documents tab, Graph Layout improvements.

---

## Completed

### Harness Patterns Framework ✅
Replaced the legacy `baml-agent` system. Functional, composable agent patterns built on `UnifiedContext`.

- 10 patterns: `simpleLoop`, `actorCritic`, `withApproval`, `synthesizer`, `router`, `chain`, `parallel`, `judge`, `guardrail`, `hook`
- 10 pre-built agents in registry
- EventView fluent API, BAML adapter factories
- UnifiedContext session persistence + SSE event streaming
- Redis-backed circuit breaker for guardrail pattern

**Docs:** [harness-patterns/README.md](harness-patterns/README.md) · [API reference](harness-patterns/api.md) · [Examples](harness-patterns/examples.md)

### Neo4j Integration ✅
- Direct `neo4j-driver` for read/write operations
- MCP neo4j result format parsing (flat records + relationship tuples)
- Parameterized Cypher writes from graph UI (`write-action.ts`)
- Manual Cypher input in graph visualization

### UI ✅
- Graph visualization with Cytoscape.js (incremental updates, dark theme, display controls)
- Chat-graph entity linking (hover highlights, click toggles persistent highlight)
- Graph editing: property editing, relation creation, node creation
- Deferred rendering via ResizeObserver; Conversation Sync toggle (⏸/▶)
- SSE event streaming to browser (ObservabilityPanel live updates)

**Docs:** [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md)
