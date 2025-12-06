// Test file for neo4j.baml
// These tests verify the PlanNeo4jOperation function

// ============================================================================
// Read Operation Tests
// ============================================================================

test PlanNeo4jOperation_Read_Simple {
  functions [PlanNeo4jOperation]
  args {
    user_message "Show me all Person nodes"
    intent "Query graph for Person nodes"
    schema "Node Labels:\n- Person (properties: name, age)\n\nRelationships:\n- (Person)-[KNOWS]->(Person)"
    previous_results "[]"
    n_turn 1
  }
  @@assert( {{ this.tool_name == "Read" }} )
  @@assert( {{ this.payload != null }} )
}

test PlanNeo4jOperation_Schema_Request {
  functions [PlanNeo4jOperation]
  args {
    user_message "What types of nodes exist?"
    intent "Get schema information"
    schema ""
    previous_results "[]"
    n_turn 1
  }
  @@assert( {{ this.tool_name == "Schema" or this.tool_name == "Read" }} )
}

// ============================================================================
// Return Action Tests
// ============================================================================

test PlanNeo4jOperation_Return_With_Results {
  functions [PlanNeo4jOperation]
  args {
    user_message "Show me all Person nodes"
    intent "Query graph for Person nodes"
    schema "Node Labels:\n- Person (properties: name, age)"
    previous_results "[{\"status_code\": 200, \"data\": [{\"n\": {\"name\": \"Alice\", \"age\": 30}}, {\"n\": {\"name\": \"Bob\", \"age\": 25}}]}]"
    n_turn 2
  }
  @@assert( {{ this.tool_name == "Return" }} )
}

// ============================================================================
// Write Operation Tests
// ============================================================================

test PlanNeo4jOperation_Write_Create {
  functions [PlanNeo4jOperation]
  args {
    user_message "Create a new Person named Charlie"
    intent "Create a new node in the graph"
    schema "Node Labels:\n- Person (properties: name, age)"
    previous_results "[]"
    n_turn 1
  }
  @@assert( {{ this.tool_name == "Write" }} )
  @@assert( {{ this.payload != null }} )
}
