# Harness Patterns

Functional, composable framework for agentic tool execution.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Concepts](#core-concepts)
- [UnifiedContext Architecture](#unifiedcontext-architecture)
  - [Core Types](#core-types)
  - [BAML Types](#baml-types)
- [Context Flow](#context-flow)
  - [Key Insight: Scope Isolation](#key-insight-scope-isolation)
  - [Session Persistence](#session-persistence)
- [API Reference](#api-reference)
  - [Tools()](#tools)
  - [simpleLoop()](#simpleloopcontroller-tools-config)
  - [actorCritic()](#actorcriticactor-critic-tools-config)
  - [withApproval()](#withapprovalpattern-predicate)
  - [synthesizer()](#synthesizerconfig)
  - [router()](#routerroutes-patterns)
  - [chain()](#chainctx-patterns)
  - [harness()](#harnesspatterns)
  - [resumeHarness()](#resumeharnessserialized-patterns-approved)
  - [continueSession()](#continuesessionserialized-patterns-newinput)
- [EventView Query API](#eventview-query-api)
- [Configuration System](#configuration-system)
  - [ViewConfig Options](#viewconfig-options)
- [Event → BAML Type Mapping](#event--baml-type-mapping)
  - [Harness EventType → BAML Input Type](#harness-eventtype--baml-input-type)
  - [Per-Pattern: Events Read → BAML Inputs → BAML Return](#per-pattern-events-read--baml-inputs--baml-return)
  - [Conversion Reference](#conversion-reference)
- [Full Example](#full-example)
- [OpenTelemetry](#opentelemetry)
- [File Structure](#file-structure)
- [Design Principles](#design-principles)

## Architecture Overview

```
BAML Functions ──┐
                 ├──► Patterns ──► Router ──► Harness ──► Agent
MCP Tools ───────┘
```

**Key Principle**: BAML functions are passed directly to patterns. No intermediate wrappers needed.

## Core Concepts

```typescript
// BAML functions are passed directly to patterns (bind to preserve 'this' context)
simpleLoop(b.Neo4jController.bind(b), tools.neo4j, { schema })
actorCritic(b.CodeModeController.bind(b), b.CodeModeCritic.bind(b), tools.all)

// Patterns compose into routers
router(routes, { neo4j: pattern1, web: pattern2 })

// Harness chains patterns and executes them
harness(router(...), synthesizer({ mode: 'thread' }))
```

## UnifiedContext Architecture

The framework uses **UnifiedContext** as the single source of truth for session state:

- **Session Persistence** - Serialize/deserialize full session state
- **Pattern Isolation** - Each pattern works in isolated scope, commits on completion
- **Flexible Event Querying** - Select events by pattern, type, recency via `EventView`

### Core Types

```typescript
// Source of truth for session state
interface UnifiedContext<T> {
  sessionId: string
  createdAt: number
  events: ContextEvent[]      // Full event stream
  status: CtxStatus           // 'running' | 'paused' | 'done' | 'error'
  error?: string
  data: T                     // Accumulated pattern data
  input: string               // Current user input
}

// Events tagged with pattern origin
interface ContextEvent {
  type: EventType
  ts: number
  patternId: string
  data: unknown
}

type EventType =
  | 'user_message' | 'assistant_message'
  | 'tool_call' | 'tool_result'
  | 'controller_action' | 'critic_result'
  | 'pattern_enter' | 'pattern_exit'
  | 'approval_request' | 'approval_response'
  | 'error'

// Isolated workspace for each pattern
interface PatternScope<T> {
  id: string
  events: ContextEvent[]      // Local events (not yet committed)
  data: T
  startTime: number
}

// Pattern function signature
type ScopedPattern<T> = (scope: PatternScope<T>, view: EventView) => Promise<PatternScope<T>>

// ConfiguredPattern wraps pattern with metadata
interface ConfiguredPattern<T> {
  name: string
  fn: ScopedPattern<T>
  config: ResolvedConfig
}
```

### BAML Types

```typescript
// Controller output (standardized across all BAML controllers)
interface ControllerAction {
  reasoning: string      // Chain-of-thought
  tool_name: string      // Tool to call or 'Return'
  tool_args: string      // JSON payload
  status: string         // User-facing message
  is_final: boolean      // Exit loop flag
}

// Critic result for actor-critic pattern
interface CriticResult {
  is_sufficient: boolean
  explanation: string
  suggested_approach?: string
}
```

## Context Flow

How UnifiedContext flows through the system:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UnifiedContext                                 │
│  sessionId, createdAt, status, input, data: T, events: ContextEvent[]  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  harness(pattern1, pattern2, ...)                                       │
│    1. createContext(input, initialData, sessionId)                      │
│    2. Adds 'user_message' event                                         │
│    3. Calls chain(ctx, patterns)                                        │
│    4. Adds 'assistant_message' event on done                            │
│    5. Returns { response, context, serialized }                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  chain(ctx, patterns)  ─── for each pattern:                            │
│                                                                         │
│    ┌──────────────────────────────────────────────────────────────┐    │
│    │  1. createScope(patternId, data)  ← isolated workspace        │    │
│    │  2. createEventView(ctx, viewConfig)  ← read-only view        │    │
│    │  3. enterPattern() → adds 'pattern_enter' event               │    │
│    │  4. pattern.fn(scope, view) → pattern writes to scope.events  │    │
│    │  5. commitEvents(ctx, scope, strategy) → merge to ctx.events  │    │
│    │  6. exitPattern() → adds 'pattern_exit' event                 │    │
│    │  7. currentData = scope.data  ← forward data to next pattern  │    │
│    └──────────────────────────────────────────────────────────────┘    │
│                                                                         │
│    Stops early if ctx.status !== 'running'                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Insight: Scope Isolation

**Patterns write to scope, never directly to context.** This enables:

- **Rollback on error** - If a pattern fails, its events aren't committed
- **Configurable commit strategies** - Control when/what gets persisted
- **Clean separation** - Each pattern has its own workspace

### Session Persistence

The entire event stream persists, enabling multi-turn conversations:

```typescript
// End of turn → serialize
const result = await agent('query')
store(result.serialized)  // JSON string of full context

// Next turn → continue
const continued = await continueSession(serialized, patterns, 'follow-up')

// After approval → resume
const resumed = await resumeHarness(serialized, patterns, true)
```

## API Reference

### `Tools()`

Fetch MCP tools and group by server namespace.

```typescript
const tools = await Tools()
tools.neo4j  // ['read_neo4j_cypher', 'write_neo4j_cypher', 'get_neo4j_schema']
tools.web    // ['search', 'fetch', 'fetch_content']
tools.all    // all tool names
```

### `simpleLoop(controller, tools, config?)`

ReAct-style decide-execute loop. Calls BAML controller directly.

```typescript
simpleLoop(b.Neo4jController.bind(b), tools.neo4j, {
  patternId: 'neo4j-query',
  schema,
  maxTurns: 5
})

interface SimpleLoopConfig extends PatternConfig {
  schema?: string       // Injected as 5th param to controller
  maxTurns?: number     // Default: 5
}
```

**How it works:**
1. Extract params from context: `input`, `intent`, `previous_results`, `turn`
2. Call BAML controller with extracted params (+ optional schema)
3. Execute returned tool via MCP
4. Loop until `is_final` or max turns

### `actorCritic(actor, critic, tools, config?)`

Generate-evaluate loop with retry. For code mode workflows.

```typescript
actorCritic(b.CodeModeController.bind(b), b.CodeModeCritic.bind(b), tools.all, {
  patternId: 'code-mode',
  maxRetries: 3
})

interface ActorCriticConfig extends PatternConfig {
  maxRetries?: number   // Default: 3
}
```

**How it works:**
1. Actor generates script/action
2. Execute via MCP
3. Critic evaluates result
4. Retry with feedback if insufficient
5. Exit when sufficient or max retries

### `withApproval(pattern, predicate)`

Wrap pattern to pause for user approval on matching actions.

```typescript
withApproval(
  simpleLoop(b.Neo4jController.bind(b), tools.neo4j, { schema }),
  approvalPredicates.writes
)

// Built-in predicates
approvalPredicates.writes     // tool_name includes 'write'
approvalPredicates.deletes    // tool_name includes 'delete'
approvalPredicates.mutations  // write, delete, create, update, insert, remove
```

### `synthesizer(config)`

Synthesizes final response from previous pattern's output using BAML `CreateToolResponse`.

```typescript
synthesizer({ mode: 'thread', patternId: 'response-synth' })

// Three modes
synthesizer({ mode: 'message' })   // Receives only response string
synthesizer({ mode: 'response' })  // Receives { data, response } object
synthesizer({ mode: 'thread' })    // Receives full loop history

// Custom synthesis function
synthesizer({
  mode: 'response',
  synthesize: async (input) => `Found: ${input.response}`
})
```

### `router(routes, patterns)`

Route input to patterns based on intent classification via BAML.

```typescript
const routes = {
  neo4j: 'Database queries and graph operations',
  web_search: 'Web lookups and information retrieval',
  code_mode: 'Multi-tool script composition'
}

router(routes, {
  neo4j: neo4jPattern,
  web_search: webPattern,
  code_mode: codePattern
})
```

### `chain(ctx, patterns)`

Sequential composition of patterns within a UnifiedContext.

```typescript
await chain(ctx, [pattern1, pattern2, pattern3])
```

### `harness(...patterns)`

Compose patterns into a callable agent.

```typescript
const agent = harness(routerPattern, synthesizerPattern)
const result = await agent('Show me all Person nodes', sessionId)

interface HarnessResultScoped<T> {
  response: string
  data: T
  status: 'running' | 'paused' | 'done' | 'error'
  duration_ms: number
  context: UnifiedContext<T>
  serialized: string  // JSON for session persistence
}
```

### `resumeHarness(serialized, patterns, approved)`

Resume a paused harness after approval/rejection.

```typescript
const resumed = await resumeHarness(serializedContext, patterns, true)
```

### `continueSession(serialized, patterns, newInput)`

Continue a session with new user input.

```typescript
const continued = await continueSession(serializedContext, patterns, 'Follow-up question')
```

## EventView Query API

Fluent API for filtering events from UnifiedContext:

```typescript
const view = createEventView(ctx)

// Pattern selectors
view.fromPattern('neo4j-query')
view.fromPatterns(['neo4j-query', 'web-enrich'])
view.fromLastPattern()
view.fromAll()

// Type selectors
view.ofType('tool_result')
view.ofTypes(['tool_call', 'tool_result'])
view.tools()      // Shorthand: tool_call + tool_result
view.messages()   // Shorthand: user_message + assistant_message
view.actions()    // Shorthand: controller_action

// Quantity selectors
view.last(5)
view.first(3)
view.since(timestamp)

// Execution
view.get()        // ContextEvent[]
view.serialize()  // XML format for LLM
view.exists()     // boolean
view.count()      // number
```

## Configuration System

Two orthogonal configuration axes:

| Axis | Controls | Options |
|------|----------|---------|
| **commitStrategy** | *When* to commit | `'always'`, `'on-success'`, `'last'`, `'never'` |
| **trackHistory** | *What types* to track | `true`, `false`, `EventType`, or `EventType[]` |

```typescript
interface PatternConfig {
  patternId?: string
  commitStrategy?: CommitStrategy
  trackHistory?: TrackHistory
  viewConfig?: ViewConfig
}
```

### ViewConfig Options

Controls what events a pattern can "see" via its EventView:

```typescript
interface ViewConfig {
  fromPatterns?: string[]   // Specific pattern IDs to read from
  fromLastN?: number        // Last N patterns
  fromLast?: boolean        // Only previous pattern (default: true)
  eventTypes?: EventType[]  // Filter by event type
  limit?: number            // Max events to include
}
```

| Option | Effect | Example |
|--------|--------|---------|
| `fromLast: true` | See only the previous pattern's events | Default behavior |
| `fromPatterns: ['neo4j']` | See events from specific pattern(s) | Cross-pattern queries |
| `fromLastN: 3` | See events from last 3 patterns | Broader context |
| `eventTypes: ['tool_result']` | Filter to specific event types | Focus on results |
| `limit: 10` | Cap number of events returned | Limit context size |

```typescript
// Example: synthesizer needs to see tool results from neo4j pattern
synthesizer({
  mode: 'thread',
  viewConfig: { fromPatterns: ['neo4j-query'], eventTypes: ['tool_result'] }
})
```

**Defaults by pattern:**
- `simpleLoop`: `trackHistory: 'tool_result'`, `commitStrategy: 'on-success'`
- `actorCritic`: `trackHistory: 'tool_result'`, `commitStrategy: 'on-success'`
- `synthesizer`: `trackHistory: 'assistant_message'`, `commitStrategy: 'always'`

## Event → BAML Type Mapping

Each BAML function receives a projection of the UnifiedContext event stream,
transformed into prompt-friendly types. The table below shows which harness
`EventType` values feed into which BAML input types for each pattern.

### Harness EventType → BAML Input Type

| Harness `EventType` | Event Payload (TS) | BAML Type | Consumed By |
|---|---|---|---|
| `tool_call` | `ToolCallEventData` | `ToolCall` | `LoopTurn.tool_call`, `Attempt.action` |
| `tool_result` | `ToolResultEventData` | `ToolResult` | `LoopTurn.tool_result`, `Attempt.result/error` |
| `controller_action` | `ControllerActionEventData` | _(embedded in `LoopTurn.reasoning`)_ | simpleLoop, actorCritic |
| `critic_result` | `CriticResultEventData` | _(embedded in `Attempt.feedback`)_ | actorCritic |
| `user_message` | `UserMessageEventData` | `Message { role, content }` | router (history) |
| `assistant_message` | `AssistantMessageEventData` | `Message { role, content }` | router (history) |
| `pattern_enter` | `PatternEnterEventData` | _(not sent to BAML)_ | chain orchestration only |
| `pattern_exit` | `PatternExitEventData` | _(not sent to BAML)_ | chain orchestration only |
| `approval_request` | `ApprovalRequestEventData` | _(not sent to BAML)_ | withApproval only |
| `approval_response` | `ApprovalResponseEventData` | _(not sent to BAML)_ | withApproval only |
| `error` | `ErrorEventData` | _(not sent to BAML)_ | harness error handling |

### Per-Pattern: Events Read → BAML Inputs → BAML Return

#### simpleLoop → `LoopController`

```
Events read (ViewConfig default: fromLast, trackHistory: 'tool_result')
├── controller_action  ──► LoopTurn.reasoning
├── tool_call          ──► LoopTurn.tool_call { tool, args }
└── tool_result        ──► LoopTurn.tool_result { tool, result, success, error }

BAML Inputs:
  user_message : string           ← ctx.input
  intent       : string           ← extracted from routing or ctx.input
  tools        : ToolDescription[]← MCP listTools() → { name, description, args_schema }
  turns        : LoopTurn[]       ← assembled from scope events per turn
  context      : string?          ← optional (e.g. neo4j schema)

BAML Return → ControllerAction:
  reasoning : string    → stored as controller_action event
  tool_name : string    → drives tool_call event
  tool_args : string    → passed to MCP callTool()
  status    : string    → user-facing status
  is_final  : bool      → terminates loop
```

#### actorCritic → `ActorController` + `Critic`

```
Events read (ViewConfig default: fromLast, trackHistory: 'tool_result')
├── controller_action  ──► Attempt.action (full ControllerAction)
├── tool_result        ──► Attempt.result / Attempt.error
└── critic_result      ──► Attempt.feedback

BAML Inputs (ActorController):
  user_message : string           ← ctx.input
  intent       : string           ← extracted from routing or ctx.input
  tools        : ToolDescription[]← MCP listTools()
  attempts     : Attempt[]        ← assembled from scope events per attempt

BAML Return → ControllerAction (same as simpleLoop)

BAML Inputs (Critic):
  intent   : string      ← same intent
  attempts : Attempt[]   ← same assembled attempts

BAML Return → CriticResult:
  is_sufficient      : bool    → if true, exits retry loop
  explanation        : string  → logged
  suggested_approach : string? → forwarded as next Attempt.feedback
```

#### synthesizer → `Synthesize`

```
Events read (ViewConfig: typically fromPatterns or fromLast)
├── tool_call    ──► LoopTurn.tool_call
└── tool_result  ──► LoopTurn.tool_result

BAML Inputs:
  user_message : string       ← ctx.input
  intent       : string       ← from data or ctx.input
  turns        : LoopTurn[]   ← assembled from preceding pattern events

BAML Return → string (assistant response text)
  → stored as assistant_message event
```

#### router → `Router`

```
Events read (ViewConfig default: fromAll, eventTypes: user_message + assistant_message)
├── user_message      ──► Message { role: 'user', content }
└── assistant_message ──► Message { role: 'assistant', content }

BAML Inputs:
  message : string         ← ctx.input
  routes  : RouteOption[]  ← { name, description } from route config
  history : Message[]      ← assembled from context message events

BAML Return → RoutingResult:
  intent     : string  → stored in data, forwarded to routed pattern
  needs_tool : bool    → if false, response is returned directly
  route      : string? → selects which ConfiguredPattern to run
  response   : string  → immediate response or status
```

### Conversion Reference

The pattern implementation must convert between harness events and BAML types.
Here are the field mappings:

```typescript
// ContextEvent (tool_call) → BAML ToolCall
{ tool: (event.data as ToolCallEventData).tool,
  args: JSON.stringify((event.data as ToolCallEventData).args) }

// ContextEvent (tool_result) → BAML ToolResult
{ tool:    (event.data as ToolResultEventData).tool,
  result:  JSON.stringify((event.data as ToolResultEventData).result),
  success: (event.data as ToolResultEventData).success,
  error:   (event.data as ToolResultEventData).error ?? null }

// MCPToolDescription → BAML ToolDescription
{ name:        mcp.name,
  description: mcp.description ?? '',
  args_schema: mcp.inputSchema ? JSON.stringify(mcp.inputSchema) : null }

// ContextEvent (user/assistant_message) → BAML Message
{ role:    event.type === 'user_message' ? 'user' : 'assistant',
  content: (event.data as UserMessageEventData | AssistantMessageEventData).content }
```

## Full Example

```typescript
import { b } from '../../../baml_client'
import {
  harness,
  router,
  simpleLoop,
  actorCritic,
  synthesizer,
  withApproval,
  approvalPredicates,
  Tools,
  callTool
} from '../harness-patterns'

async function getSchema(): Promise<string> {
  const result = await callTool('get_neo4j_schema', {})
  return result.success ? JSON.stringify(result.data) : ''
}

async function createPatterns() {
  const tools = await Tools()
  const schema = await getSchema()

  // Bind BAML methods to preserve 'this' context
  const neo4jController = b.Neo4jController.bind(b)
  const webController = b.WebSearchController.bind(b)
  const codeController = b.CodeModeController.bind(b)
  const codeCritic = b.CodeModeCritic.bind(b)

  const neo4jPattern = withApproval(
    simpleLoop(neo4jController, tools.neo4j ?? [], {
      patternId: 'neo4j-query',
      schema
    }),
    approvalPredicates.writes
  )

  const webPattern = simpleLoop(webController, tools.web ?? [], {
    patternId: 'web-search'
  })

  const codePattern = actorCritic(codeController, codeCritic, tools.all, {
    patternId: 'code-mode'
  })

  const routerPattern = router(
    {
      neo4j: 'Database queries and graph operations',
      web_search: 'Web lookups and information retrieval',
      code_mode: 'Multi-tool script composition'
    },
    {
      neo4j: neo4jPattern,
      web_search: webPattern,
      code_mode: codePattern
    }
  )

  const responseSynth = synthesizer({
    mode: 'thread',
    patternId: 'response-synth'
  })

  return [routerPattern, responseSynth]
}

// Usage
const patterns = await createPatterns()
const agent = harness(...patterns)
const result = await agent('Show me all Person nodes', 'session-123')
```

## OpenTelemetry

All patterns include built-in OTel tracing with `CompactSpanExporter`:

```
[router] → neo4j (intent: "Query graph data")
[simpleLoop] neo4j-query ✓ (1234ms)
  [tool] read_neo4j_cypher ✓ (456ms)
[harness] Session cl-3 completed in 1500ms
```

Span names:
- `harness.run` - Top-level span
- `harness.resume` - Resume from paused state
- `harness.continue` - Continue session with new input
- `router` - Intent classification
- `pattern.simpleLoop` - Decide-execute loop
- `pattern.actorCritic` - Generate-evaluate loop
- `pattern.withApproval` - Approval flow
- `pattern.chain` - Sequential composition
- `pattern.synthesizer` - Response synthesis
- `controller` / `actor` / `critic` - BAML function calls
- `tool.call` - MCP tool execution

## File Structure

```
harness-patterns/
├── index.ts              # Public exports
├── types.ts              # Core types (UnifiedContext, PatternScope, etc.)
├── context.server.ts     # Context factory and helpers
├── tools.server.ts       # Tools() wrapper
├── router.server.ts      # router()
├── harness.server.ts     # harness(), resumeHarness(), continueSession()
├── patterns/
│   ├── index.ts
│   ├── simpleLoop.server.ts
│   ├── actorCritic.server.ts
│   ├── withApproval.server.ts
│   ├── chain.server.ts
│   ├── synthesizer.server.ts
│   └── event-view.server.ts  # EventViewImpl
├── state.server.ts       # Thread (conversation history)
├── mcp-client.server.ts  # callTool(), listTools()
├── routing.server.ts     # BAML router integration
└── assert.server.ts      # Server-only guards
```

## Design Principles

1. **BAML functions are first-class** - Pass them directly to patterns (use `.bind()`)
2. **Patterns extract params** - Patterns pull data from context and call BAML
3. **Config injects metadata** - Optional config for things like schema injection
4. **OTel is built-in** - Tracing in patterns, not in adapters
5. **Server-only enforcement** - `.server.ts` files with runtime guards
6. **Session persistence** - Full context serializable for multi-turn conversations
