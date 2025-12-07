# kg-agent: Knowledge Graph Agent System

A knowledge graph agent system with a BAML-powered AI agent, Neo4j graph database, SolidStart UI, and MCP Gateway for tool integration.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SolidStart UI (Port 3000)                    │
│  ┌─────────────┐  ┌────────────────┐  ┌───────────────────────┐ │
│  │ Chat        │  │ Graph          │  │ Support Panel         │ │
│  │ Interface   │  │ Visualization  │  │ (Observability/Tools) │ │
│  └──────┬──────┘  └────────────────┘  └───────────────────────┘ │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              BAML Agent (Server Functions)                │   │
│  │  RouteUserMessage → Tool Loop → CreateToolResponse        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────────┐  ┌──────────┐
     │ Neo4j      │  │ MCP Gateway    │  │ n8n      │
     │ (Direct)   │  │ (Port 8811)    │  │ (5678)   │
     │ Port 7687  │  │ web_search,    │  │ Workflows│
     └────────────┘  │ fetch, etc.    │  └──────────┘
                     └────────────────┘
```

## Requirements

- Docker Desktop
- Node.js >= 22
- pnpm

## Quick Start

```bash
# 1. Start backend services
docker compose up -d

# 2. Wait for Neo4j health check (check with docker compose ps)
docker compose ps

# 3. Load seed data into Neo4j
./scripts/import-neo4j.sh neo4j_dumps/seed-data.cypher

# 4. Start the UI
cd ui
pnpm install
pnpm dev
```

**Access Points:**
- **UI**: http://localhost:3000
- **Neo4j Browser**: http://localhost:7474 (neo4j/password)
- **MCP Gateway**: http://localhost:8811/mcp
- **n8n** (optional): http://localhost:5678

## Services

All services run in Docker containers via the `app-network` bridge network:

| Service | Port | Description | Config File Reference |
|---------|------|-------------|----------------------|
| **Neo4j** | 7474, 7687 | Graph database with APOC and n10s plugins | `docker-compose.yaml:17-35` |
| **MCP Gateway** | 8811 | Model Context Protocol gateway for AI tools | `docker-compose.yaml:37-56` |
| **n8n** | 5678 | Workflow automation (optional) | `docker-compose.yaml:1-15` |

## BAML Agent

The agent uses [BAML](https://docs.boundaryml.com/) for structured LLM reasoning with type-safe outputs.

### Core Flow

1. **RouteUserMessage** - Detect intent and determine tool needs
2. **Tool Loop** (max 5 turns) - Plan and execute tools with namespace-specific handlers
3. **CreateToolResponse** - Synthesize results into user-friendly response

### Tool Namespaces

| Namespace | Tools | Execution Method |
|-----------|-------|------------------|
| `neo4j` | read_neo4j_cypher, write_neo4j_cypher, get_neo4j_schema | Direct neo4j-driver |
| `web_search` | web_search (DuckDuckGo), fetch | MCP Gateway |
| `code_mode` | JavaScript multi-tool composition | MCP Gateway |

See [docs/baml_agent/ARCHITECTURE.md](docs/baml_agent/ARCHITECTURE.md) for detailed architecture.

## MCP Servers

The system uses three MCP servers configured in `custom-catalog.yaml`:

### neo4j-cypher
- **Tools**: `get_neo4j_schema`, `read_neo4j_cypher`, `write_neo4j_cypher`
- **Purpose**: Execute Cypher queries against Neo4j
- **Note**: Uses custom catalog with fixed `NEO4J_URI` mapping (not `NEO4J_URL`)

### fetch
- **Tools**: `fetch`
- **Purpose**: Retrieve content from the web

### web_search
- **Tools**: `web_search`
- **Purpose**: DuckDuckGo web search for information retrieval

## Neo4j Database

**Access**: http://localhost:7474
**Credentials**: neo4j / password
**Plugins**: APOC, n10s (neosemantics)

### Data Versioning

Binary database files are **gitignored**. Graph data is version-controlled as human-readable Cypher:

```bash
# Export current graph state
./scripts/export-neo4j.sh

# Import from a Cypher dump
./scripts/import-neo4j.sh neo4j_dumps/seed-data.cypher

# Reset to seed data
./scripts/reset-neo4j.sh
```

See [neo4j_dumps/README.md](neo4j_dumps/README.md) for the complete workflow.

### Reset Database

If you encounter authentication issues or need a fresh start:

```bash
docker compose down
rm -rf neo4j_data
docker compose up -d
./scripts/import-neo4j.sh neo4j_dumps/seed-data.cypher
```

## Configuration Files

| File | Purpose | Key Settings |
|------|---------|--------------|
| `docker-compose.yaml` | Service orchestration | Ports, volumes, healthchecks |
| `mcp-config.yaml` | MCP server connection parameters | Neo4j URI, credentials |
| `custom-catalog.yaml` | Custom MCP catalog with tool definitions | Server images, env mappings |
| `.mcp.json` | Claude Code MCP integration | Gateway endpoint |
| `ui/baml_src/*.baml` | BAML function definitions | Agent prompts, types |

## Project Structure

```
kg-agent/
├── docker-compose.yaml       # Docker service orchestration
├── mcp-config.yaml           # MCP server configuration
├── custom-catalog.yaml       # Custom MCP catalog
├── .mcp.json                  # Claude Code MCP config
├── neo4j_dumps/              # Cypher exports for data versioning
│   ├── README.md
│   └── seed-data.cypher
├── scripts/                  # Utility scripts
│   ├── export-neo4j.sh
│   ├── import-neo4j.sh
│   └── reset-neo4j.sh
├── ui/                       # SolidStart frontend
│   ├── baml_src/             # BAML function definitions
│   │   ├── agent.baml
│   │   └── clients.baml
│   ├── src/
│   │   ├── components/       # UI components (Ark UI)
│   │   ├── lib/
│   │   │   ├── utcp-baml-agent/  # Agent implementation
│   │   │   ├── neo4j/            # Neo4j client
│   │   │   └── graph/            # Graph transformations
│   │   └── routes/           # SolidStart routes
│   └── package.json
├── docs/                     # Documentation
│   ├── INDEX.md              # Documentation index
│   ├── baml_agent/
│   │   └── ARCHITECTURE.md   # Agent architecture
│   ├── DOCKER_COMPOSE.md
│   ├── MCP_GATEWAY.md
│   ├── UI_ARCHITECTURE.md
│   └── ROADMAP.md
└── graphiti-mcp/             # Graphiti MCP utilities
```

## Adding New MCP Servers

1. **Find the server's image digest**:
   ```bash
   docker pull mcp/<server-name>
   docker inspect mcp/<server-name> --format='{{index .RepoDigests 0}}'
   ```

2. **Add to `custom-catalog.yaml`**:
   ```yaml
   registry:
     your-server:
       description: Description
       title: Display Name
       type: server
       image: mcp/server-name@sha256:<digest>
       tools:
         - name: tool_name
       env:
         - name: CONFIG_VAR
           value: '{{your-server.config_key}}'
   ```

3. **Add configuration to `mcp-config.yaml`** (if needed):
   ```yaml
   your-server:
     config_key: value
   ```

4. **Update `docker-compose.yaml`**:
   ```yaml
   command:
     - --servers=neo4j-cypher,fetch,web_search,your-server
   ```

5. **Restart the gateway**:
   ```bash
   docker compose restart mcp-gateway
   ```

**Important**: Always use SHA256 digests (`@sha256:...`), not tags (`:latest`).

## Documentation

| Document | Description |
|----------|-------------|
| [docs/INDEX.md](docs/INDEX.md) | Documentation index and overview |
| [docs/baml_agent/ARCHITECTURE.md](docs/baml_agent/ARCHITECTURE.md) | BAML agent streaming architecture |
| [docs/UI_ARCHITECTURE.md](docs/UI_ARCHITECTURE.md) | SolidStart UI structure and patterns |
| [docs/DOCKER_COMPOSE.md](docs/DOCKER_COMPOSE.md) | Service configuration details |
| [docs/MCP_GATEWAY.md](docs/MCP_GATEWAY.md) | MCP Gateway reference |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Development roadmap |
| [neo4j_dumps/README.md](neo4j_dumps/README.md) | Neo4j data versioning workflow |

## Troubleshooting

### MCP Gateway not loading servers

```bash
docker logs kg-agent-mcp-gateway-1
```

Look for image pull errors or configuration issues.

### Agent not connecting to Neo4j

1. Check Neo4j is healthy: `docker compose ps`
2. Verify connection in `mcp-config.yaml`: `uri: bolt://neo4j:7687`
3. Test directly: `docker exec neo4j-mldsgraph cypher-shell -u neo4j -p password`

### UI build errors

```bash
cd ui
pnpm baml-generate  # Regenerate BAML client
pnpm build
```

### View service logs

```bash
docker compose logs -f              # All services
docker compose logs -f neo4j        # Neo4j only
docker compose logs -f mcp-gateway  # Gateway only
```

## Development

```bash
# Start UI in development mode
cd ui && pnpm dev

# Generate BAML TypeScript client
cd ui && pnpm baml-generate

# Run BAML tests
cd ui && pnpm baml-test

# Lint code
cd ui && pnpm eslint
```

## License

[Add your license information here]
