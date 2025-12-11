// web_search.baml - Web search and URL fetch operations
// Handles internet searches and content fetching

// ============================================================================
// Enums
// ============================================================================

enum WebSearchToolName {
  Search @alias("search") @description("DuckDuckGo web search")
  Fetch @alias("fetch") @description("Fetch and parse URL content")
  Return @description("Stop loop and return accumulated results to next step")
}

// ============================================================================
// Data Models
// ============================================================================

class WebSearchToolExecutionPlan {
  reasoning string @description("Step-by-step thought process (Chain of Thought)")
  tool_name WebSearchToolName @description("Which web tool to use")
  payload map<"query" | "url", string>? @description("Search query or URL. null if tool_name is Return")
  description string @description("User-facing status message shown during execution")
}

// ============================================================================
// Functions
// ============================================================================

function PlanWebSearch(
  user_message: string,
  intent: string,
  previous_results: string,
  n_turn: int
) -> WebSearchToolExecutionPlan {
  client GroqWithFallback
  prompt #"
    You are a Web Search Agent. The user wants to: {{ intent }}

    Turn {{ n_turn }}/5. You must complete within 5 turns.

    USER MESSAGE: {{ user_message }}

    PREVIOUS RESULTS (from earlier turns):
    {{ previous_results }}

    YOUR TASK:
    1. Determine the optimal search query to answer the user's intent
    2. Consider refining based on previous results
    3. If Search results lack detail, use Fetch to get content from specific URLs
    4. End the loop by selecting `Return` as tool_name, when you have sufficient information

    TOOL SELECTION:
    - Search: Web search with a query string
    - Fetch: Get content from a specific URL found in search results
    - Return: When you have enough info to answer - stops the loop

    PAYLOAD FORMAT:
    - For Search: {"query": "your search query"}
    - For Fetch: {"url": "https://example.com/page"}
    - For Return: null

    Choose Return if previous_results contains sufficient information.

    {{ ctx.output_format }}
  "#
}

// ============================================================================
// Tests
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
