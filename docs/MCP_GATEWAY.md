# MCP Gateway Documentation

The MCP Gateway is Docker's tool for managing and running MCP (Model Context Protocol) servers in containers. It provides a unified interface for AI clients to access multiple MCP tools through a single gateway.

## Overview

```
AI Client → MCP Gateway → MCP Servers (Docker Containers)
```

The gateway:
- Manages MCP server lifecycle in isolated Docker containers
- Provides a unified interface for AI models to access tools
- Handles authentication, secrets, and OAuth flows
- Supports dynamic tool discovery and configuration

## Installation

### Prerequisites
- Docker Desktop with MCP Toolkit feature enabled
- OR standalone Docker engine

### As Docker CLI Plugin
```bash
git clone https://github.com/docker/mcp-gateway.git
cd mcp-gateway
mkdir -p "$HOME/.docker/cli-plugins/"
make docker-mcp
```

After installation:
```bash
docker mcp --help
```

## Running the Gateway

### Basic Usage

```bash
# Run with stdio transport (for single client like Claude Desktop)
docker mcp gateway run

# Run with HTTP streaming (for multiple clients, like n8n)
docker mcp gateway run --port 3000 --transport streaming

# Run specific servers only
docker mcp gateway run --servers neo4j-cypher,fetch

# Enable ALL servers from catalogs
docker mcp gateway run --enable-all-servers

# Run with verbose logging
docker mcp gateway run --verbose --log-calls

# Dry run (test configuration without starting)
docker mcp gateway run --verbose --dry-run
```

### Docker Compose Usage

```yaml
services:
  mcp-gateway:
    image: docker/mcp-gateway
    command:
      - --servers=neo4j-cypher,fetch
      - --transport=streaming
      - --port=3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - "3000:3000"
```

### With Custom Catalog and Config

```yaml
services:
  mcp-gateway:
    image: docker/mcp-gateway
    command:
      - --servers=neo4j-cypher,fetch
      - --config=/mcp/config.yaml
      - --catalog=/mcp/custom-catalog.yaml
      - --transport=streaming
      - --port=3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./mcp-config.yaml:/mcp/config.yaml:ro
      - ./custom-catalog.yaml:/mcp/custom-catalog.yaml:ro
    ports:
      - "3000:3000"
```

## Command Line Flags

### Server Selection
| Flag | Description |
|------|-------------|
| `--servers` | Comma-separated list of server names to enable |
| `--enable-all-servers` | Enable all servers from loaded catalogs |
| `--working-set` | Use a named working set (requires feature flag) |
| `--tools` | Filter specific tools (format: `server:tool` or `server:*`) |

### Configuration
| Flag | Description |
|------|-------------|
| `--catalog` | Path to catalog file(s) |
| `--config` | Path to config file(s) |
| `--registry` | Path to registry file(s) |
| `--secrets` | Secret provider path(s), e.g., `docker-desktop:./.env` |

### Transport
| Flag | Description |
|------|-------------|
| `--transport` | `stdio`, `sse`, or `streaming` (default: stdio) |
| `--port` | TCP port for sse/streaming transport |

### Resources
| Flag | Description |
|------|-------------|
| `--cpus` | CPUs per MCP server (default: 1) |
| `--memory` | Memory per MCP server (default: 2Gb) |

### Debugging
| Flag | Description |
|------|-------------|
| `--verbose` | Enable verbose output |
| `--log-calls` | Log tool calls (default: true) |
| `--dry-run` | Test configuration without listening |
| `--watch` | Auto-reload on config changes (default: true) |

### Security
| Flag | Description |
|------|-------------|
| `--block-secrets` | Block secrets in tool communications (default: true) |
| `--block-network` | Block forbidden network resources |
| `--verify-signatures` | Verify server image signatures |

## Auto-Discovery and Dynamic Tools

### Enable All Servers
Use `--enable-all-servers` to enable every server in your loaded catalogs:
```bash
docker mcp gateway run --enable-all-servers --transport streaming --port 3000
```

### Dynamic Tools Feature
The `dynamic-tools` feature (enabled by default) exposes internal MCP tools that AI agents can use:

- **mcp-find**: Search for available MCP servers in the catalog
- **mcp-add**: Add servers to the registry and reload
- **mcp-remove**: Remove servers and reload

This allows AI agents to dynamically discover and enable new MCP servers during a session.

**Note**: Dynamic tools are automatically disabled when using explicit `--servers` flag.

### Self-Describing Images
Docker images can include their own catalog metadata via labels:
```bash
docker mcp gateway run --server docker://namespace/image:latest
```

The image must have:
```dockerfile
LABEL io.docker.server.metadata="{... server metadata JSON ...}"
```

## Catalog Management

### Default Catalog
The gateway uses Docker's online catalog by default:
- v2: `http://desktop.docker.com/mcp/catalog/v2/catalog.yaml`
- v3: `http://desktop.docker.com/mcp/catalog/v3/catalog.yaml` (with OAuth DCR)

### Custom Catalogs

#### Create a Catalog
```bash
docker mcp catalog create my-catalog
```

#### Bootstrap from Docker's Catalog
```bash
docker mcp catalog bootstrap ./starter-catalog.yaml
```

#### Add Servers to Catalog
```bash
docker mcp catalog add my-catalog server-name ./source.yaml
```

#### Import from MCP Registry
```bash
docker mcp catalog import my-catalog \
  --mcp-registry https://registry.modelcontextprotocol.io/v0/servers/{id}
```

### Catalog YAML Format

```yaml
name: my-catalog
displayName: My Custom Catalog
registry:
  server-name:
    description: Server description
    title: Display Name
    type: server
    image: mcp/server@sha256:...
    tools:
      - name: tool_name
    env:
      - name: ENV_VAR
        value: '{{server-name.config_key}}'
    secrets:
      - name: server-name.secret
        env: SECRET_ENV
    config:
      - name: server-name
        type: object
        properties:
          config_key:
            type: string
```

**Important**: Always use SHA256 digests (`@sha256:...`) not tags (`:latest`) for image references.

## Configuration Files

### mcp-config.yaml
Server-specific configuration:
```yaml
server-name:
  config_key: value
  another_key: another_value
```

### registry.yaml
List of enabled servers:
```yaml
servers:
  - neo4j-cypher
  - fetch
```

### tools.yaml
Tool filtering per server:
```yaml
neo4j-cypher:
  - read_neo4j_cypher
  - get_neo4j_schema
```

## Feature Flags

Manage experimental features:

```bash
# List features
docker mcp feature ls

# Enable a feature
docker mcp feature enable <feature-name>

# Disable a feature
docker mcp feature disable <feature-name>
```

### Available Features

| Feature | Default | Description |
|---------|---------|-------------|
| `dynamic-tools` | enabled | Internal MCP tools (mcp-find, mcp-add, mcp-remove) |
| `mcp-oauth-dcr` | enabled | Dynamic Client Registration for OAuth |
| `oauth-interceptor` | disabled | GitHub OAuth flow interception |
| `working-sets` | disabled | Working set management |
| `tool-name-prefix` | disabled | Prefix tool names with server name |

## Working Sets

Working sets organize collections of MCP servers for different contexts.

### Enable Feature
```bash
docker mcp feature enable working-sets
```

### Create Working Set
```bash
docker mcp workingset create --name dev-tools \
  --server docker://mcp/github:latest \
  --server docker://mcp/filesystem:latest
```

### Use Working Set
```bash
docker mcp gateway run --working-set dev-tools
```

### Share via OCI Registry
```bash
# Push
docker mcp workingset push my-set docker.io/org/my-set:v1.0

# Pull
docker mcp workingset pull docker.io/org/my-set:v1.0
```

## Connecting Clients

### Claude Desktop
```json
{
  "mcpServers": {
    "MCP_DOCKER": {
      "command": "docker",
      "args": ["mcp", "gateway", "run"]
    }
  }
}
```

### n8n (Docker Compose)
1. Use `--transport streaming --port 3000`
2. Configure MCP Client tool:
   - Endpoint: `http://mcp-gateway:3000/mcp`
   - Transport: HTTP Streamable
   - Authentication: None

### Python Client
```python
# Use streaming transport
endpoint = "http://localhost:3000/mcp"
```

## Troubleshooting

### Debug Startup
```bash
docker mcp gateway run --verbose --dry-run
```

### Check Specific Server
```bash
docker mcp gateway run --verbose --dry-run --servers=server-name
```

### List Available Tools
```bash
docker mcp tools ls
docker mcp tools ls --verbose
```

### Call a Tool Directly
```bash
docker mcp tools call tool-name param=value
```

### View Gateway Logs (Docker Compose)
```bash
docker logs <gateway-container-name>
```

### Common Issues

#### Server Not Found
- Check server name spelling
- Verify catalog contains the server
- Use `docker mcp catalog show` to list available servers

#### Image Pull Errors
- Use SHA256 digests, not `:latest` tags in custom catalogs
- Verify image exists: `docker pull mcp/server-name`

#### Network Issues
- Ensure Docker socket is mounted: `/var/run/docker.sock:/var/run/docker.sock`
- Use Docker service names for inter-container communication

#### Environment Variable Mapping
- Check catalog `env` section maps correctly to server expectations
- Some servers expect different env var names than the catalog default

## Server Management Commands

```bash
# List enabled servers
docker mcp server ls

# Enable servers
docker mcp server enable server1 server2

# Disable servers
docker mcp server disable server-name

# Inspect server details
docker mcp server inspect server-name

# Reset (disable all)
docker mcp server reset
```

## Configuration Management

```bash
# Read current config
docker mcp config read

# Write config
docker mcp config write '<yaml>'

# Reset config
docker mcp config reset
```

## Security

### Secrets Management
- Use Docker Desktop's secrets API (default)
- Or provide `.env` file: `--secrets=docker-desktop:./.env`

### OAuth
```bash
docker mcp oauth --help
docker mcp oauth ls
docker mcp oauth revoke <server>
```

### Policies
```bash
docker mcp policy --help
```

## Resources

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Docker MCP Catalog](https://hub.docker.com/mcp)
- [MCP Gateway GitHub](https://github.com/docker/mcp-gateway)
- [Docker Desktop Documentation](https://docs.docker.com/desktop/)
