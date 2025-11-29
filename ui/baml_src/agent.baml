// Knowledge Graph Agent Functions
// These functions power the AI agent that helps users explore and query the Neo4j graph

// ============================================================================
// Data Models
// ============================================================================

class GraphQuery {
  cypher string @description("The Cypher query to execute")
  explanation string @description("Human-readable explanation of what this query does")
  read_only bool @description("True if this is a read-only query, false if it modifies data")
  estimated_nodes int? @description("Estimated number of nodes this query might return")
}

class AgentResponse {
  message string @description("The agent's response to the user")
  requires_graph_query bool @description("Whether this response needs to query the graph")
  query GraphQuery? @description("The graph query to execute, if needed")
}

// Lightweight intent detection response (no schema required)
class IntentResponse {
  message string @description("Conversational response to the user")
  requires_graph_query bool @description("Whether a graph query is needed to answer this")
  query_intent string? @description("Natural language description of what to query, if needed")
}

// ============================================================================
// Agent Functions
// ============================================================================

// Step 1: Lightweight intent detection (NO schema required)
// Determines if the user needs a graph query or just a conversational response
function DetectIntent(
  message: string,
  conversation_history: string[]
) -> IntentResponse {
  client GroqWithFallback
  prompt #"
    You are a knowledge graph assistant. Analyze the user's message to determine
    if they need to query the graph database.

    User's message:
    {{ message }}

    Conversation history (recent messages):
    {{ conversation_history }}

    Determine:
    1. If the user is asking about data IN the graph (needs query) -> requires_graph_query = true
    2. If the user is just chatting or asking about capabilities (no query needed) -> requires_graph_query = false

    Examples that NEED a graph query:
    - "Show me all people in the graph"
    - "What relationships does Alice have?"
    - "Find nodes connected to Company X"
    - "Create a new person named Bob"
    - "How many nodes are there?"
    - "What's in the database?"

    Examples that DON'T need a graph query:
    - "Hello, how are you?"
    - "What can you do?"
    - "Thanks for your help"
    - "Can you explain what a knowledge graph is?"
    - "How do I write a Cypher query?"

    If a graph query IS needed:
    - Provide a brief conversational acknowledgment in 'message'
    - Describe what the user wants to find/do in 'query_intent'

    If NO graph query is needed:
    - Provide a helpful conversational response in 'message'
    - Leave 'query_intent' empty

    {{ ctx.output_format }}
  "#
}

// Main agent function - processes user messages and determines what action to take
// Uses Groq for fast inference with OpenAI fallback
// NOTE: This function requires graph_schema - use DetectIntent first for efficiency
function ProcessUserMessage(
  message: string,
  conversation_history: string[],
  graph_schema: string
) -> AgentResponse {
  client GroqWithFallback
  prompt #"
    You are a knowledge graph assistant helping users explore and understand their Neo4j graph database.

    User's latest message:
    {{ message }}

    Conversation history (recent messages):
    {{ conversation_history }}

    Available graph schema:
    {{ graph_schema }}

    Your task:
    1. Understand what the user wants to know or do
    2. Determine if you need to query the graph to answer their question
    3. If a query is needed, generate an appropriate Cypher query
    4. If not, respond conversationally based on the context

    Guidelines:
    - Be conversational and helpful
    - Use LIMIT clauses to prevent overwhelming results (default: 10-20 nodes)
    - Mark queries as read_only=true unless they explicitly modify data (CREATE, DELETE, SET, REMOVE)
    - Provide clear explanations of what queries do
    - Suggest helpful follow-up questions when appropriate

    {{ ctx.output_format }}
  "#
}

// Specialized function for generating Cypher queries
// Uses Groq for fast query generation
function GenerateCypherQuery(
  user_intent: string,
  schema: string
) -> GraphQuery {
  client CustomGroq
  prompt #"
    Generate a Neo4j Cypher query based on the user's intent.

    User wants to: {{ user_intent }}

    Available graph schema:
    {{ schema }}

    Requirements:
    - Write syntactically correct Cypher
    - Use LIMIT to prevent overwhelming results (suggest 10-50 depending on the query)
    - Estimate how many nodes this query might return
    - Mark as read_only=true for queries that don't modify data
    - Mark as read_only=false for CREATE, DELETE, SET, REMOVE operations
    - Provide a clear explanation of what the query does

    Examples of read-only queries:
    - MATCH (n) RETURN n LIMIT 10
    - MATCH (p:Person)-[r:KNOWS]->(f) RETURN p, r, f
    - MATCH (n) WHERE n.name CONTAINS 'Alice' RETURN n

    Examples of write queries:
    - CREATE (n:Person {name: 'Alice'}) RETURN n
    - MATCH (n:Person {name: 'Bob'}) DELETE n
    - MATCH (n:Person) SET n.updated = timestamp()

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
