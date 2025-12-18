# Harness Patterns

A lean, composable framework for server-side agentic tool execution patterns.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    orchestrator.server.ts                       │
│  High-level API: simpleNeo4jLoop, webSearchLoop, codeModeLoop   │
│  Returns: { response, telemetry } to client                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      patterns.server.ts                         │
│  Composable patterns with OpenTelemetry spans                   │
│  SimpleLoop, ExecutorEvaluator, CodeMode                        │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│   planners.server.ts     │    │   mcp-client.server.ts   │
│  BAML function wrappers  │    │  MCP SDK tool execution  │
│  (neo4jOp, webSearchOp,  │    │  (callTool, listTools)   │
│   mcpOp, codePlannerOp)  │    │                          │
└──────────────────────────┘    └──────────────────────────┘
```

## Design Principles

### 1. Server-Only Execution

All harness-patterns code runs exclusively on the server. Files use `.server.ts` suffix.
Only the final response and telemetry summary are sent to the client.

```typescript
// Server-side check
function assertServer() {
  if (typeof window !== 'undefined') {
    throw new Error('harness-patterns must run on server');
  }
}
```

### 2. OpenTelemetry Integration

- **BAML functions**: Use built-in OpenTelemetry compatibility (automatic spans)
- **Patterns**: Create explicit spans via `@opentelemetry/api`
- **No context providers**: Telemetry flows through OTel, not React context

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('harness-patterns');

async function simpleLoop(ctx: PlannerContext, options: SimpleLoopOptions) {
  return tracer.startActiveSpan('pattern.simpleLoop', async (span) => {
    span.setAttribute('maxTurns', options.maxTurns);
    span.setAttribute('serverName', options.serverName);
    try {
      // ... pattern logic
      return result;
    } finally {
      span.end();
    }
  });
}
```

### 3. Standalone Module

No `"use server"` directives. This module will be packaged independently.
Server-side enforcement is via runtime checks, not framework directives.

### 4. Tool-Agnostic Operations

Read/Write are abstract operations. BAML `@alias` handles mapping:
```baml
enum Neo4jToolName {
  Read @alias("read_neo4j_cypher")
  Write @alias("write_neo4j_cypher")
}
```

### 5. MCP-First Execution

All tool execution routes through MCP gateway. No direct driver calls.

---

## File Structure

```
harness-patterns/
├── index.ts                    # Public exports
├── types.ts                    # Shared types/interfaces
├── assert.server.ts            # Server-side assertion utilities
├── state.server.ts             # Thread class, serialization
├── mcp-client.server.ts        # MCP SDK wrapper
├── planners.server.ts          # BAML operation wrappers
├── patterns.server.ts          # Composable loop patterns + OTel spans
├── orchestrator.server.ts      # High-level API surface
└── README.md
```

---

## Module Specifications

### `types.ts`

Shared types (no server-side code):

```typescript
// Thread context for planners
export interface PlannerContext {
  thread: Thread;
  intent: string;
  previousResults?: ToolEvent[];
  turn: number;
}

// Consistent pattern output
export interface PatternResult {
  toolEvents: ToolEvent[];
  finalResult: unknown;
  threadEvents?: SerializedThread;
  metadata: {
    turnsUsed: number;
    exitReason: 'return' | 'max_turns' | 'error' | 'approval_needed';
  };
}

// MCP tool description
export interface MCPToolDescription {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Tool execution plan
export interface ToolExecutionPlan {
  reasoning: string;
  toolName: string;
  payload: string;
  description: string;
  isReturn: boolean;
}

// Tool event from execution
export interface ToolEvent {
  status_code: number;
  status_description: string;
  operation: string;
  data: unknown;
  n_turn: number;
  stats?: {
    duration_ms?: number;
    token_count?: number;
  };
}

// Final output to client
export interface OrchestratorResult {
  response: string;
  telemetry: TelemetrySummary;
  needsApproval?: boolean;
  pendingPlan?: ToolExecutionPlan;
}

export interface TelemetrySummary {
  totalDuration_ms: number;
  turnsUsed: number;
  toolCalls: number;
  exitReason: string;
}
```

### `assert.server.ts`

Runtime server-side enforcement:

```typescript
export function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error('harness-patterns must run on server');
  }
}

export function assertServerOnImport(): void {
  assertServer();
}
```

### `mcp-client.server.ts`

MCP SDK wrapper (server-only):

```typescript
import { assertServerOnImport } from './assert.server';
assertServerOnImport();

export async function getMcpClient(): Promise<Client>;
export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
export async function listTools(): Promise<MCPToolDescription[]>;
export async function closeMcpClient(): Promise<void>;
```

### `planners.server.ts`

BAML operation wrappers with OTel spans:

```typescript
import { assertServerOnImport } from './assert.server';
import { trace } from '@opentelemetry/api';
assertServerOnImport();

const tracer = trace.getTracer('harness-patterns.planners');

export async function neo4jOp(ctx: PlannerContext): Promise<ToolExecutionPlan>;
export async function webSearchOp(ctx: PlannerContext): Promise<ToolExecutionPlan>;
export async function mcpOp(
  ctx: PlannerContext,
  serverName: string,
  tools?: MCPToolDescription[]
): Promise<ToolExecutionPlan>;
export async function codePlannerOp(
  ctx: PlannerContext,
  availableTools: MCPToolDescription[],
  existingCodedTools: CodedTool[]
): Promise<ToolExecutionPlan>;
export async function evaluateScriptOp(
  intent: string,
  executionEvents: ScriptExecutionEvent[]
): Promise<ScriptEvaluationResult>;
export async function createResponseOp(
  toolResults: ToolEvent[],
  intent: string
): Promise<string>;
```

### `patterns.server.ts`

Composable patterns with OpenTelemetry instrumentation:

```typescript
import { assertServerOnImport } from './assert.server';
import { trace, SpanStatusCode } from '@opentelemetry/api';
assertServerOnImport();

const tracer = trace.getTracer('harness-patterns.patterns');

// Pattern 1: Simple Loop
export async function simpleLoop(
  context: PlannerContext,
  options: {
    plannerOp: PlannerFn;
    serverName: string;
    maxTurns: number;
  }
): Promise<PatternResult> {
  return tracer.startActiveSpan('pattern.simpleLoop', async (span) => {
    span.setAttribute('pattern.type', 'simpleLoop');
    span.setAttribute('pattern.maxTurns', options.maxTurns);
    span.setAttribute('pattern.serverName', options.serverName);

    try {
      // ... loop logic with child spans per turn
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

// Pattern 2: Executor-Evaluator Loop
export async function executorEvaluatorLoop(
  context: PlannerContext,
  mcpToolInfo: MCPToolDescription[],
  options: {
    serverNames: string[];
    maxTurns: number;
    executor?: PlannerFn;
    evaluator?: EvaluatorFn;
  }
): Promise<PatternResult>;

// Pattern 3: Code Mode Loop
export async function codeModeLoop(
  context: PlannerContext,
  options: {
    maxTurns: number;
    createTools: boolean;
    existingCodedTools: CodedTool[];
    mcpTools: MCPToolDescription[];
  }
): Promise<PatternResult & { newCodedTools?: CodedTool[] }>;

// Pattern 4: Response Wrapper
export async function withResponse(
  patternResult: PatternResult,
  intent: string,
  responseCallback?: typeof createResponseOp
): Promise<PatternResult & { response: string }>;
```

### `orchestrator.server.ts`

High-level API returning only response + telemetry to client:

```typescript
import { assertServerOnImport } from './assert.server';
import { trace } from '@opentelemetry/api';
assertServerOnImport();

const tracer = trace.getTracer('harness-patterns.orchestrator');

export class AgentOrchestrator {
  private thread: Thread;
  private pendingPlan: ToolExecutionPlan | null = null;

  constructor() {
    assertServer();
    this.thread = new Thread();
  }

  // All methods return OrchestratorResult (response + telemetry only)
  async processMessage(message: string): Promise<OrchestratorResult>;
  async neo4jLoop(message: string): Promise<OrchestratorResult>;
  async webSearchLoop(message: string): Promise<OrchestratorResult>;
  async codeModeLoop(message: string): Promise<OrchestratorResult>;

  // Approval flow
  hasPendingApproval(): boolean;
  async approveOperation(): Promise<OrchestratorResult>;
  async rejectOperation(reason?: string): Promise<OrchestratorResult>;

  // State management
  clearConversation(): void;
}
```

---

## OpenTelemetry Span Hierarchy

```
orchestrator.processMessage
├── routing.RouteUserMessage          (BAML auto-span)
├── pattern.simpleLoop
│   ├── turn.1
│   │   ├── planner.neo4jOp
│   │   │   └── baml.PlanNeo4jOperation  (BAML auto-span)
│   │   └── mcp.callTool
│   ├── turn.2
│   │   └── ...
│   └── turn.N
└── response.createResponseOp
    └── baml.CreateToolResponse       (BAML auto-span)
```

---

## BAML Functions Required

### Existing (in `ui/baml_src/`)

| Function | File | Purpose |
|----------|------|---------|
| `RouteUserMessage` | routing.baml | Intent detection, namespace routing |
| `PlanNeo4jOperation` | neo4j.baml | Neo4j-specific planning |
| `PlanWebSearch` | web_search.baml | Web search planning |
| `ExecuteMCPScript` | code_mode.baml | Code mode script generation |
| `EvaluateScriptOutput` | code_mode.baml | Script output evaluation |
| `CreateToolResponse` | response.baml | User-facing response synthesis |

### New (to create)

| Function | File | Purpose |
|----------|------|---------|
| `PlanMCP` | mcp.baml | Generic MCP tool planning |

---

## Migration Plan

### Files to Delete
- `agent.ts` (replaced by `planners.server.ts`)
- `server.ts` (logic moves to orchestrator + planners)
- `telemetry.ts` (replaced by OTel)
- `telemetry-store.ts` (replaced by OTel exporters)
- `tool-config.ts` (simplify)
- `tool-repository.ts` (defer to later)
- All `__tests__/` (rewrite minimal tests)

### Files to Rename
- `state.ts` → `state.server.ts`
- `mcp-client.ts` → `mcp-client.server.ts`
- `orchestrator.ts` → `orchestrator.server.ts`

### Files to Create
- `types.ts`: Shared interfaces (no server code)
- `assert.server.ts`: Server-side checks
- `planners.server.ts`: BAML wrappers
- `patterns.server.ts`: Pattern implementations
- `index.ts`: Public exports

---

## Client Integration

The client only receives `OrchestratorResult`:

```typescript
// Server-side (e.g., SolidStart API route)
import { AgentOrchestrator } from './harness-patterns';

export async function POST(request: Request) {
  const { message } = await request.json();
  const orchestrator = new AgentOrchestrator();
  const result = await orchestrator.processMessage(message);
  return Response.json(result);
}

// Client-side
const response = await fetch('/api/agent', {
  method: 'POST',
  body: JSON.stringify({ message: 'Show me all nodes' })
});
const { response: text, telemetry } = await response.json();
```

---

## Usage Example

```typescript
import { AgentOrchestrator } from './harness-patterns';

// Server-side only
const agent = new AgentOrchestrator();

// Process message - returns response + telemetry
const result = await agent.processMessage("Show me all Person nodes");
console.log(result.response);        // User-facing text
console.log(result.telemetry);       // { totalDuration_ms, turnsUsed, toolCalls, exitReason }

// Handle approval flow
if (result.needsApproval) {
  const approved = await agent.approveOperation();
  console.log(approved.response);
}
```
