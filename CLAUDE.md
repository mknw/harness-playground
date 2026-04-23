# CLAUDE.md

Project-level guidance for Claude Code in this repository.

## Commands

All commands run from `ui/` using `pnpm`:

```bash
pnpm dev              # Dev server on port 3444 (vinxi)
pnpm dev:exposed      # Bind to 0.0.0.0 (required for Docker/Playwright MCP access)
pnpm build            # Runs baml-generate + vinxi build in parallel
pnpm test:run         # Run all tests once (vitest)
pnpm test             # Watch mode
pnpm baml-generate    # Regenerate baml_client/ from baml_src/
pnpm baml-test        # Run BAML tests
pnpm dev:llama        # Start local GLM-4.7-Flash inference server (port 8080)
pnpm exec tsc --noEmit --project tsconfig.json  # Type-check (from ui/)
```

Run a single test file:
```bash
cd ui && pnpm vitest run src/__tests__/lib/harness-patterns/simpleLoop.test.ts
```

Docker services (Neo4j, MCP Gateway, Redis):
```bash
docker compose up -d
docker compose ps
```

---

## Technology Stack

- **Framework:** SolidStart v1.x (file-based routing, server actions, SSE)
- **UI components:** Ark UI (headless, SolidJS bindings)
- **Styling:** UnoCSS with attributify mode — attribute-syntax only, no `class=`
- **Graph:** Cytoscape.js for interactive graph visualization
- **Agent framework:** harness-patterns (see below) — replaces legacy `baml-agent`
- **LLM functions:** BAML (`baml_src/` → `baml_client/`, never edit generated client)
- **Tool access:** MCP Gateway (Docker, port 8811) via `harness-patterns/tools.server.ts`
- **Database:** Neo4j via `neo4j-driver` (direct) + MCP (agentic)
- **Package manager:** pnpm (never npm/npx)

---

## Design Decisions

**Agent framework:** All agentic work uses harness-patterns. The old `lib/baml-agent/` system has been removed. Do not recreate it.

**Server/client boundary:** Files with `.server.ts` suffix are server-only; `assertServerOnImport()` is enforced at runtime. Keep this convention strictly.

**BAML regeneration:** Always run `pnpm baml-generate` after editing any file in `baml_src/`. Never edit `baml_client/` directly.

**UnoCSS attributify:** The `color` HTML attribute conflicts with UnoCSS attributify. Use `text="xs cyan-400"` (combined) instead of separate `color="cyan-400"`.

**Graph data accumulation:** Graph elements accumulate in `index.tsx` regardless of which tab is active. `GraphVisualization` defers layout until its container is visible (ResizeObserver pattern).

---

## Harness Patterns — Quick Reference

Framework in `ui/src/lib/harness-patterns/`. Full API: [`ui/src/lib/harness-patterns/README.md`](ui/src/lib/harness-patterns/README.md).

**BAML functions must use `.bind(b)`:**
```typescript
simpleLoop(b.Neo4jController.bind(b), tools.neo4j, { patternId: 'neo4j-query', schema })
```

**Preferred: use adapter factories instead:**
```typescript
const controller = createNeo4jController(tools.neo4j ?? [])
const actor = createActorControllerAdapter(tools.all)
const critic = createCriticAdapter()
```

**Multi-turn sessions:**
```typescript
// Continue: pass serialized from previous turn
continueSession(serialized, patterns, newInput)
// After approval gate:
resumeHarness(serialized, patterns, approved)
```

**EventView inside patterns:**
```typescript
view.fromLastPattern().ofType('tool_result').get()   // → ContextEvent[]
view.fromPatterns(['neo4j-query']).serialize()        // → XML for LLM
```

### Adding a New Agent

1. Create `ui/src/lib/harness-client/examples/<name>.server.ts` — export `AgentConfig` with `id`, `name`, `description`, `icon`, `servers[]`, `createPatterns`
2. Register in `ui/src/lib/harness-client/registry.server.ts`

---

## BAML Clients

| Client | Role |
|--------|------|
| `RouterFallback` | Intent classification |
| `ControllerFallback` | Tool loop controllers (LocalGLM → GroqReasoning) |
| `CriticFallback` | Evaluation/critique (LocalGLM → GroqEval) |
| `SynthesizerFallback` | Response synthesis |

**Known limitation:** Groq `gpt-oss-120b` fails structured output (`BamlValidationError`) on turn 2+ with larger context. Errors are caught per-iteration and tracked as events; synthesizer reads errors via `view.hasErrors()` (scoped by ViewConfig, so they expire naturally across turns).

---

## MCP Gateway

Docker-based gateway on port 8811.

- `configs/custom-catalog.yaml` — available MCP servers (Docker image-based)
- `configs/mcp-config.yaml` — enable/disable and connection params per server

Tool namespaces in `tools.server.ts`: `neo4j`, `web`, `context7`, `filesystem`, `github`, `memory`, `redis`, `database`, `code` (and `all`).

`KNOWN_TOOL_SERVERS` maps tool names to namespaces when auto-detection would fail.

---

## Styling

UnoCSS attributify mode — always use attribute syntax:
```tsx
<div flex="~ col" text="sm gray-600" p="4" gap="2">
<button bg="cyan-600/10 hover:cyan-600/20" text="xs cyan-400">
```

Custom tokens: `dark-bg-{primary,secondary,tertiary}`, `dark-text-{primary,secondary,tertiary}`, `dark-border-{primary,secondary}`, `neon-{cyan,magenta,purple}`, `cyber-{600,700,800}`.

**Icons** (`@unocss/preset-icons` + `@iconify-json/mdi` installed):
- Use MDI icons via `class="i-mdi-<icon-name>"` (note: requires `class=`, not attributify syntax)
- Example: `<span class="i-mdi-database-outline" style={{ width: '20px', height: '20px', color: '#22d3ee' }} />`
- Browse icons at [https://icones.js.org](https://icones.js.org) — filter by `mdi`
- The `color` HTML attribute conflicts with attributify; use inline `style={{ color: '...' }}` for icon color

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/INDEX.md`](docs/INDEX.md) | Full documentation index |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Project-level planned and completed work |
| [`docs/UI_ARCHITECTURE.md`](docs/UI_ARCHITECTURE.md) | Component structure, data flow, Chat-Graph linking |
| [`ui/README.md`](ui/README.md) | UI quick start and file index |
| [`ui/ROADMAP.md`](ui/ROADMAP.md) | UI deferred tasks |
| [`ui/src/lib/harness-patterns/README.md`](ui/src/lib/harness-patterns/README.md) | Harness patterns full API |
