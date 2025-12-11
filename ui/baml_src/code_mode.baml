// code_mode.baml - Multi-tool JavaScript composition
// Handles complex operations that require combining multiple MCP tools
//
// Workflow:
// 1. ExecuteMCPScript generates and runs JavaScript that calls MCP tools
// 2. EvaluateScriptOutput evaluates if the output answers the user's intent
// 3. If not sufficient, EvaluateScriptOutput provides guidance for retry

// ============================================================================
// Data Models
// ============================================================================

/// Output from a single script execution attempt
class ScriptExecutionEvent {
  script string @description("The JavaScript code that was executed")
  output string @description("The output/result from running the script")
  error string? @description("Error message if script failed, null if successful")
}

/// The script to execute
class MCPScriptPlan {
  reasoning string @description("Step-by-step thought process (Chain of Thought)")
  script string @description("JavaScript code to execute that calls MCP tools")
  description string @description("User-facing status message shown during execution")
}

/// Evaluation result after checking script output
class ScriptEvaluationResult {
  is_sufficient bool @description("True if the output adequately answers the user's intent")
  explanation string @description("Why the result is sufficient, OR what's missing and how to improve")
  suggested_approach string? @description("If not sufficient: guidance for next script attempt. null if sufficient")
}

// ============================================================================
// Functions
// ============================================================================

/// Generate a JavaScript script that calls MCP tools to fulfill the user's intent
/// This function is called once per attempt - errors are handled by EvaluateScriptOutput
function ExecuteMCPScript(
  user_message: string,
  intent: string,
  available_tools: string[],
  previous_attempts: ScriptExecutionEvent[]
) -> MCPScriptPlan {
  client GroqWithFallback
  prompt #"
    You are a Code Mode Agent that writes JavaScript to orchestrate MCP tool calls.

    USER INTENT: {{ intent }}
    USER MESSAGE: {{ user_message }}

    AVAILABLE MCP TOOLS (callable as synchronous JavaScript functions):
    {% for tool in available_tools %}
    - {{ tool }}
    {% endfor %}

    {% if previous_attempts.length > 0 %}
    PREVIOUS ATTEMPTS (learn from these):
    {% for attempt in previous_attempts %}
    --- Attempt {{ loop.index }} ---
    Script: {{ attempt.script }}
    {% if attempt.error %}
    ERROR: {{ attempt.error }}
    {% else %}
    Output: {{ attempt.output }}
    {% endif %}
    {% endfor %}

    IMPORTANT: The previous output was not sufficient. Improve your approach based on
    the evaluation feedback provided in the last attempt's context.
    {% endif %}

    YOUR TASK:
    Write a JavaScript script that calls the available tools to answer the user's intent.

    JAVASCRIPT RULES:
    1. All tool functions are synchronous - no async/await needed
    2. Each tool returns a string result
    3. Your script MUST return a string (use JSON.stringify for objects/arrays)
    4. Keep scripts focused and efficient
    5. Handle potential errors with try/catch when appropriate
    6. Use conditionals (if/else) and loops (for/while) as needed

    EXAMPLE PATTERNS:

    // Simple query
    const result = read_neo4j_cypher({query: 'MATCH (n) RETURN n LIMIT 5'});
    return result;

    // Multiple tools with combination
    const schema = get_neo4j_schema();
    const data = read_neo4j_cypher({query: 'MATCH (n:Person) RETURN n.name'});
    return JSON.stringify({schema: JSON.parse(schema), people: JSON.parse(data)});

    // Conditional logic
    const searchResults = search({query: 'topic'});
    const parsed = JSON.parse(searchResults);
    if (parsed.results && parsed.results.length > 0) {
      const details = fetch_content({url: parsed.results[0].url});
      return details;
    }
    return searchResults;

    // Loop through results
    const items = JSON.parse(read_neo4j_cypher({query: 'MATCH (n) RETURN n.id LIMIT 3'}));
    const details = [];
    for (const item of items) {
      const info = read_neo4j_cypher({query: 'MATCH (n) WHERE n.id = "' + item.id + '" RETURN n'});
      details.push(JSON.parse(info));
    }
    return JSON.stringify(details);

    {{ ctx.output_format }}
  "#
}

/// Evaluate whether the script output sufficiently answers the user's intent
/// Returns evaluation with explanation and optional guidance for retry
function EvaluateScriptOutput(
  intent: string,
  previous_attempts: ScriptExecutionEvent[]
) -> ScriptEvaluationResult {
  client GroqWithFallback
  prompt #"
    You are evaluating whether MCP script execution results answer a user's intent.

    USER INTENT: {{ intent }}

    EXECUTION HISTORY:
    {% for attempt in previous_attempts %}
    --- Attempt {{ loop.index }} ---
    Script executed:
    ```javascript
    {{ attempt.script }}
    ```
    {% if attempt.error %}
    RESULT: ERROR
    {{ attempt.error }}
    {% else %}
    RESULT: SUCCESS
    {{ attempt.output }}
    {% endif %}
    {% endfor %}

    YOUR TASK:
    Evaluate if the MOST RECENT result adequately answers the user's intent.

    EVALUATION CRITERIA:
    1. Does the output contain the information the user asked for?
    2. Is the data complete enough to formulate a useful response?
    3. Did any errors occur that prevent answering the intent?

    IF SUFFICIENT (is_sufficient = true):
    - Provide a clear explanation of why the output answers the intent
    - Set suggested_approach to null

    IF NOT SUFFICIENT (is_sufficient = false):
    - Explain what's missing or went wrong
    - Provide specific guidance in suggested_approach for the next attempt
    - Consider: different queries, additional tools, error handling, data transformation

    NOTE: After 3 failed attempts, you should be more lenient in accepting partial results.
    Current attempt count: {{ previous_attempts.length }}

    {{ ctx.output_format }}
  "#
}

// ============================================================================
// Tests
// ============================================================================

test ExecuteMCPScript_Simple_Query {
  functions [ExecuteMCPScript]
  args {
    user_message "Show me what's in the graph"
    intent "Query the knowledge graph to see its contents"
    available_tools ["read_neo4j_cypher", "get_neo4j_schema"]
    previous_attempts []
  }
  @@assert( {{ this.script.length > 10 }} )
  @@assert( {{ this.reasoning.length > 0 }} )
}

test ExecuteMCPScript_With_Previous_Error {
  functions [ExecuteMCPScript]
  args {
    user_message "Count all nodes"
    intent "Get a count of nodes in the graph"
    available_tools ["read_neo4j_cypher"]
    previous_attempts [
      {
        script: "return read_neo4j_cypher({query: 'MATCH (n) RETURN count(n)'})",
        output: "",
        error: "Syntax error: unexpected token"
      }
    ]
  }
  @@assert( {{ this.script.length > 10 }} )
}

test EvaluateScriptOutput_Sufficient {
  functions [EvaluateScriptOutput]
  args {
    intent "Count nodes in the graph"
    previous_attempts [
      {
        script: "return read_neo4j_cypher({query: 'MATCH (n) RETURN count(n) as total'})",
        output: "[{\"total\": 25}]",
        error: null
      }
    ]
  }
  @@assert( {{ this.is_sufficient == true }} )
}

test EvaluateScriptOutput_Insufficient {
  functions [EvaluateScriptOutput]
  args {
    intent "Find all Person nodes with their relationships"
    previous_attempts [
      {
        script: "return read_neo4j_cypher({query: 'MATCH (n) RETURN n LIMIT 1'})",
        output: "[{\"n\": {\"name\": \"Test\"}}]",
        error: null
      }
    ]
  }
  @@assert( {{ this.is_sufficient == false }} )
  @@assert( {{ this.suggested_approach != null }} )
}
