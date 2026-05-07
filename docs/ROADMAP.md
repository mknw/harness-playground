# Knowledge Graph Agent — Project Roadmap

> UI-specific tasks: see [ui/ROADMAP.md](../ui/ROADMAP.md)

---

## Planned / Deferred

### Open follow-ups from the Neo4j panel work
- [ ] [#37](https://github.com/mknw/harness-playground/issues/37) — synthesizer ignores `Return.tool_args` and replays stale "Loop exhausted" error (bug, good first issue)
- [ ] [#38](https://github.com/mknw/harness-playground/issues/38) — `ResizeObserver loop completed with undelivered notifications` when switching to/from Neo4j tab (bug)
- [ ] [#39](https://github.com/mknw/harness-playground/issues/39) — tag each `turns_previous_runs` entry with its originating `user_message` (good first issue, low priority)

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

### Conversation Persistence + Functional Sidebar ✅
Replaced the in-memory session `Map` with a Postgres-backed store; sidebar now shows real threads that survive restarts. Closes #22 (commit `f6b2822`).

- **Schema** — single `conversations(id, user_id, agent_id, title, context jsonb, created_at, updated_at)` table + `(user_id, updated_at DESC)` index. `context` is the full `serializeContext()` blob; no normalization.
- **Idempotent bootstrap** — `ui/src/lib/db/client.server.ts` lazy `pg.Pool` singleton, schema bootstrapped on first query. `DATABASE_URL` overrides the default `postgresql://postgres:password@localhost:5432/kgagent`.
- **Repo layer** — `ui/src/lib/db/conversations.server.ts` exposes `loadConversation`, `saveConversation`, `listConversations`, `deleteConversation`, `deriveTitle`. Title is sticky (`COALESCE(conversations.title, EXCLUDED.title)` on update), derived from the first 60 chars of the first user message.
- **Session layer** — `harness-client/session.server.ts` keeps a process-local pattern cache (BAML clients/closures aren't serializable) and threads `userId` through every load/save. New `loadConversation` + `listConversations` server actions in `actions.server.ts` for the sidebar.
- **Auth** — every public action and `/api/events` / `/api/stash` route authenticates via Stack Auth (or `VITE_DEV_BYPASS_AUTH=true` → `dev-bypass-user`) and scopes session ops by `user.id`.
- **Sidebar (`ChatSidebar.tsx`)** — real threads, "+ New Chat" + selection handlers, selected-thread highlight. `index.tsx` lifts `selectedSessionId`, refetches threads after each turn, hydrates `ChatInterface` via `createEffect` on `props.sessionId` (replays events into graph + observability via existing pipeline).
- **End-to-end resume** — cross-turn data references via `withReferences` / `expandPreviousResult` work after switching threads.

### Harness Patterns Framework ✅
Replaced the legacy `baml-agent` system. Functional, composable agent patterns built on `UnifiedContext`.

- 11 patterns: `simpleLoop`, `actorCritic`, `withApproval`, `withReferences`, `synthesizer`, `router`, `chain`, `parallel`, `judge`, `guardrail`, `hook`
- 10 pre-built agents in registry
- EventView fluent API, BAML adapter factories
- UnifiedContext session persistence + SSE event streaming
- Redis-backed circuit breaker for guardrail pattern

**Docs:** [harness-patterns/README.md](harness-patterns/README.md) · [API reference](harness-patterns/api.md) · [Examples](harness-patterns/examples.md)

### Neo4j Panel Reliability + `onToolResult` Hook ✅
Made the Neo4j visualization tab actually reflect what the agent did. Branch `mknw/issue-14-neo4j-panel`; subsumes #14 and #7.

- **Extractor (`graph-extractor.ts`)** — short-circuits `get_neo4j_schema` (the APOC schema shape was being walked as graph data and rendering relationship-type names as fake nodes — bug #14); tightened the plain-object fallback so it only synthesises a node when a string `name`/`id`/`title` is present and the value isn't a `{type, count, …}` schema-info bag; recognises an enriched `{ rows, _neighborhood, _touched }` payload and tags touched-node IDs.
- **`onToolResult` hook on `SimpleLoopConfig` + `ActorCriticConfig`** (closes #7) — called between `callTool()` and the `tool_result` event commit; can return `{ data }` to replace the result, throws are non-fatal (logged as `recoverable` error). Mirrored in `actorCritic`.
- **`neo4j-enricher.server.ts`** — default recipe: walks the result for `name` strings, fetches a 1-hop neighborhood directly via the `neo4j-driver` singleton, returns the enriched payload. Always serialises the rel tuple in the relationship's actual direction (`rel.start → rel.end`) so edge IDs remain stable across queries that touch the same rel from either endpoint (no duplicate edges).
- **Touched-node highlight** — `TOUCHED_NODE_STYLES` in `SupportPanel` (Neo4j tab only) maps `data.touched` to a magenta fill via `extraStyles`. `mergeGraphElements` (`ui/src/lib/graph-merge.ts`) refreshes the flag per batch so the highlight tracks the most recent enriched query.
- **`json-repair`** — added a single-key fallback for BAML's lossy stringification of object tool_args (`{query: MATCH (c)-[r]-() RETURN c, r}` → previously failed because the unquoted Cypher value contains commas + parens).
- **Fixture-driven tests** — `graph-extractor.test.ts`, `neo4j-enricher.test.ts`, `graph-merge.test.ts` all use real MCP outputs captured against the live gateway. 550/550 tests passing.

**Docs:** [`ui/src/lib/harness-patterns/README.md` § Hooks](../ui/src/lib/harness-patterns/README.md#simpleloopcontroller-tools-config) · [`ui/src/lib/harness-client/README.md` § Neo4j enricher](../ui/src/lib/harness-client/README.md#neo4j-enricher-ontoolresult-recipe)

### Cross-Pattern Data Flow (`withReferences` + `expandPreviousResult`) ✅
Replaced ad-hoc cross-pattern reference passing with a single declarative wrapper plus a synthetic expansion tool. Shipped in [PR #34](https://github.com/mknw/harness-playground/pull/34); subsumes #26 and #29.

- `withReferences(pattern, { scope, source, maxRefs, selector })` — on entry, runs an LLM-driven selector over visible `tool_result` events and attaches relevant ones to the inner pattern's `priorResults` channel via `scope.data.attachedRefs` (issue #30)
- `expandPreviousResult` — synthetic tool injected into the LoopController's tools list when prior results are present; simpleLoop intercepts the call, resolves `ref:<id>` against the event stream, and records a normal `tool_call` / `tool_result` pair plus an `expansions[]` entry on the LoopTurn (issue #19)
- `LoopController` prompt enhanced with `(expanded in turn N)` annotations on compact refs, plus a per-turn `Expanded refs this turn` block — gives the controller self-referential awareness of which prior data has already been pulled into context
- `reference_attached` event type for observability of the selection decision (candidates, selected, reasoning, skipped fast-path)
- Default agent migrated: each route is wrapped with `withReferences({ scope: 'global' })`

**Docs:** [harness-patterns/with-references.md](harness-patterns/with-references.md) · [API reference](../ui/src/lib/harness-patterns/README.md#withreferencespattern-config)

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
- Inline error/warning notifications in chat — contextual error banners surfaced from harness events (PR #20, issue #13)
- `contentTransforms` on EventView — read-time event lens (`stripThinkBlocks`, `truncateToolResults`) without mutating stored state (PR #20, issue #15)

**Docs:** [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md)
