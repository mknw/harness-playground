// Test file for web_search.baml
// These tests verify the PlanWebSearch function

// ============================================================================
// Search Operation Tests
// ============================================================================

test PlanWebSearch_Search_Simple {
  functions [PlanWebSearch]
  args {
    user_message "Search for React 19 features"
    intent "Find information about React 19"
    previous_results "[]"
    n_turn 1
  }
  @@assert( {{ this.tool_name == "Search" }} )
  @@assert( {{ this.payload != null }} )
}

test PlanWebSearch_Search_Documentation {
  functions [PlanWebSearch]
  args {
    user_message "Find the official TypeScript documentation"
    intent "Locate TypeScript docs"
    previous_results "[]"
    n_turn 1
  }
  @@assert( {{ this.tool_name == "Search" or this.tool_name == "Fetch" }} )
}

// ============================================================================
// Fetch Operation Tests
// ============================================================================

test PlanWebSearch_Fetch_URL {
  functions [PlanWebSearch]
  args {
    user_message "Get the content from https://example.com/docs"
    intent "Fetch specific URL content"
    previous_results "[]"
    n_turn 1
  }
  @@assert( {{ this.tool_name == "Fetch" }} )
  @@assert( {{ this.payload != null }} )
}

// ============================================================================
// Return Action Tests
// ============================================================================

test PlanWebSearch_Return_With_Results {
  functions [PlanWebSearch]
  args {
    user_message "What are the new features in React 19?"
    intent "Learn about React 19 features"
    previous_results "[{\"status_code\": 200, \"data\": {\"results\": [{\"title\": \"React 19 Release\", \"snippet\": \"React 19 introduces new concurrent features...\"}]}}]"
    n_turn 2
  }
  @@assert( {{ this.tool_name == "Return" }} )
}
