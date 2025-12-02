# kg-agent: Knowledge Graph Agent System

A knowledge graph agent system integrating n8n workflow orchestration, Neo4j graph database, and MCP Gateway for AI agent tool integration.

## Requirements

- Docker Desktop
- Docker Compose

## Quick Start

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down
```

## Services

All services run in Docker containers and communicate via the `app-network` bridge network:

- **n8n** (http://localhost:5678) - Workflow automation platform
- **Neo4j** (http://localhost:7474) - Graph database with APOC and n10s plugins
- **MCP Gateway** (http://localhost:3000) - Model Context Protocol gateway

## Configuration Files

The system uses three main configuration files:

1. **docker-compose.yaml** - Service orchestration
2. **mcp-config.yaml** - MCP server connection parameters
3. **custom-catalog.yaml** - Custom MCP catalog with tool definitions

See [docs/DOCKER_COMPOSE.md](docs/DOCKER_COMPOSE.md) for detailed configuration information.

## Current MCP Servers

The system includes two MCP servers:

### neo4j-cypher
- **Tools**: `get_neo4j_schema`, `read_neo4j_cypher`, `write_neo4j_cypher`
- **Purpose**: Execute Cypher queries against Neo4j
- **Configuration**: Custom environment variable mapping (NEO4J_URI instead of NEO4J_URL)

### fetch
- **Tools**: `fetch`
- **Purpose**: Retrieve content from the web

## Using MCP Tools in n8n

1. **Access n8n**: Navigate to http://localhost:5678
2. **Create a workflow** with an AI Agent node
3. **Add MCP Client Tool**:
   - Endpoint: `http://mcp-gateway:3000/mcp`
   - Server Transport: `HTTP Streamable`
   - Authentication: None

4. **Select tools** from the available MCP servers (neo4j-cypher, fetch)

## Neo4j Database

Access Neo4j Browser at http://localhost:7474

**Default credentials**:
- Username: `neo4j`
- Password: `password`

**Included plugins**:
- APOC (Awesome Procedures on Cypher)
- n10s (neosemantics)

**Important**: If you need to reset Neo4j credentials or encounter authentication rate limiting:
```bash
# Stop containers
docker compose down

# Remove Neo4j data
rm -rf neo4j_data

# Restart
docker compose up -d
```

## Adding New MCP Servers

The project uses a custom MCP catalog to manage available tools. To add a new MCP server:

### 1. Find the Server's Image Digest

```bash
# If the image is already pulled locally
docker images | grep mcp/<server-name>

# Get the SHA256 digest
docker inspect <image-id> --format='{{index .RepoDigests 0}}'
```

### 2. Add to custom-catalog.yaml

```yaml
registry:
  your-server-name:
    description: Description of what this server does
    title: Display Name
    type: server
    image: mcp/server-name@sha256:<digest>
    tools:
      - name: tool_name_1
      - name: tool_name_2
    # Add env variables if needed
    env:
      - name: SOME_CONFIG
        value: '{{your-server-name.config_key}}'
```

**Important**: Always use SHA256 digests (`@sha256:...`) not tags (`:latest`). The MCP Gateway doesn't accept tag-based references like `@latest`.

### 3. Add Configuration (if needed)

If your server requires configuration, add it to `mcp-config.yaml`:

```yaml
your-server-name:
  config_key: config_value
  another_key: another_value
```

### 4. Update docker-compose.yaml

Add your new server to the `--servers` command:

```yaml
mcp-gateway:
  command:
    - --servers=neo4j-cypher,fetch,your-server-name
```

### 5. Restart the Gateway

```bash
docker restart kg-agent-mcp-gateway-1
# Or restart all services
docker compose restart
```

For more details, see the [Docker Compose Documentation](docs/DOCKER_COMPOSE.md).

## Data Persistence

All data is persisted in local directories:

- `./n8n_data` - n8n workflows, credentials, and executions
- `./neo4j_data` - Neo4j database files

These directories are created automatically when you first run `docker compose up`.

## Troubleshooting

### MCP Gateway not loading servers

Check the gateway logs:
```bash
docker logs kg-agent-mcp-gateway-1
```

Look for:
- Image pull errors
- Configuration errors
- Environment variable mapping issues

### n8n can't connect to MCP Gateway

Ensure you're using the Docker service name:
- ✅ Correct: `http://mcp-gateway:3000/mcp`
- ❌ Wrong: `http://localhost:3000/mcp`

### Neo4j authentication issues

If you see authentication rate limiting:
1. Stop containers: `docker compose down`
2. Remove data: `rm -rf neo4j_data`
3. Restart: `docker compose up -d`

### View all service logs

```bash
docker compose logs -f
```

## Documentation

- [Docker Compose Configuration](docs/DOCKER_COMPOSE.md) - Detailed service configuration and troubleshooting

## Project Structure

```
kg-agent/
├── docker-compose.yaml      # Service orchestration
├── mcp-config.yaml          # MCP server configuration
├── custom-catalog.yaml      # Custom MCP catalog
├── n8n_data/               # n8n data (auto-created)
├── neo4j_data/             # Neo4j data (auto-created)
└── docs/
    └── DOCKER_COMPOSE.md   # Detailed documentation
```

## License

[Add your license information here]
