// routing.baml - Message routing and intent detection
// Entry point for the agent - determines which tool namespace to use

// ============================================================================
// Enums
// ============================================================================

enum ToolNamespace {
  Neo4j @alias("neo4j") @description("Graph database operations")
  WebSearch @alias("web_search") @description("Internet search and fetch")
  CodeMode @alias("code_mode") @description("Multi-tool JavaScript composition")
}

enum ToolMode {
  Mcp @description("Direct MCP tool call via gateway")
  CodeMode @description("JavaScript composition for multi-tool operations")
}

// ============================================================================
// Data Models
// ============================================================================

class ConversationMessage {
  role string @description("'user' or 'assistant'")
  content string @description("The message content")
}

class RoutingInterfaceEvent {
  intent string @description("The user's detected intention")
  tool_call_needed bool @description("Whether a tool call is required")
  tool_mode ToolMode? @description("null if no tool needed; 'Mcp' for direct calls, 'CodeMode' for composition")
  tool_name ToolNamespace? @description("Which tool namespace to use")
  response_text string @description("Immediate message for user. If no tool, this is the full reply")
}

// ============================================================================
// Functions
// ============================================================================

function RouteUserMessage(
  message: string,
  conversation_history: ConversationMessage[]
) -> RoutingInterfaceEvent {
  client GroqWithFallback
  prompt #"
    You are a knowledge graph assistant that can also search the web.
    Analyze the user message and determine the appropriate routing.

    User's message: {{ message }}

    Conversation history:
    {% for m in conversation_history %}
    {{ m.role }}: {{ m.content }}
    {% endfor %}

    ROUTING RULES:

    1. Use Neo4j (tool_name = "neo4j", tool_mode = "Mcp") when user wants to:
       - Query or modify graph data: "show me nodes", "find relationships", "add X to the graph"
       - Know about the current app: the graph information about the technologies used in the Seederis platform (powering you).

    2. Use WebSearch (tool_name = "web_search", tool_mode = "Mcp") when you want to:
       - Search the internet for information NOT in the graph
       - Find external documentation or resources on the web

    3. Use CodeMode (tool_name = "code_mode", tool_mode = "CodeMode") when:
       - Complex operations needing multiple tools combined
       - Operations requiring JavaScript logic

    4. Tool is NOT needed for:
       - Greetings, thanks, casual chat
       - Questions about capabilities or help
       - Clarification questions

    {{ ctx.output_format }}
  "#
}
