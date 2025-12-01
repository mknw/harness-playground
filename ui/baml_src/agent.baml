// Knowledge Graph Agent Functions
// These functions power the AI agent that helps users explore and query the Neo4j graph
// Architecture: Event-driven streaming with multi-turn tool execution

// ============================================================================
// Enums
// ============================================================================

enum ToolMode {
  Mcp @description("Direct MCP tool call via gateway")
  CodeMode @description("JavaScript composition for multi-tool operations")
}

// ============================================================================
// Data Models - Routing
// ============================================================================

// Step 1 output: Routing decision from first BAML function
class RoutingInterfaceEvent {
  intent string @description("The user's detected intention")
  tool_call_needed bool @description("Whether a tool call is required")
  tool_mode ToolMode? @description("null if no tool needed; 'mcp' for direct calls, 'code_mode' for composition")
  tool_name string? @description("Tool namespace: 'neo4j', 'web_search', or 'code_mode'")
  response_text string @description("Immediate message for user. If no tool, this is the full reply")
}

// ============================================================================
// Data Models - Tool Execution
// ============================================================================

// Step 6 output: Tool execution plan from namespace-specific BAML function
class ToolExecutionPlan {
  reasoning string @description("Step-by-step thought process (Chain of Thought)")
  toolName string @description("Specific tool: read_neo4j_cypher, write_neo4j_cypher, web_search, fetch, etc.")
  payload string @description("JSON payload for tool arguments")
  description string @description("User-facing status message shown during execution")
  end_tool bool @description("True if all info to answer intent is retrieved OR max turns reached")
}

// Legacy: GraphQuery (kept for compatibility with existing InterpretGraphResults)
class GraphQuery {
  cypher string @description("The Cypher query to execute")
  explanation string @description("Human-readable explanation of what this query does")
  read_only bool @description("True if this is a read-only query, false if it modifies data")
  estimated_nodes int? @description("Estimated number of nodes this query might return")
}

// ============================================================================
// Agent Functions - Routing
// ============================================================================

// Step 1: Route user message to determine if tool call is needed
// This is the entry point - lightweight, no schema required
function RouteUserMessage(
  message: string,
  conversation_history: string[]
) -> RoutingInterfaceEvent {
  client GroqWithFallback
  prompt #"
    You are a knowledge graph assistant that can also search the web.
    Analyze the user message and determine the appropriate routing.

    User's message: {{ message }}

    Conversation history:
    {{ conversation_history }}

    ROUTING RULES:

    1. Tool IS needed if user wants to:
       - Query or modify graph data (neo4j) -> tool_name = "neo4j", tool_mode = "Mcp"
       - Search the web for information (web_search) -> tool_name = "web_search", tool_mode = "Mcp"
       - Complex operations needing multiple tools (code_mode) -> tool_name = "code_mode", tool_mode = "CodeMode"

    2. Tool is NOT needed for:
       - Greetings, thanks, casual chat
       - Questions about capabilities or help
       - Clarification questions

    OUTPUT REQUIREMENTS:

    - intent: Concise description of what user wants
    - tool_call_needed: true/false
    - tool_mode: "Mcp" for single tool, "CodeMode" for multi-tool, null if no tool
    - tool_name: "neo4j", "web_search", or "code_mode" (null if no tool)
    - response_text: If tool needed, brief acknowledgment ("Let me check that..."). If no tool, your full helpful response.

    {{ ctx.output_format }}
  "#
}

// ============================================================================
// Agent Functions - Tool Planning (Multi-turn capable)
// ============================================================================

// Plan Neo4j operation with multi-turn support
// Called when RouteUserMessage returns tool_name = "neo4j"
function PlanNeo4jOperation(
  user_message: string,
  intent: string,
  schema: string,
  previous_results: string,
  n_turn: int
) -> ToolExecutionPlan {
  client GroqWithFallback
  prompt #"
    Plan a Neo4j graph database operation. Turn {{ n_turn }} of max 5.

    USER MESSAGE: {{ user_message }}
    DETECTED INTENT: {{ intent }}

    GRAPH SCHEMA:
    {{ schema }}

    PREVIOUS RESULTS (from earlier turns):
    {{ previous_results }}

    YOUR TASK:
    1. Think step by step about what Cypher query will answer the user's intent
    2. Generate a valid Cypher query with LIMIT clauses for safety
    3. Output as ToolExecutionPlan

    TOOL OPTIONS:
    - toolName = "read_neo4j_cypher" for read queries (MATCH, RETURN)
    - toolName = "write_neo4j_cypher" for write queries (CREATE, DELETE, SET, MERGE)
    - toolName = "get_neo4j_schema" to fetch schema (rarely needed)

    PAYLOAD FORMAT (JSON string):
    For read_neo4j_cypher: {"query": "MATCH (n) RETURN n LIMIT 10"}
    For write_neo4j_cypher: {"query": "CREATE (n:Person {name: 'Alice'}) RETURN n"}

    END_TOOL RULES:
    - Set end_tool = true if:
      * You have all necessary information to answer the user's intent
      * This is turn 5 (max turns reached)
    - Set end_tool = false if:
      * More queries are needed to fully answer the intent
      * Current results are insufficient

    {{ ctx.output_format }}
  "#
}

// Plan web search operation with multi-turn support
// Called when RouteUserMessage returns tool_name = "web_search"
function PlanWebSearch(
  user_message: string,
  intent: string,
  previous_results: string,
  n_turn: int
) -> ToolExecutionPlan {
  client GroqWithFallback
  prompt #"
    Plan a web search operation. Turn {{ n_turn }} of max 5.

    USER MESSAGE: {{ user_message }}
    DETECTED INTENT: {{ intent }}

    PREVIOUS RESULTS (from earlier turns):
    {{ previous_results }}

    YOUR TASK:
    1. Determine the optimal search query to answer the user's intent
    2. Consider refining based on previous results

    TOOL OPTIONS:
    - toolName = "web_search" for DuckDuckGo search
    - toolName = "fetch" for fetching specific URLs

    PAYLOAD FORMAT (JSON string):
    For web_search: {"query": "your search query here"}
    For fetch: {"url": "https://example.com/page"}

    END_TOOL RULES:
    - Set end_tool = true if sufficient information gathered or turn 5
    - Set end_tool = false if more searches needed

    {{ ctx.output_format }}
  "#
}

// Plan code_mode operation for multi-tool composition
// Called when RouteUserMessage returns tool_name = "code_mode"
function PlanCodeModeOperation(
  user_message: string,
  intent: string,
  available_tools: string[],
  previous_results: string,
  n_turn: int
) -> ToolExecutionPlan {
  client GroqWithFallback
  prompt #"
    Plan a code_mode operation using JavaScript. Turn {{ n_turn }} of max 5.

    USER MESSAGE: {{ user_message }}
    DETECTED INTENT: {{ intent }}

    AVAILABLE TOOLS (can be called as JavaScript functions):
    {{ available_tools }}

    PREVIOUS RESULTS (from earlier turns):
    {{ previous_results }}

    YOUR TASK:
    Generate JavaScript that composes multiple tool calls to answer the user's intent.

    TOOL NAME: Always use "run_tools_with_javascript"

    PAYLOAD FORMAT (JSON string containing JavaScript code):
    {
      "script": "const schema = get_neo4j_schema(); const result = read_neo4j_cypher({query: 'MATCH (n) RETURN n LIMIT 5'}); return JSON.stringify({schema, result});"
    }

    JAVASCRIPT RULES:
    - Tools are available as synchronous functions
    - Return a string (JSON.stringify for objects)
    - Keep scripts concise and focused

    END_TOOL RULES:
    - Set end_tool = true if sufficient information gathered or turn 5
    - Set end_tool = false if more operations needed

    {{ ctx.output_format }}
  "#
}

// Interprets graph query results into natural language
// Uses Groq with fallback for result interpretation
function InterpretGraphResults(
  query: string,
  results: string,
  user_question: string
) -> string {
  client GroqWithFallback
  prompt #"
    The user asked: {{ user_question }}

    We executed this Cypher query:
    ```cypher
    {{ query }}
    ```

    Query results (JSON format):
    ```json
    {{ results }}
    ```

    Your task:
    - Provide a natural language explanation of these results
    - Highlight interesting patterns, relationships, and insights
    - If the results are empty, explain why that might be
    - If there are many results, summarize the key findings
    - Suggest relevant follow-up questions based on what you found

    Be conversational and helpful. Don't just list the data - help the user understand it.
  "#
}

// Validates a proposed write operation before execution
// Provides a safety check for data modifications
function ValidateWriteOperation(
  cypher_query: string,
  user_intent: string,
  current_graph_state: string
) -> string {
  client CustomSonnet4
  prompt #"
    A user wants to modify the graph database. Please validate this operation.

    User's intent: {{ user_intent }}

    Proposed Cypher query:
    ```cypher
    {{ cypher_query }}
    ```

    Current relevant graph state:
    {{ current_graph_state }}

    Your task:
    1. Verify the query is syntactically correct
    2. Check if it will do what the user intends
    3. Identify any potential issues or unintended consequences
    4. Provide a clear explanation of what will happen

    Respond with a clear explanation that helps the user understand:
    - What nodes/relationships will be created, modified, or deleted
    - Any potential side effects
    - Whether you recommend proceeding

    Be specific and clear about the impacts.
  "#
}

// ============================================================================
// Agent Functions - Response Generation
// ============================================================================

// Create final user-friendly response from tool execution results
// Called after tool loop completes (end_tool = true or max turns reached)
function CreateToolResponse(
  tool_events: string,
  user_message: string,
  intent: string
) -> string {
  client GroqWithFallback
  prompt #"
    Create a user-friendly response based on tool execution results.

    USER'S ORIGINAL MESSAGE: {{ user_message }}
    DETECTED INTENT: {{ intent }}

    TOOL EXECUTION RESULTS (JSON array of ToolEvents):
    {{ tool_events }}

    YOUR TASK:
    Synthesize the tool results into a helpful, conversational response.

    GUIDELINES:
    - Be concise but informative
    - Highlight key findings and insights
    - If results are empty, explain why and suggest alternatives
    - For graph data, summarize patterns and relationships
    - For web search, extract key information
    - Suggest relevant follow-up questions when appropriate

    Do NOT just dump raw data. Help the user understand what they found.
  "#
}

