# BAML Agent Architecture

Event-driven, streaming architecture for the knowledge graph agent with multi-turn tool execution.

## Overview

The agent follows a 13-step flow inspired by [12-factor-agents](https://github.com/humanalog/12-factor-agents):

```
User Message → Routing → Tool Loop → Response Generation → UI Update
```

## Core Components

### 1. State Management (`state.ts`)

Thread-based event store for conversation history:

```typescript
// Event types
type ThreadEventType =
  | 'user_message'
  | 'tool_call'
  | 'tool_response'
  | 'assistant_message'
  | 'approval_request'
  | 'approval_response'
  | 'system_message'
  | 'error';

// Thread class with XML-like serialization for LLM context
class Thread {
  addUserMessage(content: string): void;
  addToolCall(tool: string, parameters: Record<string, unknown>): void;
  addToolResponse(tool: string, result: unknown): void;
  serializeForLLM(): string;  // XML-like format for context
}
```

### 2. BAML Functions (Namespace Files)

Structured LLM reasoning with type-safe outputs, split into namespace-specific files:

| File | Function | Purpose | Output |
|------|----------|---------|--------|
| `routing.baml` | `RouteUserMessage` | Intent detection & routing | `RoutingInterfaceEvent` |
| `neo4j.baml` | `PlanNeo4jOperation` | Neo4j query planning | `Neo4jToolExecutionPlan` |
| `web_search.baml` | `PlanWebSearch` | Web search planning | `WebSearchToolExecutionPlan` |
| `code_mode.baml` | `PlanCodeModeOperation` | Multi-tool JS composition | `CodeModeToolExecutionPlan` |
| `response.baml` | `CreateToolResponse` | Result synthesis | `string` |

Each namespace has its own enum with **Return** action for early loop exit:

```baml
enum Neo4jToolName {
  Read @alias("read_neo4j_cypher")
  Write @alias("write_neo4j_cypher")
  Schema @alias("get_neo4j_schema")
  Return @description("Stop loop and return accumulated results")
}
```

### 3. Agent Integration Layer (`agent.ts`)

Unified tool execution routing between direct Neo4j and MCP gateway:

```typescript
// Execute a tool based on namespace and plan
export async function executeTool(
  namespace: ToolNamespace,
  toolName: string,
  payload: string | Record<string, unknown>
): Promise<ToolResult>

// Helper functions
export function isReturnAction(toolName: string): boolean
export function requiresWriteApproval(toolName: string): boolean
export function getToolDisplayName(toolName: string): string
```

### 4. MCP Client (`mcp-client.ts`)

SDK-based client using `@modelcontextprotocol/sdk`:

```typescript
// Singleton client connection
export async function getMcpClient(): Promise<Client>

// Tool execution
export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>
export async function listTools(): Promise<string[]>

// Convenience wrappers
export async function neo4jRead(query: string): Promise<ToolCallResult>
export async function webSearch(query: string): Promise<ToolCallResult>
```

### 5. Server Functions (`server.ts`)

SolidStart server functions with streaming:

```typescript
// Main entry point
export async function processAgentMessageStreaming(
  message: string,
  threadEvents: SerializedThread,
  approvalState?: ApprovalState
): Promise<ProcessMessageResult>

// Multi-turn tool execution
async function executeToolLoop(
  routing: RoutingInterfaceEvent,
  message: string,
  thread: Thread,
  approvalState: ApprovalState
): Promise<ToolLoopResult>
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       USER MESSAGE                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: RouteUserMessage (BAML)                                 │
│ → Returns: RoutingInterfaceEvent                                │
│   - intent, tool_call_needed, tool_mode, tool_name, response    │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
      ┌──────────────┐              ┌─────────────────────┐
      │ No Tool      │              │ Tool Needed         │
      │ Return text  │              │ Enter Tool Loop     │
      └──────────────┘              └─────────────────────┘
                                              │
                                              ▼
              ┌───────────────────────────────────────────────────┐
              │ Steps 4-10: Tool Execution Loop (max 5 turns)     │
              │                                                   │
              │  ┌─────────────────────────────────────────────┐  │
              │  │ Step 4: Plan* (BAML) - namespace-specific   │  │
              │  │ → PlanNeo4jOperation / PlanWebSearch / etc  │  │
              │  │ → Returns: ToolExecutionPlan                │  │
              │  │   - reasoning, toolName, payload, isReturn  │  │
              │  └─────────────────────────────────────────────┘  │
              │                       │                           │
              │                       ▼                           │
              │  ┌─────────────────────────────────────────────┐  │
              │  │ Step 5: Check for Return action             │  │
              │  │ → If isReturn: exit loop immediately        │  │
              │  └─────────────────────────────────────────────┘  │
              │                       │                           │
              │                       ▼                           │
              │  ┌─────────────────────────────────────────────┐  │
              │  │ Step 6: Check Approval (for writes)         │  │
              │  │ → If write: check approvalState             │  │
              │  │ → Return pending if approval needed         │  │
              │  └─────────────────────────────────────────────┘  │
              │                       │                           │
              │                       ▼                           │
              │  ┌─────────────────────────────────────────────┐  │
              │  │ Step 7-9: Execute Tool (via agent.ts)       │  │
              │  │ → Neo4j: direct neo4j-driver                │  │
              │  │ → Web/Code: MCP SDK client                  │  │
              │  │ → Returns: ToolEvent with stats             │  │
              │  └─────────────────────────────────────────────┘  │
              │                       │                           │
              │                       ▼                           │
              │           ┌─────────────────────┐                 │
              │           │ n_turn >= 5?        │                 │
              │           └─────────────────────┘                 │
              │                 │         │                       │
              │                 no        yes                     │
              │                 │         │                       │
              │                 └─────────┼───────────────────────│
              │                           │                       │
              └───────────────────────────┼───────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 11: CreateToolResponse (BAML)                              │
│ → Synthesize tool results into user-friendly response           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Steps 12-13: Update Thread & Return to UI                       │
│ → Stream events for real-time UI updates                        │
│ → Return graph data for visualization                           │
└─────────────────────────────────────────────────────────────────┘
```

## Tool Namespaces

| Namespace | Mode | Tools | Execution |
|-----------|------|-------|-----------|
| `neo4j` | Mcp | read_neo4j_cypher, write_neo4j_cypher, get_neo4j_schema | Direct neo4j-driver |
| `web_search` | Mcp | search (DuckDuckGo), fetch | MCP SDK Client |
| `code_mode` | CodeMode | JavaScript composition | MCP SDK Client |

All namespaces support the `Return` action for early loop exit.

## Streaming Events

Real-time UI updates via `StreamEvent`:

```typescript
type StreamEventType =
  | 'routing'    // Intent detected
  | 'planning'   // Tool plan created
  | 'executing'  // Tool executing
  | 'processing' // Processing results
  | 'complete'   // Final response
  | 'error';     // Error occurred
```

## Token Management

Automatic context pruning when exceeding 8000 tokens:

```typescript
const MAX_THREAD_TOKENS = 8000;

function prepareResultsForContext(toolEvents: ToolEvent[]): string {
  // Keep last 2 events full, prune older ones to stats only
}
```

## Approval System

Three approval levels for write operations:

| Level | Behavior |
|-------|----------|
| `one_time` | Prompt for each write |
| `thread` | Approve once for session |
| `tool_based` | Approve per tool type |

## Configuration

### MCP Gateway

Port: **8811** (configured in docker-compose.yaml and mcp-client.ts)

```yaml
# docker-compose.yaml
mcp-gateway:
  ports:
    - "8811:8811"
  command:
    - --port=8811
```

### BAML Clients

- Primary: `GroqWithFallback` (Llama 3.3 70B)
- Validation: `CustomSonnet4` (Claude Sonnet 4)

## Files

| File | Purpose |
|------|---------|
| `ui/src/lib/baml-agent/state.ts` | Event types, Thread class, BAML type adapters |
| `ui/src/lib/baml-agent/server.ts` | Server functions, tool loop |
| `ui/src/lib/baml-agent/agent.ts` | Tool execution integration layer |
| `ui/src/lib/baml-agent/mcp-client.ts` | MCP SDK client wrapper |
| `ui/src/lib/baml-agent/orchestrator.ts` | Client-side orchestration |
| `ui/baml_src/routing.baml` | Message routing and intent detection |
| `ui/baml_src/neo4j.baml` | Neo4j tool planning |
| `ui/baml_src/web_search.baml` | Web search tool planning |
| `ui/baml_src/code_mode.baml` | Code mode tool planning |
| `ui/baml_src/response.baml` | Response generation |
| `ui/src/components/ark-ui/ToolCallDisplay.tsx` | Tool call UI component |
