# Docker Compose Documentation

## Overview

The kg-agent project uses Docker Compose to orchestrate three main services:
- **n8n**: Workflow automation platform
- **neo4j**: Graph database (Community Edition v5.26)
- **mcp-gateway**: Docker's Model Context Protocol gateway for AI tool integration

All services communicate via a shared bridge network (`app-network`).

## Service Details

### n8n
- **Container**: n8n-seederis
- **Ports**: 5678:5678
- **Timezone**: Europe/Brussels
- **Data**: Persisted in `./n8n_data`

### Neo4j
- **Container**: neo4j-mldsgraph
- **Ports**: 
  - 7474 (HTTP browser interface)
  - 7687 (Bolt protocol)
- **Authentication**: neo4j/password
- **Plugins**: APOC, n10s
- **Data**: Persisted in `./neo4j_data`
- **Healthcheck**: Validates HTTP endpoint on port 7474

### MCP Gateway
- **Image**: docker/mcp-gateway
- **Ports**: 8811:8811
- **MCP Servers**: neo4j-cypher, fetch, web_search
- **Transport**: streaming
- **Dependencies**: Waits for Neo4j healthcheck

## MCP Gateway Configuration Issue & Solution

### The Problem

We discovered a critical mismatch between Docker's official MCP catalog and the neo4j-cypher server implementation:

- **Docker MCP Catalog**: Maps config key `url` → environment variable `NEO4J_URL`
- **neo4j-cypher server**: Actually expects environment variable `NEO4J_URI`

This caused authentication failures because the connection string wasn't being passed correctly.

### The Solution

Created a **custom catalog** (`custom-catalog.yaml`) that properly maps configuration to environment variables:

```yaml
env:
  - name: NEO4J_URI                      # FIXED: Was NEO4J_URL
    value: '{{neo4j-cypher.uri}}'        # FIXED: Was {{neo4j-cypher.url}}
  - name: NEO4J_USERNAME
    value: '{{neo4j-cypher.username}}'
  - name: NEO4J_PASSWORD
    value: '{{neo4j-cypher.password}}'
  - name: NEO4J_DATABASE
    value: '{{neo4j-cypher.database}}'
  - name: NEO4J_READ_ONLY
    value: '{{neo4j-cypher.read_only}}'
```

### Configuration Files

1. **mcp-config.yaml**: Contains connection parameters
   ```yaml
   neo4j-cypher:
     uri: bolt://neo4j:7687  # Uses Docker service name
     username: neo4j
     password: password
     database: neo4j
     read_only: false
   ```

2. **custom-catalog.yaml**: Custom catalog definition with corrected environment variable mappings
   - Includes **neo4j-cypher** server with fixed NEO4J_URI mapping
   - Includes **fetch** server for web content retrieval
   - Uses SHA256 digests for image references (e.g., `mcp/fetch@sha256:...`)

3. **docker-compose.yaml**: Mounts both configuration files read-only
   ```yaml
   volumes:
     - ./mcp-config.yaml:/mcp/config.yaml:ro
     - ./custom-catalog.yaml:/mcp/custom-catalog.yaml:ro
   ```

## Important Notes

### Neo4j Service Networking
- Use `neo4j:7687` (Docker service name) rather than `host.docker.internal` for inter-container communication
- The Neo4j service is accessible on the `app-network` bridge network

### Neo4j Authentication Reset
- If authentication rate limiting occurs, you must **completely remove the `neo4j_data` directory**
- Neo4j only accepts credential changes before initial database creation
- Pattern: Stop containers → `rm -rf neo4j_data` → Restart

### Configuration Management
- MCP Gateway works best with YAML configuration files mounted as volumes
- Using environment variables or Docker secrets proved less reliable
- Configuration files are mounted read-only (`:ro`) for security

### MCP Gateway Discovery
The custom catalog was created by:
1. Cloning the mcp-gateway repository
2. Examining `pkg/gateway/clientpool.go` to understand template evaluation
3. Identifying the `argsAndEnv` function that constructs environment variables
4. Creating a corrected mapping based on what the neo4j-cypher server actually expects

## Adding Additional MCP Servers

To add new MCP servers to the custom catalog:

1. **Find the server's image digest**:
   ```bash
   # If the image is already pulled locally
   docker images | grep mcp/<server-name>
   docker inspect <image-id> --format='{{index .RepoDigests 0}}'
   ```

2. **Add to custom-catalog.yaml**:
   ```yaml
   registry:
     server-name:
       description: Server description
       title: Display Name
       type: server
       image: mcp/server-name@sha256:<digest>
       tools:
         - name: tool_name_1
         - name: tool_name_2
   ```

3. **Add server to docker-compose.yaml command**:
   ```yaml
   command:
     - --servers=neo4j-cypher,fetch,new-server
   ```

4. **Add configuration if needed** (in mcp-config.yaml):
   ```yaml
   new-server:
     param1: value1
     param2: value2
   ```

**Important**: Always use SHA256 digests (`@sha256:...`) not tags (`:latest`) for image references. The gateway doesn't accept tag-based references in the format `@latest`.
