// actorCritic.baml - Default prompts for the actorCritic pattern
// Two functions: Actor generates actions, Critic evaluates results.
// Task-agnostic: tools, attempts, and feedback are injected at runtime.

// ============================================================================
// Actor - Generates tool calls, improving from critic feedback
// ============================================================================

function ActorController(
  user_message: string,
  intent: string,
  tools: ToolDescription[],
  attempts: Attempt[]
) -> ControllerAction {
  client ControllerFallback
  prompt #"
    {{ _.role("system") }}
    You are an AI agent that accomplishes tasks by calling tools.
    A critic evaluates your output. Learn from previous feedback.

    USER INTENT: {{ intent }}

    AVAILABLE TOOLS:
    {% for tool in tools %}
    - {{ tool.name }}: {{ tool.description }}
      {% if tool.args_schema %}  Args: {{ tool.args_schema }}{% endif %}
    {% endfor %}
    - Return: Signal task completion (tool_args = final answer or summary)

    {% if attempts|length > 0 %}
    PREVIOUS ATTEMPTS:
    {% for attempt in attempts %}
    --- Attempt {{ attempt.n }} ---
    Action: {{ attempt.action.tool_name }}({{ attempt.action.tool_args }})
    Reasoning: {{ attempt.action.reasoning }}
    {% if attempt.error %}ERROR: {{ attempt.error }}
    {% else %}Result: {{ attempt.result }}
    {% endif %}
    {% if attempt.feedback %}CRITIC FEEDBACK: {{ attempt.feedback }}{% endif %}
    {% endfor %}

    You MUST address the critic's feedback. Do not repeat failed approaches.
    {% endif %}

    {{ _.role("user") }}
    {{ user_message }}

    {{ _.role("assistant") }}
    Attempt {{ attempts|length + 1 }}.

    {{ ctx.output_format }}
  "#
}

// ============================================================================
// Critic - Evaluates whether the actor's output satisfies the intent
// ============================================================================

function Critic(
  intent: string,
  attempts: Attempt[]
) -> CriticResult {
  client CriticFallback
  prompt #"
    {{ _.role("system") }}
    You evaluate whether task execution results satisfy the user's intent.
    Be precise about what is missing. Be lenient with partial results after multiple attempts.

    USER INTENT: {{ intent }}

    EXECUTION HISTORY:
    {% for attempt in attempts %}
    --- Attempt {{ attempt.n }} ---
    Action: {{ attempt.action.tool_name }}({{ attempt.action.tool_args }})
    Reasoning: {{ attempt.action.reasoning }}
    {% if attempt.error %}RESULT: ERROR — {{ attempt.error }}
    {% else %}RESULT: {{ attempt.result }}
    {% endif %}
    {% endfor %}

    {{ _.role("user") }}
    Evaluate the MOST RECENT result against the intent.

    CRITERIA:
    1. Does the output contain the needed information?
    2. Is the data complete enough to form a response?
    3. Did errors prevent answering the intent?

    IF SUFFICIENT: set is_sufficient=true, explain why. Leave suggested_approach null.
    IF NOT SUFFICIENT: set is_sufficient=false, explain what is missing, provide specific guidance.

    {% if attempts|length >= 3 %}
    NOTE: {{ attempts|length }} attempts have been made. Accept partial results if they provide meaningful information.
    {% endif %}

    {{ ctx.output_format }}
  "#
}
