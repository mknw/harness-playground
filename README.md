# Renewable Energy Market Graph

## Requirements

Docker Desktop

## Run n8n

```
docker run -it --rm \
 --name n8n \
 -p 5678:5678 \
 -e GENERIC_TIMEZONE="Europe/Brussels" \
 -e TZ="Europe/Brussels" \
 -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true \
 -e N8N_RUNNERS_ENABLED=true \
 -v n8n_data:/home/node/.n8n \
 docker.n8n.io/n8nio/n8n
 ```

## Web Search

1. create tavily api key
2. add tool 'tavily search' to agent

## Information extraction

1. Add node
2. Define json

## Start neo4j

```
docker run \
    --name neo4j-mldsgraph \
    --restart always \
    --publish=7474:7474 --publish=7687:7687 \
    --env NEO4J_AUTH=neo4j/password \
    --volume=./neo4j-volume:/data \
    --env NEO4JLABS_PLUGINS='["apoc", "n10s"]' \
    neo4j:5.26
```

Here, the plugins _APOC_ (Awesome Procedures on Cypher) and _n10s_ (neosemantics) can be removed if not required.

## Knowledge graph agent

1. find `neo4j-cypher` and `neo4j-memory` on MCP toolkit, add them

2. provide configuration:
```
url = bolt://host.docker.internal:7687
username = neo4j
database = neo4j
password = *****
```

3. run:  `docker mcp gateway run --transport streaming --port 3000`

4. Add `MCP Client` tool. Use: `http://host.docker.internal:3000/mcp`  as Endpoint, and `HTTP Streamable` as Server Transport. Authentication none.

Note: The endpoint host should be substituted with `localhost` if your n8n instance is running through docker.


### Prompt

Below, I'll provide the updated full setup based on your request. To ensure the state of every component persists (even during upgrades, restarts, or container changes), I've added **mounted volumes** to the `docker-compose.yml` file. This uses Docker named volumes (for portability across hosts) and local bind mounts (for easier inspection/debugging on your local machine). Named volumes are defined at the end of the compose file, and they'll retain data unless explicitly removed. For services that already had volumes, I've refined them; forothers, I've added suitable ones based on the components (e.g., config files, user data, databases).

Key updates:
- **Volumes**: Added for each service to persist config, data, and state (e.g., Neo4j DB, n8n workflows, Redis dumps, Kong plugins/configs). Named volumes are prefixed with `mcp-` for clarity.
- **Data persistence**: Even if you upgrade an image or rebuild a container, the volume data remains. You can back them up with `docker run --rm -v mcp-neo4j-data:/data -v $(pwd)/backup:/backup alpine tar czf /backup/neo4j-backup.tar.gz -C /data .`.
- **Local folders**: The bind mounts (e.g., `./neo4j/data:/data`) point to local dirs in your project folder. These are easier to edit/debug locally. Create them as before. Add a `.gitignore` file (newly included below) to avoid committing sensitive local data to Git.
- **Pruning**: Named volumes aren't removed by `docker compose down`, so your state is safe. To clean: `docker volume rm mcp-neo4j-data` (etc.).
- Assumptions: If a service is custom (e.g., mcp-server1), volumes assume common paths like `/app/data`—adjust if your app uses others. For Kong (MCP Gateway), we're persisting config/plugins. For Fetch.ai, assuming it's data-oriented.

I've updated the files with the complete configuration. The commands section has minor additions (e.g., creating volumes explicitly).

### Step 1: Set Up Your Project Directory and Updated Files
1. **Open a terminal and navigate/create the folder**:
   - Run: `mkdir mcp-gateway-setup && cd mcp-gateway-setup`
   - This creates a project folder and switches into it.

2. **Create/update the required files**. Use a text editor to make these files. Save them in the `mcp-gateway-setup` folder. (The previous files are updated with volume additions.)

   - **Updated File 1: docker-compose.yml** (the main orchestration file, with persistent volumes added for each service)
     ```
     version: '3.8'

     services:
       mcp-gateway:
         image: kong:latest  # Replace if you have a custom MCP Gateway image
         environment:
           - KONG_DATABASE=off
           - KONG_PROXY_LISTEN=0.0.0.0:8000
           - KONG_ADMIN_LISTEN=0.0.0.0:8001
           - KONG_LOG_LEVEL=info
         ports:
           - "8000:8000"
           - "8001:8001"
         networks:
           - mcp-net
         depends_on:
           - neo4j
           - n8n
         env_file:
           - .env  # For any additional env vars
         volumes:
           - mcp-gateway-config:/etc/kong:ro  # Persist config/plugins; ro for read-only to prevent overwrites
           - mcp-gateway-data:/usr/local/kong/data  # For any custom user data/plugins


       neo4j:
         image: neo4j:5.0
         environment:
           - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}
           - NEO4J_dbms_memory_heap_initial__size=512m
         ports:
           - "7474:7474"
           - "7687:7687"
         volumes:
           - ./neo4j/data:/data:rw  # Bind mount for local DB inspection; persists all DB data/transactions
           - mcp-neo4j-logs:/logs  # Persist logs separately
         networks:
           - mcp-net
         env_file:
           - .env

       n8n:
         image: n8nio/n8n:latest
         environment:
           - N8N_BASIC_AUTH_ACTIVE=false
           - N8N_HOST=n8n
           - N8N_PORT=5678
           - WEBHOOK_URL=http://localhost:8000/
           - OPENAI_API_KEY=${OPENAI_API_KEY}
         ports:
           - "5678:5678"
         volumes:
           - ./n8n/data:/home/node/.n8n:rw  # Bind mount; persists workflows, credentials, executions
           - mcp-n8n-config:/home/node/.config  # For additional config state
         networks:
           - mcp-net
         depends_on:
           - neo4j
           - fetch
           - neo4memory
         env_file:
           - .env

     networks:
       mcp-net:
         driver: bridge

     volumes:  # Named volumes for persistence across container upgrades
       mcp-neo4j-logs:
       mcp-n8n-config:
     ```

   - **File 2: .env** (unchanged from previous)
     ```
     # Replace with your actual values
     CONTEXT_API_KEY=your_context7_api_key_here
     FETCH_WALLET_ADDRESS=your_fetch_wallet_address
     FETCH_API_KEY=your_fetch_api_key
     NEO4J_PASSWORD=your_secure_neo4j_password  # e.g., 'changeme123'
     OPENAI_API_KEY=your_openai_api_key
     ```

   - **New File 3: .gitignore** (to ignore local volume folders and sensitive data when using Git)
     ```
     # Ignore local volume folders to prevent committing large/sensitive data
     neo4j/data/
     n8n/data/
     fetch-data/
     neo4memory/data/
     .env
     *backup*
     ```
     - Save this in the root of your project. If using Git, commit it to avoid tracking the folders.

### Step 2: Commands to Run
Follow these in sequence. The changes ensure volumes persist data.

1. **Navigate to your project folder** (if not already):
   - Command: `cd mcp-gateway-setup`

2. **(Optional) Build any custom images** (if your MCP servers or Context7 are custom):
   - For "mcp-server1" (assuming a Dockerfile in ./mcp-server1/): `docker build -t your-mcp-server-image:tag ./mcp-server1/`
   - Do the same for others if needed. Replace placeholders in docker-compose.yml.

3. **Test MCP Gateway standalone** (before full setup):
   - Command: `docker run -d --name mcp-gateway-test -p 8000:8000 -p 8001:8001 --volume mcp-gateway-config-test:/etc/kong kong:latest`
   - To check: `docker ps`.
   - Stop: `docker stop mcp-gateway-test && docker rm mcp-gateway-test`.

4. **Create necessary local folders** (for bind mounts):
   - Command: `mkdir -p neo4j/data n8n/data fetch-data neo4memory/data`

5. **Start the full setup with Docker Compose** (this creates named volumes automatically):
   - Command: `docker compose up -d`
   - Volumes will persist across `docker compose down` and `up`.

6. **Check status, logs, and volumes**:
   - View running containers: `docker compose ps`
   - View logs: `docker compose logs -f`
   - List all volumes: `docker volume ls` (you'll see the mcp-* ones).
   - Inspect a volume's data (e.g., for neo4j): `docker run --rm -v mcp-neo4j-logs:/data alpine ls -la /data`

7. **Configure routes in MCP Gateway** (as before):
   - (Commands unchanged) Use curl to add routes via http://localhost:8001.

8. **Verify integrations and persistence**:
   - Access UIs as before.
   - In n8n, create/save a workflow—restart n8n with `docker compose restart n8n` and verify it's persisted.
   - Add data to Neo4j/Redis via UIs or tools, then restart services: Data should remain.

9. **Stop everything**:
   - Command: `docker compose down` (volumes persist).

10. **Clean up volumes if needed** (destructive—backup first):
    - Command: `docker volume rm $(docker volume ls | grep mcp- | awk '{print $2}')`
    - Or per-volume: `docker volume rm mcp-neo4j-data`

If issues arise (e.g., permission errors on bind mounts), ensure your user has access to the local folders. For Windows/Mac, Docker Desktop handles it, but check logs. Let me know for further tweaks!
