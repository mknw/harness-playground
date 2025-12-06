// neo4j.baml - Neo4j graph database operations
// Handles Cypher queries for reading and writing graph data

// ============================================================================
// Enums
// ============================================================================

enum Neo4jToolName {
  Read @alias("read_neo4j_cypher") @description("Read-only Cypher query (MATCH, RETURN)")
  Write @alias("write_neo4j_cypher") @description("Write Cypher query (CREATE, DELETE, SET, MERGE) - requires approval")
  Schema @alias("get_neo4j_schema") @description("Fetch graph schema - rarely needed")
  Return @description("Stop loop and return accumulated results to next step")
}

// ============================================================================
// Data Models
// ============================================================================

class Neo4jToolExecutionPlan {
  reasoning string @description("Step-by-step thought process (Chain of Thought)")
  tool_name Neo4jToolName @description("Which Neo4j tool to use")
  payload map<"query", string>? @description("Cypher query map. null if tool_name is Return")
  description string @description("User-facing status message shown during execution")
}

// ============================================================================
// Functions
// ============================================================================

function PlanNeo4jOperation(
  user_message: string,
  intent: string,
  schema: string,
  previous_results: string,
  n_turn: int
) -> Neo4jToolExecutionPlan {
  client GroqWithFallback
  prompt #"
    You are a Neo4j Knowledge Graph Agent. The user wants to: {{ intent }}

    Turn {{ n_turn }}/5. You must complete within 5 turns.

    USER MESSAGE: {{ user_message }}

    GRAPH SCHEMA:
    {{ schema }}

    PREVIOUS RESULTS (from earlier turns):
    {{ previous_results }}

    YOUR TASK:
    1. Think step by step about what Cypher query will answer the user's intent
    2. Generate a valid Cypher query with LIMIT clauses for safety

    TOOL SELECTION:
    - Read: For MATCH queries that read data
    - Write: For CREATE/DELETE/SET/MERGE queries (requires user approval)
    - Schema: To refresh schema info (rarely needed)
    - Return: When you have enough info to answer - stops the loop

    Choose Return if previous_results contains sufficient information.

    {{ ctx.output_format }}
  "#
}
