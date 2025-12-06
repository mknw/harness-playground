// agent.baml - Legacy compatibility layer
// Main agent definitions have been split into namespace files:
// - routing.baml: RouteUserMessage, ToolNamespace, ToolMode
// - neo4j.baml: PlanNeo4jOperation, Neo4jToolName
// - web_search.baml: PlanWebSearch, WebSearchToolName
// - code_mode.baml: PlanCodeModeOperation, CodeModeToolName
// - response.baml: CreateToolResponse, ValidateWriteOperation

// ============================================================================
// Legacy Data Models (kept for compatibility)
// ============================================================================

// Legacy: GraphQuery - kept for compatibility with existing code
class GraphQuery {
  cypher string @description("The Cypher query to execute")
  explanation string @description("Human-readable explanation of what this query does")
  read_only bool @description("True if this is a read-only query, false if it modifies data")
  estimated_nodes int? @description("Estimated number of nodes this query might return")
}
