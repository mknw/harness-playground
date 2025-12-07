# Documentation Index

> **kg-agent**: Knowledge Graph Agent System with BAML, Neo4j, and SolidStart

## Quick Links

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview, quick start, and setup |
| [ROADMAP.md](ROADMAP.md) | Development phases and current status |

---

## Architecture Documentation

### BAML Agent

| Document | Description | Key Sections |
|----------|-------------|--------------|
| [baml_agent/ARCHITECTURE.md](baml_agent/ARCHITECTURE.md) | Streaming agent architecture | 13-step flow, tool namespaces, approval system |

**Source files:**
- `ui/src/lib/utcp-baml-agent/server.ts` - Server functions, tool execution
- `ui/src/lib/utcp-baml-agent/state.ts` - Thread events, serialization
- `ui/src/lib/utcp-baml-agent/orchestrator.ts` - Client-side orchestration
- `ui/baml_src/agent.baml` - BAML function definitions

### UI Frontend

| Document | Description | Key Sections |
|----------|-------------|--------------|
| [UI_ARCHITECTURE.md](UI_ARCHITECTURE.md) | SolidStart frontend structure | UnoCSS, Auth, Chat components, Theme |

**Source files:**
- `ui/src/routes/index.tsx` - Main layout with Splitter
- `ui/src/components/ark-ui/ChatInterface.tsx` - Chat container
- `ui/src/components/ark-ui/GraphVisualization.tsx` - Cytoscape graph
- `ui/uno.config.ts` - UnoCSS configuration

---

## Infrastructure Documentation

### Docker Services

| Document | Description | Key Sections |
|----------|-------------|--------------|
| [DOCKER_COMPOSE.md](DOCKER_COMPOSE.md) | Service configuration | Neo4j, MCP Gateway, n8n setup |

**Source files:**
- `docker-compose.yaml` - Service definitions
- `mcp-config.yaml` - MCP server parameters
- `custom-catalog.yaml` - Custom MCP catalog

### MCP Gateway

| Document | Description | Key Sections |
|----------|-------------|--------------|
| [MCP_GATEWAY.md](MCP_GATEWAY.md) | MCP Gateway reference | Project setup, CLI reference, troubleshooting |

**Configuration:**
- Port: **8811** (verify in `docker-compose.yaml:45,51`)
- Servers: neo4j-cypher, fetch, web_search (verify in `docker-compose.yaml:41`)
- Transport: streaming (verify in `docker-compose.yaml:44`)

---

## Data Management

### Neo4j Data Versioning

| Document | Description | Key Sections |
|----------|-------------|--------------|
| [../neo4j_dumps/README.md](../neo4j_dumps/README.md) | Database versioning workflow | Export, import, reset scripts |

**Scripts:**
- `scripts/export-neo4j.sh` - Export graph to Cypher
- `scripts/import-neo4j.sh` - Import from Cypher dump
- `scripts/reset-neo4j.sh` - Reset to seed data

**Data files:**
- `neo4j_dumps/seed-data.cypher` - Initial graph state

---

## Configuration Reference

### Key Configuration Files

| File | Purpose | Verify |
|------|---------|--------|
| `docker-compose.yaml` | Docker service orchestration | Ports, volumes, depends_on |
| `mcp-config.yaml` | MCP server connection params | Neo4j URI, credentials |
| `custom-catalog.yaml` | Custom MCP server definitions | Image digests, env mappings |
| `.mcp.json` | Claude Code MCP integration | Gateway URL (port 8811) |
| `ui/baml_src/clients.baml` | BAML LLM client config | Groq, OpenAI settings |

### Environment Variables

| Variable | Purpose | Location |
|----------|---------|----------|
| `GROQ_API_KEY` | Groq LLM inference | `ui/.env` |
| `OPENAI_API_KEY` | OpenAI fallback | `ui/.env` |
| `VITE_STACK_PROJECT_ID` | Stack Auth project | `ui/.env` |
| `VITE_STACK_PUBLISHABLE_CLIENT_KEY` | Stack Auth client key | `ui/.env` |

---

## Current Status

**Phase 4 (Tool Execution):** 🔧 In Progress
- Multi-turn tool loop implemented
- Some tools need debugging

**See:** [ROADMAP.md](ROADMAP.md) for full development status.

---

## File Structure Overview

```
kg-agent/
├── docs/                     # This documentation
│   ├── INDEX.md              # You are here
│   ├── ROADMAP.md            # Development roadmap
│   ├── DOCKER_COMPOSE.md     # Docker setup
│   ├── MCP_GATEWAY.md        # MCP Gateway reference
│   ├── UI_ARCHITECTURE.md    # Frontend architecture
│   └── baml_agent/
│       └── ARCHITECTURE.md   # Agent architecture
├── ui/                       # SolidStart frontend
│   ├── baml_src/             # BAML definitions
│   └── src/lib/utcp-baml-agent/  # Agent implementation
├── scripts/                  # Utility scripts
├── neo4j_dumps/              # Graph data exports
├── docker-compose.yaml       # Service orchestration
├── custom-catalog.yaml       # MCP catalog
└── mcp-config.yaml           # MCP configuration
```

---

**Last Updated:** 2025-12-03
