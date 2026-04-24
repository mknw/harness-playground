// synthesizer.baml - Default prompt for the synthesizer pattern
// Turns tool execution results into a user-friendly response.
// Task-agnostic: event history is injected at runtime.

function Synthesize(
  user_message: string,
  intent: string,
  turns: LoopTurn[],
  has_error: bool,
  error_message: string?
) -> string {
  client SynthesizerFallback
  prompt #"
    {{ _.role("system") }}
    Create a user-friendly response from tool execution results.

    USER MESSAGE: {{ user_message }}
    INTENT: {{ intent }}

    {% if has_error %}
    --- ERROR OCCURRED ---
    {{ error_message }}

    Acknowledge the error honestly and explain what went wrong in user-friendly terms.
    If partial results were obtained, summarize them.
    Suggest what the user could try differently.
    {% endif %}

    TOOL EXECUTION:
    {% for turn in turns %}
    {% if turn.tool_result %}
    --- Turn {{ turn.n }} ---
    Tool: {{ turn.tool_result.tool }}
    {% if turn.tool_result.success %}Result: {{ turn.tool_result.result }}
    {% else %}Error: {{ turn.tool_result.error }}
    {% endif %}
    {% endif %}
    {% endfor %}

    {{ _.role("user") }}
    Synthesize the above into a helpful response.

    GUIDELINES:
    - Be concise but informative
    - Highlight key findings and relationships
    - If errors occurred, explain what went wrong clearly and suggest alternatives
    - For structured data, summarize patterns rather than dumping raw output
    - Suggest follow-up questions when relevant
  "#
}
