# Harness Patterns API Reference

Complete API documentation for the harness-patterns framework.

---

## Types

### UnifiedContext

Source of truth for session state.

```typescript
interface UnifiedContext<T> {
  sessionId: string           // Unique session identifier
  createdAt: number           // Unix timestamp
  events: ContextEvent[]      // Full event stream
  status: CtxStatus           // Current execution state
  error?: string              // Error message if status === 'error'
  data: T                     // Accumulated pattern data
  input: string               // Current user input
}

type CtxStatus = 'running' | 'paused' | 'done' | 'error'
```

### ContextEvent

Events tagged with pattern origin.

```typescript
interface ContextEvent {
  type: EventType
  ts: number                  // Unix timestamp
  patternId: string           // Which pattern emitted this event
  data: unknown               // Event-specific payload
}

type EventType =
  | 'user_message'            // User input
  | 'assistant_message'       // AI response
  | 'tool_call'               // Tool invocation
  | 'tool_result'             // Tool response
  | 'controller_action'       // BAML controller decision
  | 'critic_result'           // BAML critic evaluation
  | 'pattern_enter'           // Pattern started
  | 'pattern_exit'            // Pattern completed
  | 'approval_request'        // Awaiting user approval
  | 'approval_response'       // User approved/rejected
  | 'error'                   // Error occurred
```

### PatternScope

Isolated workspace for pattern execution.

```typescript
interface PatternScope<T> {
  id: string                  // Pattern instance ID
  events: ContextEvent[]      // Local events (uncommitted)
  data: T                     // Local data
  startTime: number           // Execution start time
}
```

### ConfiguredPattern

Pattern with configuration metadata.

```typescript
interface ConfiguredPattern<T> {
  name: string                // Pattern type name
  fn: ScopedPattern<T>        // Pattern function
  config: ResolvedConfig      // Resolved configuration
}

type ScopedPattern<T> = (
  scope: PatternScope<T>,
  view: EventView
) => Promise<PatternScope<T>>
```

### ControllerAction

Standardized output from BAML controller functions.

```typescript
interface ControllerAction {
  reasoning: string           // Chain-of-thought explanation
  tool_name: string           // Tool to call, or 'Return' to exit
  tool_args: string           // JSON-encoded tool arguments
  status: string              // User-facing status message
  is_final: boolean           // True to exit the loop
}
```

### CriticResult

Output from BAML critic functions.

```typescript
interface CriticResult {
  is_sufficient: boolean      // Whether result meets criteria
  explanation: string         // Why/why not sufficient
  suggested_approach?: string // Improvement suggestion
}
```

---

## Pattern Functions

### simpleLoop

ReAct-style decide-execute loop.

```typescript
function simpleLoop<T>(
  controller: ControllerFn,
  tools: string[],
  config?: SimpleLoopConfig
): ConfiguredPattern<T>
```

**Parameters:**
- `controller` - BAML controller function (use `.bind(b)`)
- `tools` - Allowed tool names
- `config` - Optional configuration

**Config:**
```typescript
interface SimpleLoopConfig extends PatternConfig {
  schema?: string             // Injected to controller (5th param)
  maxTurns?: number           // Max iterations (default: 5)
}
```

**Example:**
```typescript
simpleLoop(b.Neo4jController.bind(b), ['read_neo4j_cypher'], {
  patternId: 'neo4j-query',
  schema: graphSchema,
  maxTurns: 5
})
```

### actorCritic

Generate-evaluate loop with retry logic.

```typescript
function actorCritic<T>(
  actor: ControllerFn,
  critic: CriticFn,
  tools: string[],
  config?: ActorCriticConfig
): ConfiguredPattern<T>
```

**Parameters:**
- `actor` - BAML controller function
- `critic` - BAML critic function
- `tools` - Allowed tool names
- `config` - Optional configuration

**Config:**
```typescript
interface ActorCriticConfig extends PatternConfig {
  maxRetries?: number         // Max retry attempts (default: 3)
}
```

**Example:**
```typescript
actorCritic(
  b.CodeModeController.bind(b),
  b.CodeModeCritic.bind(b),
  tools.all,
  { patternId: 'code-mode', maxRetries: 3 }
)
```

### withApproval

Wrap pattern to pause for user approval.

```typescript
function withApproval<T>(
  pattern: ConfiguredPattern<T>,
  predicate: ApprovalPredicate,
  config?: PatternConfig
): ConfiguredPattern<T>

type ApprovalPredicate = (action: ControllerAction) => boolean
```

**Built-in predicates:**
```typescript
approvalPredicates.writes     // tool_name includes 'write'
approvalPredicates.deletes    // tool_name includes 'delete'
approvalPredicates.mutations  // write, delete, create, update, insert, remove
```

**Example:**
```typescript
withApproval(
  simpleLoop(b.Neo4jController.bind(b), tools.neo4j),
  approvalPredicates.writes
)
```

### synthesizer

Generate human-readable response from pattern output.

```typescript
function synthesizer<T>(
  config: SynthesizerConfig
): ConfiguredPattern<T>

interface SynthesizerConfig extends PatternConfig {
  mode: 'message' | 'response' | 'thread'
  synthesize?: SynthesisFn    // Custom function
  skipIfHasResponse?: boolean // Skip if response exists
}
```

**Modes:**
- `message` - Receives only the response string
- `response` - Receives `{ data, response }` object
- `thread` - Receives full loop history for rich context

**Example:**
```typescript
synthesizer({
  mode: 'thread',
  patternId: 'response-synth'
})
```

### router

Route to patterns based on intent classification.

```typescript
function router<T>(
  routes: Routes,
  patterns: RoutePatterns<T>,
  config?: PatternConfig
): ConfiguredPattern<T>

type Routes = Record<string, string>  // name -> description
type RoutePatterns<T> = Record<string, ConfiguredPattern<T>>
```

**Example:**
```typescript
router(
  {
    neo4j: 'Database queries and graph operations',
    web_search: 'Web lookups and information retrieval'
  },
  {
    neo4j: neo4jPattern,
    web_search: webPattern
  }
)
```

### chain

Sequential pattern composition.

```typescript
async function chain<T>(
  ctx: UnifiedContext<T>,
  patterns: ConfiguredPattern<T>[]
): Promise<UnifiedContext<T>>
```

**Example:**
```typescript
await chain(ctx, [routerPattern, synthesizerPattern])
```

---

## Harness Functions

### harness

Create callable agent from patterns.

```typescript
function harness<T>(
  ...patterns: ConfiguredPattern<T>[]
): (input: string, sessionId?: string, initialData?: Partial<T>) => Promise<HarnessResultScoped<T>>

interface HarnessResultScoped<T> {
  response: string            // Final response text
  data: T                     // Accumulated data
  status: CtxStatus           // Final status
  duration_ms: number         // Execution time
  context: UnifiedContext<T>  // Full context
  serialized: string          // JSON for persistence
}
```

**Example:**
```typescript
const agent = harness(routerPattern, synthesizerPattern)
const result = await agent('Show me all nodes', 'session-123')
```

### resumeHarness

Resume paused harness after approval.

```typescript
async function resumeHarness<T>(
  serializedContext: string,
  patterns: ConfiguredPattern<T>[],
  approved: boolean
): Promise<HarnessResultScoped<T>>
```

**Example:**
```typescript
const result = await resumeHarness(serialized, patterns, true)
```

### continueSession

Continue session with new input.

```typescript
async function continueSession<T>(
  serializedContext: string,
  patterns: ConfiguredPattern<T>[],
  newInput: string
): Promise<HarnessResultScoped<T>>
```

**Example:**
```typescript
const result = await continueSession(serialized, patterns, 'Follow-up question')
```

---

## Tools

### Tools

Fetch and group MCP tools.

```typescript
async function Tools(): Promise<ToolSet>

interface ToolSet {
  neo4j?: string[]            // Neo4j tools
  web?: string[]              // Web search/fetch tools
  all: string[]               // All available tools
  [namespace: string]: string[] | undefined
}
```

### callTool

Execute MCP tool.

```typescript
async function callTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolCallResult>

interface ToolCallResult {
  success: boolean
  data: unknown
  error?: string
}
```

### listTools

List available MCP tools.

```typescript
async function listTools(): Promise<MCPToolDescription[]>

interface MCPToolDescription {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
```

---

## EventView API

Fluent API for querying events.

```typescript
function createEventView<T>(ctx: UnifiedContext<T>): EventView

interface EventView {
  // Pattern selectors
  fromPattern(id: string): EventView
  fromPatterns(ids: string[]): EventView
  fromLastPattern(): EventView
  fromAll(): EventView

  // Type selectors
  ofType(type: EventType): EventView
  ofTypes(types: EventType[]): EventView
  tools(): EventView          // tool_call + tool_result
  messages(): EventView       // user_message + assistant_message
  actions(): EventView        // controller_action

  // Quantity selectors
  last(n: number): EventView
  first(n: number): EventView
  since(ts: number): EventView

  // Execution
  get(): ContextEvent[]
  serialize(): string         // XML format for LLM
  exists(): boolean
  count(): number
}
```

---

## Configuration

### PatternConfig

Base configuration for all patterns.

```typescript
interface PatternConfig {
  patternId?: string          // Explicit pattern ID
  commitStrategy?: CommitStrategy
  trackHistory?: TrackHistory
  viewConfig?: ViewConfig
}

type CommitStrategy =
  | 'always'                  // Commit all tracked events
  | 'on-success'              // Commit only if no error
  | 'last'                    // Commit only final event
  | 'never'                   // Discard all (dry-run)

type TrackHistory =
  | boolean                   // true = all, false = none
  | EventType                 // Single type
  | EventType[]               // Multiple types
```

### Pattern Defaults

| Pattern | trackHistory | commitStrategy |
|---------|-------------|----------------|
| simpleLoop | `'tool_result'` | `'on-success'` |
| actorCritic | `'tool_result'` | `'on-success'` |
| synthesizer | `'assistant_message'` | `'always'` |

---

## Context Helpers

```typescript
// Create new context
function createContext<T>(
  input: string,
  initialData?: T,
  sessionId?: string
): UnifiedContext<T>

// Serialize/deserialize for persistence
function serializeContext<T>(ctx: UnifiedContext<T>): string
function deserializeContext<T>(json: string): UnifiedContext<T>

// Status setters
function setError<T>(ctx: UnifiedContext<T>, error: string, patternId: string): void
function setDone<T>(ctx: UnifiedContext<T>): void
function setPaused<T>(ctx: UnifiedContext<T>): void
```
