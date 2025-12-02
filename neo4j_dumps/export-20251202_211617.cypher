// Neo4j Database Export (Simple)
// Generated: 2025-12-02 21:16:17
//
// To import:
//   ./scripts/import-neo4j.sh neo4j_dumps/export-20251202_211617.cypher

// Clear existing data
MATCH (n) DETACH DELETE n;

// ============================================
// Create Nodes
// ============================================

