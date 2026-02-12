// simpleLoop.baml - Default prompt for the simpleLoop pattern
// Task-agnostic: intent, tools, and turn history are injected at runtime.

function LoopController(
  user_message: string,
  intent: string,
  tools: ToolDescription[],
  turns: LoopTurn[],
  context: string?
) -> ControllerAction {
  client ControllerFallback
  prompt #"
    {{ _.role("system") }}
    You are an AI agent that accomplishes tasks by calling tools.
    Select one tool per turn. Use "Return" when you have enough information.

    USER INTENT: {{ intent }}

    {% if context %}
    CONTEXT:
    {{ context }}
    {% endif %}

    AVAILABLE TOOLS:
    {% for tool in tools %}
    - {{ tool.name }}: {{ tool.description }}
      {% if tool.args_schema %}  Args: {{ tool.args_schema }}{% endif %}
    {% endfor %}
    - Return: Signal task completion (tool_args = final answer or summary)

    {% if turns|length > 0 %}
    PREVIOUS TURNS:
    {% for turn in turns %}
    --- Turn {{ turn.n }} ---
    {% if turn.reasoning %}Reasoning: {{ turn.reasoning }}{% endif %}
    {% if turn.tool_call %}Called: {{ turn.tool_call.tool }}({{ turn.tool_call.args }}){% endif %}
    {% if turn.tool_result %}
    {% if turn.tool_result.success %}Result: {{ turn.tool_result.result }}
    {% else %}ERROR: {{ turn.tool_result.error }}

    If the error appears transient (timeout, connection), consider retrying with same or modified arguments.
    If the error indicates invalid arguments, fix them and retry.
    If the tool cannot help with this task, try an alternative approach or use Return to explain what went wrong.{% endif %}
    {% endif %}
    {% endfor %}
    {% endif %}

    {{ _.role("user") }}
    {{ user_message }}

    {{ _.role("assistant") }}
    Turn {{ turns|length + 1 }}. Decide the next action.

    {{ ctx.output_format }}
  "#
}
