# Harness Patterns

A functional, composable framework for building agentic tool execution pipelines.

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [Pattern Types](#pattern-types)
- [Example Agents](#example-agents)
- [API Reference](./api.md)
- [Frontend Integration](./frontend.md)

## Overview

Harness Patterns provides a declarative way to compose AI agent behaviors. Instead of writing imperative control flow, you declare patterns that describe how an agent should behave, then compose them into pipelines.

```typescript
const agent = harness(
  router(routes, patterns),   // Route to appropriate handler
  synthesizer({ mode: 'thread' }) // Generate human response
)

const result = await agent('Show me all users', sessionId)
```

## Core Concepts

### Patterns

Patterns are the building blocks. Each pattern:
- Takes a `PatternScope` (isolated workspace)
- Has access to `EventView` (query past events)
- Returns modified scope with new events

```typescript
type ScopedPattern<T> = (
  scope: PatternScope<T>,
  view: EventView
) => Promise<PatternScope<T>>
```

### UnifiedContext

The source of truth for session state:

```typescript
interface UnifiedContext<T> {
  sessionId: string
  events: ContextEvent[]
  status: 'running' | 'paused' | 'done' | 'error'
  data: T
  input: string
}
```

### EventView

Fluent API for querying events:

```typescript
view.fromLastPattern()    // Events from previous pattern
    .tools()               // Filter to tool calls/results
    .last(3)               // Last 3 events
    .get()                 // Execute query
```

## Pattern Types

### simpleLoop

ReAct-style decide-execute loop. A controller decides which tool to call, the tool executes, repeat until done.

```typescript
simpleLoop(controller, tools, { maxTurns: 5 })
```

### actorCritic

Generate-evaluate loop with retry logic. Actor generates, critic evaluates, retry if insufficient.

```typescript
actorCritic(actor, critic, tools, { maxRetries: 3 })
```

### router

Intent-based routing to sub-patterns.

```typescript
router(
  { neo4j: 'Database queries', web: 'Web lookups' },
  { neo4j: neo4jPattern, web: webPattern }
)
```

### synthesizer

Generate human-readable response from pattern output.

```typescript
synthesizer({ mode: 'thread' }) // Full iteration history
synthesizer({ mode: 'response' }) // Data + response
synthesizer({ mode: 'message' }) // Response only
```

### withApproval

Wrap pattern to pause for user approval on sensitive operations.

```typescript
withApproval(pattern, approvalPredicates.mutations)
```

### parallel

Execute patterns concurrently.

```typescript
parallel([pattern1, pattern2, pattern3])
```

### judge

Evaluate and rank outputs from parallel patterns.

```typescript
judge(evaluatorFn, { patternId: 'quality-judge' })
```

### guardrail

Wrap pattern with validation rails.

```typescript
guardrail(pattern, {
  rails: [piiScanRail, pathAllowlistRail],
  circuitBreaker: { maxFailures: 3 }
})
```

### hook

Background execution on triggers.

```typescript
hook(pattern, { trigger: 'session_close', background: true })
```

### chain

Sequential pattern composition (implicit in harness).

```typescript
chain(ctx, [pattern1, pattern2, pattern3])
```

## Example Agents

See [examples.md](./examples.md) for complete implementations of:

1. **Default Agent** - Router with Neo4j, Web Search, Code Mode
2. **Knowledge Graph Builder** - Research → Extract → Persist pipeline
3. **Documentation Assistant** - Context7 lookup with memory persistence
4. **Multi-Source Research** - Parallel search with quality ranking
5. **LLM-as-Judge** - Multi-source with sophisticated evaluation
6. **Guardrailed File Editor** - 5-layer validation for file operations
7. **Conversational Memory** - Scratchpad with KB distillation
8. **Issue Triage** - GitHub issue analysis and labeling
9. **Ontology Builder** - Schema extraction and evolution
10. **Semantic Cache** - Redis-backed response caching

## Quick Start

```typescript
import {
  harness,
  simpleLoop,
  synthesizer,
  Tools,
  createNeo4jController
} from '~/lib/harness-patterns'

async function createAgent() {
  const tools = await Tools()

  const queryPattern = simpleLoop(
    createNeo4jController(tools.neo4j ?? []),
    tools.neo4j ?? [],
    { patternId: 'neo4j-query' }
  )

  const responseSynth = synthesizer({
    mode: 'thread',
    patternId: 'response-synth'
  })

  return harness(queryPattern, responseSynth)
}

// Usage
const agent = await createAgent()
const result = await agent('Show me all Person nodes', 'session-123')
console.log(result.response)
```
