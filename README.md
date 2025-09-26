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
