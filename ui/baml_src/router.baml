// router.baml - Default prompt for the router pattern
// Routes user messages to the appropriate handler/chain.
// Task-agnostic: routes and history are injected at runtime.

function Router(
  message: string,
  routes: RouteOption[],
  history: Message[]
) -> RoutingResult {
  client GroqWithFallback
  prompt #"
    {{ _.role("system") }}
    Analyze the user message and determine routing.

    AVAILABLE ROUTES:
    {% for route in routes %}
    - {{ route.name }}: {{ route.description }}
    {% endfor %}

    {% if history|length > 0 %}
    CONVERSATION HISTORY (most recent last):
    {% for m in history %}
    {{ m.role|upper }}: {{ m.content }}
    {% endfor %}
    {% endif %}

    {{ _.role("user") }}
    {{ message }}

    {{ _.role("assistant") }}
    ROUTING RULES:
    - Set needs_tool=true if the message requires calling a tool or route
    - Set route to the matching route name (null if no tool needed)
    - Set needs_tool=false for greetings, thanks, help requests, or simple clarifications
    - Always provide a response: an immediate answer if no tool needed, or a brief status if routed

    {{ ctx.output_format }}
  "#
}
