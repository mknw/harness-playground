# Knowledge Graph Agent — Project Roadmap

> Single source of truth. The previous split with `ui/ROADMAP.md` was retired 2026-05-21; UI work lives here now.

---

## Active trajectory: Ontology Validator agent

The next stretch of work is sequenced around shipping the puzzle-based ontology validator ([#73](https://github.com/mknw/harness-playground/issues/73)). Each step removes a blocker for the next.

1. [ ] [#17](https://github.com/mknw/harness-playground/issues/17) — Ingest ontologies to Neo4j (RDF / OWL). Structural prerequisite: the validator has nothing to validate without a real TBox+ABox. Interim: commit a curated seed ontology to `neo4j_dumps/` plus documented modeling conventions (TBox axiom labels, ABox assertion labels, reserved relationship types for `(:Hypothesis)` / `(:Change)`).
2. [ ] [#72](https://github.com/mknw/harness-playground/issues/72) — Prune non-working example agents from registry; rename `default`. The validator registers into a clean two-agent registry instead of a list of broken examples.
3. [ ] [#28](https://github.com/mknw/harness-playground/issues/28) — Per-agent branch-coverage tests. Strongly nice-to-have alongside #72 so the validator inherits the test scaffolding instead of duplicating it inside #73's acceptance criteria.
4. [ ] [#73](https://github.com/mknw/harness-playground/issues/73) — Ontology Validator agent v0 (contradiction seeds → premise/conclusion puzzles → ratify into TBox/ABox).

**Follow-up after #73 ships:** [#75](https://github.com/mknw/harness-playground/issues/75) — Ontology Alignment via puzzle ratification. Reuses #73's puzzle infrastructure to ratify cross-ontology mappings.

**Nice-to-haves that improve #73's UX but don't block v0:** [#76](https://github.com/mknw/harness-playground/issues/76) (generative UI — puzzles render as real MCQ chips instead of "type a number"), [#15](https://github.com/mknw/harness-playground/issues/15) (contentTransforms keep critic prompts clean), [#27](https://github.com/mknw/harness-playground/issues/27) (planner pattern simplifies seed-harvest), [#32](https://github.com/mknw/harness-playground/issues/32) (in-harness data tools for large ontology subgraphs), [#53](https://github.com/mknw/harness-playground/issues/53) (router back-references for "skip this one" iteration), [#70](https://github.com/mknw/harness-playground/issues/70) (intent-aware summarization of priors).

**Gap to confirm during step 1:** explicit TBox/ABox modeling conventions in Neo4j. If #17 doesn't cover this, spin a sub-ticket before #73 starts.

---

## Adjacent direction: BAML tracing observability + UnifiedContext serialization

Earlier framing as a context-window / token-budget concern (closed [#74](https://github.com/mknw/harness-playground/issues/74)) was misaligned with current code. The real spine: BAML traces today live in terminal logs and `.harness-logs/*.json`, not in UnifiedContext. Making them first-class events (alongside `tool_call`, `tool_result`, `controller_action`, …) unlocks:

- Surfacing call detail in the observability panel (the existing LLM-call overlay only partially renders trace data)
- Round-tripping through `serializeContext()` so traces persist with the conversation
- Downstream consumers: export ([#67](https://github.com/mknw/harness-playground/issues/67)), replay, summarization, token-usage accounting

No active ticket yet — spin one when this becomes load-bearing for #73 or [#67](https://github.com/mknw/harness-playground/issues/67).

---

## Planned / Deferred

### Harness patterns
- [ ] [#76](https://github.com/mknw/harness-playground/issues/76) — **GenUI: Allowlist tree.** Agent-composed primitives in a new Interactive side-panel tab. New `interactiveUI` pattern generalizing `withApproval`'s pause/resume to arbitrary structured input (MCQ, Form, Slider, MultiSelect, …). Allowlisted SolidJS primitives, no arbitrary JS. Natural early consumer: #73 puzzle UI.
- [ ] [#77](https://github.com/mknw/harness-playground/issues/77) — **GenUI: Generative Surface.** Companion to #76, different shape. Sandboxed iframe with bridge to UnifiedContext + DataStash, for speculative/creative UI the agent authors freely (HTML/CSS/JS). Inspired by Gemini's "non-deterministic OS" experiments, fenced from committed state via a `propose()` confirmation flow. mcp-ui adoption decided during v0.
- [ ] [#15](https://github.com/mknw/harness-playground/issues/15) — `contentTransforms` on EventView (extended read-time lens work)
- [ ] [#27](https://github.com/mknw/harness-playground/issues/27) — Planner pattern for upfront task decomposition
- [ ] [#32](https://github.com/mknw/harness-playground/issues/32) — Harness-internal data tools (expand_data, archive_data, remove_turn, summarize_result, extract_subset, search_within_results, truncate_result)
- [ ] [#53](https://github.com/mknw/harness-playground/issues/53) — Router: classify intent in the context of the conversation, not just the latest message
- [ ] [#70](https://github.com/mknw/harness-playground/issues/70) — Summarize (don't truncate) prior web_search / fetch results in cross-turn references
- [ ] [#39](https://github.com/mknw/harness-playground/issues/39) — Tag each `turns_previous_runs` entry with its originating `user_message`
- [ ] [#37](https://github.com/mknw/harness-playground/issues/37) — Synthesizer ignores `Return.tool_args` and replays stale "Loop exhausted" error
- [ ] First-class **Skill** abstraction for pattern factories. Today the code-mode agent ships its actor guidance as an inlined `contextPrefix` string + `fewShots` array (see `ui/src/lib/harness-client/examples/code_mode_actor_critic.md`). Once Skill support exists, that content moves into a reusable Skill the actor receives via the standard mechanism; other actorCritic / simpleLoop users would migrate the same way.

### Agents
- [ ] [#72](https://github.com/mknw/harness-playground/issues/72) — Prune non-working agents; rename `default` *(active trajectory step 2)*
- [ ] [#73](https://github.com/mknw/harness-playground/issues/73) — Ontology Validator agent *(active trajectory step 4)*
- [ ] [#75](https://github.com/mknw/harness-playground/issues/75) — Ontology Alignment *(follow-up to #73)*
- [ ] [#28](https://github.com/mknw/harness-playground/issues/28) — Per-agent branch-coverage tests *(active trajectory step 3)*

### Code-mode follow-ups
- [ ] [#64](https://github.com/mknw/harness-playground/issues/64) — Investigate `code-mode-<name>({script})` execution environment + host write capability
- [ ] [#65](https://github.com/mknw/harness-playground/issues/65) — Skip `ResultDescribe` for `code-mode` factory calls (templated summary saves ~1–2K tokens + one Groq dep per factory call)
- [ ] [#69](https://github.com/mknw/harness-playground/issues/69) — Improve cross-turn memory reuse and tool-name discipline

### Compute backend
- [ ] [#79](https://github.com/mknw/harness-playground/issues/79) — **`withSandbox` wrapper + compute backend** (implementation). Harness wrapper that attaches a stateful microVM to a controller pattern, exposing filesystem / shell / Python tools to the actor via MCP servers running *inside* the VM. No second deployable: the substrate is operational config (rootfs image + init scripts), not application code. v0 substrate: Docker for dev + bootstrap prod; remote Azure KVM worker (running `FirecrackerBackend`) is the target prod once the abstraction proves out. Full design: [`docs/sandbox-plan.md`](./sandbox-plan.md). Composes with `chain` / `withReferences` / `withApproval` and (forward-looking, untested) `parallel` / `parallelMap` — the wrapper has no awareness of being composed.
- [ ] [#78](https://github.com/mknw/harness-playground/issues/78) — **Firecracker microVM** (capability story + rootfs flavor catalog). The "fourth pillar" alongside chat, storage (DataStash + Neo4j), and display (Cytoscape + future Generative Surface). Unlocks Python with real libraries — Polars over spreadsheets, PDF/Word extraction, NER/embedding pipelines, Python project clones. Canonical example: in-chat data analysis. Rootfs flavor catalog (heavier deps beyond the v0 `base` flavor) + `FirecrackerBackend` land here; the wrapper + backend abstraction is proven in #79 first.

### Data ingestion & storage
- [ ] [#17](https://github.com/mknw/harness-playground/issues/17) — Ingest ontologies to Neo4j (RDF / OWL) *(active trajectory step 1)*
- [ ] [#6](https://github.com/mknw/harness-playground/issues/6) — Redis-backed document storage for Data Stash uploads
- [ ] [#8](https://github.com/mknw/harness-playground/issues/8) — Embedding utility via OpenRouter for vector generation
- [ ] [#9](https://github.com/mknw/harness-playground/issues/9) — Document chunking utility for the embedding pipeline

### MCP Infrastructure
- [ ] MCP catalog hot-swap without gateway restart

### Observability & export
- [ ] BAML tracing as first-class UnifiedContext events *(see Adjacent direction above)*
- [ ] [#67](https://github.com/mknw/harness-playground/issues/67) — Export popup: raw BAML logs vs. unified context (sibling of the tracing direction)
- [ ] [#10](https://github.com/mknw/harness-playground/issues/10) — Server-side graph extraction via onToolResult, emitting `graph_update` SSE events
- [ ] Collapsible sections for large JSON payloads in EventDetailOverlay
- [ ] Show tool input arguments in detail overlay (currently only output/result)

### UI
- [ ] [#18](https://github.com/mknw/harness-playground/issues/18) — Graph visualization rewind with timeline scrubber
- [ ] [#58](https://github.com/mknw/harness-playground/issues/58) — Mobile-first responsive design pass
- [ ] [#60](https://github.com/mknw/harness-playground/issues/60) / [#61](https://github.com/mknw/harness-playground/issues/61) — Show agent icon below chat title in sidebar (near-duplicates; consolidate)
- [ ] [#71](https://github.com/mknw/harness-playground/issues/71) — Sidebar: delete conversations (single + bulk via select-mode)
- [ ] Graph-to-Chat reverse linking (graph node click/hover highlights matching chat mentions)
- [ ] Chat-response NER-based entity extraction (entities not yet in the graph; suggested creation)
- [ ] Graph layout improvements: cola.js / dagre plugins, layout persistence across sessions, minimap for large graphs
- [ ] Actions Tab: context-based action suggestions, n8n workflow trigger UI (list / manual trigger / webhook config), file operations
- [ ] Documents Tab: file upload with drag-and-drop, document ingestion into Neo4j (entity extraction + relationship inference), URL fetching, Google Drive import
- [ ] Multi-turn conversation history Phase 2: thread `history: Message[]` into BAML `Synthesize` + `LoopController`
- [ ] Neo4j Tab real-time sync (currently accumulates; doesn't reflect deletes/updates)
- [ ] Data Stash improvements: richer result-tooltip formatting, expandable detail, fix `presetIcons` type mismatch in `uno.config.ts` (`@unocss/preset-icons@66.6` vs `unocss@66.5`), investigate viz not updating when data + connections are fetched separately
- [ ] Surface "error, trying again" runs within the knowledge graph (see `.harness-logs/context-cl-3-2026-04-18-consider-error.json`)

### Misc
- [ ] [#68](https://github.com/mknw/harness-playground/issues/68) — Typed env-config module centralizing `process.env.*` reads with loud validation

---

## Recently shipped

### 2026-05
- **Critic owns loop exit + Anthropic-default routing** (`8455052`, `922177a`). Reshaped `actorCritic` so the critic alone decides loop exit; dropped the assistant prefill. Cross-provider rate limits made mixed-provider routing too noisy for dev → Anthropic-only became the default, mixed chains gated on `USE_MIXED_CHAINS=1`.
- **Code Mode as a dedicated agent** (closes [#12](https://github.com/mknw/harness-playground/issues/12), PR [#66](https://github.com/mknw/harness-playground/pull/66)). The kg-agent gateway's `code-mode` tool is a *factory* (args `{name, servers}`) that registers a new `code-mode-<name>` tool bound to the listed MCP servers. Lives at `ui/src/lib/harness-client/examples/code-mode.server.ts` as `router → routes(chain(actorCritic, synthesizer))`. Added `dynamicToolPattern: RegExp` to `actorCritic` + `simpleLoop`, cross-turn tool reuse via `createActorControllerAdapter`'s `refreshOnCall + dynamicPattern`, and `invalidateToolDescriptions()` so freshly-registered tools appear in the actor's next prompt.
- **Session ID UUIDs + composer auto-focus** (closes [#52](https://github.com/mknw/harness-playground/issues/52), PR [#63](https://github.com/mknw/harness-playground/pull/63)). Replaced Solid's `createUniqueId()` (`cl-${counter}` reset on reload, collided with persisted rows) with `crypto.randomUUID()` + RFC-4122-v4 manual fallback for non-secure contexts. `+ New Chat` now lands focus in the composer.
- **Failed LLM call prompt + vars in error events** (closes [#31](https://github.com/mknw/harness-playground/issues/31), PR [#59](https://github.com/mknw/harness-playground/pull/59)). Error events carry what was sent so the observability panel can show the failing call.
- **Auth dev-bypass centralization** (closes [#42](https://github.com/mknw/harness-playground/issues/42), PR [#62](https://github.com/mknw/harness-playground/pull/62)). Unified user-id resolution across server actions, `/api/events`, `/api/stash`.
- **Observability tab overhaul** (closes [#51](https://github.com/mknw/harness-playground/issues/51), PR [#54](https://github.com/mknw/harness-playground/pull/54)).
- **ResizeObserver defer on GraphVisualization unmount** (closes [#38](https://github.com/mknw/harness-playground/issues/38), PR [#55](https://github.com/mknw/harness-playground/pull/55)).
- **Neo4j errors demoted to `success: false`** (closes [#50](https://github.com/mknw/harness-playground/issues/50), PR [#56](https://github.com/mknw/harness-playground/pull/56)) — Cypher failures flow as normal tool results instead of thrown errors.
- **LLM-generated conversation titles** via a minimal harness agent (`8ad4afd`); runs from `/api/events` after the first response.
- **Sidebar progress + submit guard + optimistic new-chat row** (closes [#44](https://github.com/mknw/harness-playground/issues/44), [#47](https://github.com/mknw/harness-playground/issues/47), PR [#57](https://github.com/mknw/harness-playground/pull/57)).
- **Conversation persistence + functional sidebar** (closes [#22](https://github.com/mknw/harness-playground/issues/22), PR [#41](https://github.com/mknw/harness-playground/pull/41)). Single `conversations(id, user_id, agent_id, title, context jsonb, created_at, updated_at)` table; `context` is the full `serializeContext()` blob; sticky titles via `COALESCE`; per-user scoping (Stack Auth + `dev-bypass-user` when `VITE_DEV_BYPASS_AUTH=true`).
- **Neo4j panel reliability + `onToolResult` hook** (closes [#14](https://github.com/mknw/harness-playground/issues/14), [#7](https://github.com/mknw/harness-playground/issues/7), PR [#40](https://github.com/mknw/harness-playground/pull/40)). Graph-extractor short-circuits `get_neo4j_schema` (was rendering relationship-type names as fake nodes); `neo4j-enricher.server.ts` fetches a 1-hop neighborhood for touched nodes via the `neo4j-driver` singleton; magenta `data.touched` highlight via `extraStyles`.

### 2026-05-02
- **Cross-pattern data flow: `withReferences` + `expandPreviousResult`** (closes [#30](https://github.com/mknw/harness-playground/issues/30), [#19](https://github.com/mknw/harness-playground/issues/19), PR [#34](https://github.com/mknw/harness-playground/pull/34)). `withReferences(pattern, { scope, source, maxRefs, selector })` runs an LLM-driven selector over visible `tool_result` events on entry and attaches relevant ones to the inner pattern's `priorResults`. `expandPreviousResult` synthetic tool resolves `ref:<id>` against the event stream and records a normal `tool_call`/`tool_result` pair. Default agent migrated to wrap each route in `withReferences({ scope: 'global' })`.
- **Per-pattern `fewShots`** (closes [#16](https://github.com/mknw/harness-playground/issues/16), PR [#36](https://github.com/mknw/harness-playground/pull/36)). `simpleLoop` + `actorCritic` accept `fewShots: FewShot[]`; threaded through to BAML.

### 2026-04
- **Live event streaming per pattern** (PR [#25](https://github.com/mknw/harness-playground/pull/25)). `liveEvents: true` on per-pattern config so events stream via SSE as they're committed.
- **Cumulative chain progress bar with cross-pattern status** (`7f325a3`, `01b5c22`, `eee45aa`).
- **Cerebras fallback** added as a separate-quota safety net at the end of each chain.
- **Inline error/warning notifications in chat** (closes [#13](https://github.com/mknw/harness-playground/issues/13), PR [#20](https://github.com/mknw/harness-playground/pull/20)).
- **`contentTransforms` on EventView** (`d4dfe0f`, partially closes [#15](https://github.com/mknw/harness-playground/issues/15)). Read-time event lens (`stripThinkBlocks`, `truncateToolResults`) without mutating storage; remaining lens work tracked under #15.
- **Settings UI + token budget + turn-based graph explorer** (`77e91ed`). `HarnessSettings` + localStorage store + AsyncLocalStorage request-scoping; `SettingsPanel` (sliders, number inputs); `token-budget.server.ts` (`trimToFit`) drops oldest history when prompt would exceed model context.
- **Data Stash — cross-turn tool result memory** (`1d03ded`). `rememberPriorTurns` / `priorTurnCount` config; async `ResultDescribe` summarization; `ToolResultEventData.{summary, hidden, archived}`; Data Stash tab; hide/archive via `POST /api/stash`.
- **Multi-turn router history** (`7b2ffb1`). Router consumes the last N `user_message` / `assistant_message` events via the EventView fluent API.
- **Chat-graph entity linking** (`85a355c`). Interactive entity spans in assistant messages — hover highlights graph elements, click toggles persistent highlight. Graph editing wired (property edit, relation create, node create).

### Foundational
- **Harness Patterns framework** (PR [#5](https://github.com/mknw/harness-playground/pull/5)). Replaced the legacy `baml-agent` system. Patterns: `simpleLoop`, `actorCritic`, `withApproval`, `withReferences`, `synthesizer`, `router`, `routes`, `chain`, `parallel`, `judge`, `guardrail`, `hook`. EventView fluent API, BAML adapter factories, UnifiedContext + `serializeContext()`, SSE event streaming.
- **Graph visualization (Cytoscape.js)**. Incremental updates, dark theme, display controls, All Tab Turn Explorer (FloatingPanel + per-turn color coding via `extraStyles`), deferred rendering via ResizeObserver, Conversation Sync toggle.
- **Neo4j integration**. Direct `neo4j-driver` for read/write; MCP result format parsing (flat records + relationship tuples); parameterized Cypher writes from graph UI.
