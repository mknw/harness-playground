# Documentation Index

> **kg-agent**: Knowledge Graph Agent System — Neo4j, BAML, harness-patterns, SolidStart UI

## Quick Links

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview and quick start |
| [ROADMAP.md](ROADMAP.md) | Single roadmap (project + UI; `ui/ROADMAP.md` retired 2026-05-21) |

---

## Architecture Documentation

### Harness Patterns Framework

| Document | Description |
|----------|-------------|
| [harness-patterns/README.md](harness-patterns/README.md) | Overview, core concepts, quick start |
| [harness-patterns/api.md](harness-patterns/api.md) | Complete API reference |
| [harness-patterns/frontend.md](harness-patterns/frontend.md) | SolidStart integration, server actions, sessions |
| [harness-patterns/examples.md](harness-patterns/examples.md) | Example agent catalog (10 agents) |
| [harness-patterns/parallel.md](harness-patterns/parallel.md) | Parallel pattern design notes |
| [harness-patterns/with-references.md](harness-patterns/with-references.md) | `withReferences` meta-pattern + `expandPreviousResult` synthetic tool design (#30, #19) |
| [harness-patterns/withReferences-tutorial.md](harness-patterns/withReferences-tutorial.md) | Hands-on walkthrough — search the web, attach refs at ingress, write to Neo4j |

Authoritative source-level docs (closer to the code):
- [`ui/src/lib/harness-patterns/README.md`](../ui/src/lib/harness-patterns/README.md) — full framework API
- [`ui/src/lib/harness-client/examples/README.md`](../ui/src/lib/harness-client/examples/README.md) — example implementations

### UI Frontend

| Document | Description |
|----------|-------------|
| [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md) | Component structure, data flow, Chat-Graph linking, theme |

Source-level index: see [ui/README.md](../ui/README.md#documentation-index).

---

## Infrastructure Documentation

| Document | Description |
|----------|-------------|
| [DOCKER_COMPOSE.md](DOCKER_COMPOSE.md) | Neo4j, MCP Gateway, Redis service configuration |
| [MCP_GATEWAY.md](MCP_GATEWAY.md) | MCP Gateway reference, CLI, troubleshooting |
| [sandbox-plan.md](sandbox-plan.md) | Sandbox compute plan — `withSandbox` wrapper, attachment model, MCP-in-VM architecture, backend interface (Docker + Firecracker), substrate options, failure modes |

**Key config files:**
- `docker-compose.yaml` — service orchestration
- `configs/mcp-config.yaml` — MCP server connection params
- `configs/custom-catalog.yaml` — custom MCP server definitions (Docker image-based)
- `.mcp.json` — Claude Code MCP integration (gateway URL port 8811)

---

## Data Management

| Document | Description |
|----------|-------------|
| [../neo4j_dumps/README.md](../neo4j_dumps/README.md) | Database versioning: export, import, reset |

Scripts: `scripts/export-neo4j.sh` · `scripts/import-neo4j.sh` · `scripts/reset-neo4j.sh`

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | Groq LLM inference (GroqFast, GroqGPT120B, GroqQwen3_32b) |
| `OPENROUTER_API_KEY` | OpenRouter models (Nemotron, Gemma4, MiniMax) |
| `OPENAI_API_KEY` | OpenAI models (GPT-5, GPT-5 Mini, GPT-5 Nano) |
| `ANTHROPIC_API_KEY` | Anthropic models (Opus 4, Sonnet 4, Haiku) |
| `VITE_STACK_PROJECT_ID` | Stack Auth project |
| `VITE_STACK_PUBLISHABLE_CLIENT_KEY` | Stack Auth client key |
| `STACK_SECRET_SERVER_KEY` | Stack Auth server key (used by `lib/auth/session.ts` to resolve users on the server) |
| `VITE_ALLOWED_EMAILS` | Comma-separated allow-list; supports `*@domain.com` wildcards |
| `VITE_DEV_BYPASS_AUTH` | `'true'` to skip auth in dev (gated on `import.meta.env.DEV`; ignored in prod builds). See `ui/.env.example` and `lib/auth/dev-bypass.ts` |

---

## File Structure

```
kg-agent/
├── docs/
│   ├── INDEX.md                 # You are here
│   ├── ROADMAP.md               # Project roadmap
│   ├── UI_ARCHITECTURE.md       # Frontend architecture
│   ├── DOCKER_COMPOSE.md        # Docker setup
│   ├── MCP_GATEWAY.md           # MCP Gateway reference
│   └── harness-patterns/        # Harness patterns documentation
│       ├── README.md            # Overview
│       ├── api.md               # API reference
│       ├── examples.md          # Example agents
│       ├── frontend.md          # Frontend integration
│       ├── parallel.md          # Parallel pattern design
│       └── with-references.md   # withReferences meta-pattern design (#30)
├── ui/
│   ├── README.md                # UI quick start + index
│   ├── ROADMAP.md               # UI deferred tasks
│   └── src/lib/
│       ├── harness-patterns/    # Pattern framework (source + README.md)
│       └── harness-client/      # Frontend integration layer (examples/README.md)
├── configs/                     # MCP and catalog configurations
├── scripts/                     # Utility scripts
├── neo4j_dumps/                 # Graph data exports
└── docker-compose.yaml
```
