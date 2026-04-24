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

### 2. BAML Functions (`agent.baml`)

Structured LLM reasoning with type-safe outputs:

| Function | Purpose | Output |
|----------|---------|--------|
| `RouteUserMessage` | Intent detection & routing | `RoutingInterfaceEvent` |
| `PlanNeo4jOperation` | Neo4j query planning | `ToolExecutionPlan` |
| `PlanWebSearch` | Web search planning | `ToolExecutionPlan` |
| `PlanCodeModeOperation` | Multi-tool JS composition | `ToolExecutionPlan` |
| `CreateToolResponse` | Result synthesis | `string` |

### 3. Server Functions (`server.ts`)

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
│                       USER MESSAGE                               │
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
              │                                                    │
              │  ┌─────────────────────────────────────────────┐  │
              │  │ Step 4: Plan* (BAML) - namespace-specific   │  │
              │  │ → PlanNeo4jOperation / PlanWebSearch / etc  │  │
              │  │ → Returns: ToolExecutionPlan                 │  │
              │  │   - reasoning, toolName, payload, end_tool   │  │
              │  └─────────────────────────────────────────────┘  │
              │                       │                            │
              │                       ▼                            │
              │  ┌─────────────────────────────────────────────┐  │
              │  │ Step 5: Check Approval (for writes)         │  │
              │  │ → If write: check approvalState             │  │
              │  │ → Return pending if approval needed         │  │
              │  └─────────────────────────────────────────────┘  │
              │                       │                            │
              │                       ▼                            │
              │  ┌─────────────────────────────────────────────┐  │
              │  │ Step 6-8: Execute Tool                      │  │
              │  │ → Neo4j: direct neo4j-driver                │  │
              │  │ → Web/Code: MCP Gateway (port 8811)         │  │
              │  │ → Returns: ToolEvent with stats             │  │
              │  └─────────────────────────────────────────────┘  │
              │                       │                            │
              │                       ▼                            │
              │           ┌─────────────────────┐                  │
              │           │ end_tool = true?    │                  │
              │           │ OR n_turn >= 5?     │                  │
              │           └─────────────────────┘                  │
              │                 │         │                        │
              │                 no        yes                      │
              │                 │         │                        │
              │                 └─────────┼────────────────────────│
              │                           │                        │
              └───────────────────────────┼────────────────────────┘
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
| `web_search` | Mcp | web_search (DuckDuckGo), fetch | MCP Gateway |
| `code_mode` | CodeMode | JavaScript composition | MCP Gateway code-mode |

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

Port: **8811** (configured in docker-compose.yaml and server.ts)

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
| `ui/src/lib/utcp-baml-agent/state.ts` | Event types, Thread class, helpers |
| `ui/src/lib/utcp-baml-agent/server.ts` | Server functions, tool execution |
| `ui/src/lib/utcp-baml-agent/orchestrator.ts` | Client-side orchestration |
| `ui/baml_src/agent.baml` | BAML function definitions |
| `ui/src/components/ark-ui/ToolCallDisplay.tsx` | Tool call UI component |
