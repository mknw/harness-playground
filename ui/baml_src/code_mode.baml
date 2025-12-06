// code_mode.baml - Multi-tool JavaScript composition
// Handles complex operations that require combining multiple tools

// ============================================================================
// Enums
// ============================================================================

enum CodeModeToolName {
  Execute @alias("run_tools_with_javascript") @description("Run JavaScript script that calls multiple tools")
  Return @description("Stop loop and return accumulated results to next step")
}

// ============================================================================
// Data Models
// ============================================================================

class CodeModeToolExecutionPlan {
  reasoning string @description("Step-by-step thought process (Chain of Thought)")
  tool_name CodeModeToolName @description("Which code mode tool to use")
  payload map<"script", string>? @description("JavaScript code to execute. null if tool_name is Return")
  description string @description("User-facing status message shown during execution")
}

// ============================================================================
// Functions
// ============================================================================

function PlanCodeModeOperation(
  user_message: string,
  intent: string,
  available_tools: string[],
  previous_results: string,
  n_turn: int
) -> CodeModeToolExecutionPlan {
  client GroqWithFallback
  prompt #"
    You are a Code Mode Agent. The user wants to: {{ intent }}

    Turn {{ n_turn }}/5. You must complete within 5 turns.

    USER MESSAGE: {{ user_message }}

    AVAILABLE TOOLS (callable as JavaScript functions):
    {% for tool in available_tools %}
    - {{ tool }}
    {% endfor %}

    PREVIOUS RESULTS (from earlier turns):
    {{ previous_results }}

    YOUR TASK:
    Generate JavaScript that composes multiple tool calls to answer the user's intent.

    TOOL SELECTION:
    - Execute: Run JavaScript that calls available tools
    - Return: When you have enough info to answer - stops the loop

    JAVASCRIPT RULES:
    - Tools are available as synchronous functions
    - Return a string (use JSON.stringify for objects)
    - Keep scripts concise and focused
    - Example: const schema = get_neo4j_schema(); const data = read_neo4j_cypher({query: 'MATCH (n) RETURN n LIMIT 5'}); return JSON.stringify({schema, data});

    Choose Return if previous_results contains sufficient information.

    {{ ctx.output_format }}
  "#
}
