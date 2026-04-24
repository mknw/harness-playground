#!/bin/bash
# Import Neo4j database from Cypher dump file

set -e

CONTAINER_NAME="neo4j-mldsgraph"
NEO4J_USER="neo4j"
NEO4J_PASSWORD="password"

# Use provided file or find latest export
if [ -n "$1" ]; then
    IMPORT_FILE="$1"
else
    IMPORT_FILE=$(ls -t neo4j_dumps/export-*.cypher 2>/dev/null | head -n1)
    if [ -z "$IMPORT_FILE" ]; then
        echo "Error: No export files found in neo4j_dumps/"
        echo "Usage: $0 [path/to/export.cypher]"
        exit 1
    fi
    echo "Using latest export: ${IMPORT_FILE}"
fi

if [ ! -f "$IMPORT_FILE" ]; then
    echo "Error: File not found: $IMPORT_FILE"
    exit 1
fi

echo "Importing Neo4j database from ${IMPORT_FILE}..."

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container ${CONTAINER_NAME} is not running"
    exit 1
fi

# Clear existing data
echo "Clearing existing data..."
docker exec ${CONTAINER_NAME} cypher-shell -u ${NEO4J_USER} -p ${NEO4J_PASSWORD} \
    "MATCH (n) DETACH DELETE n;" 2>/dev/null || echo "Database already empty"

# Import the dump
# Use --format plain to handle :begin/:commit transaction markers from APOC export
# Filter out comment lines (starting with //) as cypher-shell doesn't handle them
echo "Importing data..."
grep -v '^//' "${IMPORT_FILE}" | docker exec -i ${CONTAINER_NAME} cypher-shell -u ${NEO4J_USER} -p ${NEO4J_PASSWORD} --format plain || {
    echo "Error: Import failed"
    exit 1
}

echo ""
echo "Import completed successfully!"
echo ""
echo "Verify with:"
echo "  docker exec ${CONTAINER_NAME} cypher-shell -u ${NEO4J_USER} -p ${NEO4J_PASSWORD} 'MATCH (n) RETURN count(n);'"
