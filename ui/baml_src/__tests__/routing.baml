// Test file for routing.baml
// These tests verify the RouteUserMessage function properly routes user intents

// ============================================================================
// Neo4j Routing Tests
// ============================================================================

test RouteUserMessage_Neo4j_Query {
  functions [RouteUserMessage]
  args {
    message "Show me all the nodes in the graph"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == true }} )
  @@assert( {{ this.tool_name == "neo4j" or this.tool_name == "Neo4j" }} )
}

test RouteUserMessage_Neo4j_Schema {
  functions [RouteUserMessage]
  args {
    message "What relationships exist in the database?"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == true }} )
  @@assert( {{ this.tool_name == "neo4j" or this.tool_name == "Neo4j" }} )
}

test RouteUserMessage_Neo4j_App_Info {
  functions [RouteUserMessage]
  args {
    message "What technologies does Seederis use?"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == true }} )
  @@assert( {{ this.tool_name == "neo4j" or this.tool_name == "Neo4j" }} )
}

// ============================================================================
// Web Search Routing Tests
// ============================================================================

test RouteUserMessage_WebSearch {
  functions [RouteUserMessage]
  args {
    message "Search the web for React 19 release notes"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == true }} )
  @@assert( {{ this.tool_name == "web_search" or this.tool_name == "WebSearch" }} )
}

test RouteUserMessage_WebSearch_External {
  functions [RouteUserMessage]
  args {
    message "Find documentation for Neo4j on their website"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == true }} )
  @@assert( {{ this.tool_name == "web_search" or this.tool_name == "WebSearch" }} )
}

// ============================================================================
// No Tool Needed Tests
// ============================================================================

test RouteUserMessage_NoTool_Greeting {
  functions [RouteUserMessage]
  args {
    message "Hello!"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == false }} )
}

test RouteUserMessage_NoTool_Thanks {
  functions [RouteUserMessage]
  args {
    message "Thanks for your help!"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == false }} )
}

test RouteUserMessage_NoTool_Help {
  functions [RouteUserMessage]
  args {
    message "What can you do?"
    conversation_history []
  }
  @@assert( {{ this.tool_call_needed == false }} )
}
