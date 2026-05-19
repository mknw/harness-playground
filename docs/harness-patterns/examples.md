# Harness Pattern Examples

Catalog of 10 pre-built agents demonstrating pattern compositions.

> **Full Code:** See [`ui/src/lib/harness-client/examples/`](../../ui/src/lib/harness-client/examples/) for complete implementations.

---

## Agent Registry

All agents are registered in `registry.server.ts` and available via `getAgentList()`.

| ID | Name | Patterns | Servers |
|----|------|----------|---------|
| `default` | Default Agent | router → synthesizer | neo4j, web_search, fetch |
| `doc-assistant` | Documentation Assistant | simpleLoop → simpleLoop → synthesizer | context7, memory |
| `multi-source-research` | Multi-Source Research | parallel → judge → synthesizer | web_search, github, context7 |
| `llm-judge` | LLM-as-Judge | parallel → judge → synthesizer | web_search, github, context7 |
| `guardrailed-agent` | Guardrailed File Editor | guardrail(actorCritic + withApproval) → synthesizer | filesystem |
| `conversational-memory` | Conversational Memory | sessionTracker → router → memoryWriter → synthesizer | memory, neo4j, web_search, redis |
| `issue-triage` | Issue Triage | router(parallel \| simpleLoop) → synthesizer | github, web_search, neo4j |
| `kg-builder` | Knowledge Graph Builder | simpleLoop → simpleLoop → withApproval(simpleLoop) → synthesizer | web_search, memory, neo4j |
| `ontology-builder` | Ontology Builder | 8-phase pipeline | all servers |
| `semantic-cache` | Semantic Cache | cache → parallel → cacheWriter → synthesizer | redis, web_search, neo4j |

---

## 1. Default Agent

**File:** `default.server.ts`

Router-based agent with Neo4j and Web Search routes. Each route is wrapped with `withReferences` so the inner pattern receives an LLM-curated set of relevant prior `tool_result` events from any earlier turn (subsumes #26 / #29 — see [`with-references.md`](with-references.md)).

```typescript
router({ neo4j: '...', web_search: '...' })
→ routes({
    neo4j:      withReferences(neo4jPattern, { scope: 'global' }),
    web_search: withReferences(webPattern,   { scope: 'global' })
  })
→ synthesizer({ mode: 'thread' })
```

- Neo4j queries (`read_neo4j_cypher`, `write_neo4j_cypher`, `get_neo4j_schema`)
- Web search via DuckDuckGo (`search`, `fetch`, `fetch_content`)
- Cross-turn data flow: `withReferences` selector attaches relevant prior refs at each route's ingress; the controller can use `expandPreviousResult` or pass `ref:<id>` in tool args to inline-expand the full data

For JS-orchestration workflows that span multiple servers, see [Agent 11 — Code Mode](#11-code-mode-agent).

---

## 2. Documentation Assistant

**File:** `doc-assistant.server.ts`

Look up library docs, persist findings.

```
simpleLoop(Context7Controller) → resolve-library-id, get-library-docs
simpleLoop(MemoryController)   → create_entities, add_observations
synthesizer({ mode: 'thread' })
```

---

## 3. Multi-Source Research

**File:** `multi-source-research.server.ts`

Concurrent search with quality ranking.

```
parallel([webSearch, githubSearch, docSearch])
judge(evaluator)  → score: content, relevance, authority
synthesizer({ mode: 'response' })
```

---

## 4. LLM-as-Judge

**File:** `llm-judge.server.ts`

Multi-criteria evaluation with weighted scoring.

```typescript
// 4 criteria: content length, relevance, source authority, structure
const score = contentScore + relevanceScore + authorityBonus + structureBonus
```

---

## 5. Guardrailed File Editor

**File:** `guardrailed-agent.server.ts`

5-layer validation for file operations.

```
guardrail(
  withApproval(actorCritic(FileEditController, FileEditCritic)),
  {
    rails: [topicalRail, piiScanRail, pathAllowlistRail, toolScopeRail, driftDetectorRail],
    circuitBreaker: { maxFailures: 3, windowMs: 60_000 }
  }
)
→ synthesizer
```

**Rails:**
- `topicalRail` - Block off-topic destructive requests
- `piiScanRail` - Redact secrets/tokens from input
- `pathAllowlistRail` - Block paths outside workspace
- `toolScopeRail` - Only allow filesystem tools
- `driftDetectorRail` - Warn if >60% of file changed

---

## 6. Conversational Memory

**File:** `conversational-memory.server.ts`

Memory scratchpad with KB distillation.

```
sessionTracker → hset/expire session metadata
router(neo4j | web_search)
memoryWriter   → persist key facts
synthesizer

+ hook(distillChain, { trigger: 'session_close', background: true })
  → read memory → distill → persist to neo4j → cleanup
```

---

## 7. Issue Triage

**File:** `issue-triage.server.ts`

GitHub issue analysis and labeling.

```
router:
  issue_context → get_issue, get_pull_request_files, list_commits
  research → parallel(webSearch, neo4jQuery)
synthesizer
```

---

## 8. Knowledge Graph Builder

**File:** `kg-builder.server.ts`

Research → Extract → Persist pipeline.

```
simpleLoop(WebSearchController)  → research topic
simpleLoop(MemoryController)     → extract entities/relations
withApproval(simpleLoop(Neo4jController)) → persist to graph
synthesizer
```

---

## 9. Ontology Builder

**File:** `ontology-builder.server.ts`

8-phase schema evolution workflow.

| Phase | Pattern | Purpose |
|-------|---------|---------|
| 1. Scoping | simpleLoop | Clarify domain boundaries |
| 2. Research | parallel | Gather from web, docs, github, KB |
| 2b. Dedup | custom | Vector similarity deduplication |
| 3-4. Proposal | judge loop + guardrail | Generate, evaluate, validate |
| 5. Commit | withApproval(simpleLoop) | Persist to neo4j |
| 6. Documentation | actorCritic | Generate markdown docs |
| 7. Suggestions | synthesizer | Summarize and suggest next steps |
| 8. Analysis | withApproval(actorCritic) | Optional statistics |

---

## 10. Semantic Cache

**File:** `semantic-cache.server.ts`

Redis vector caching for queries.

```
semanticCache:
  1. Compute query embedding
  2. vector_search_hash → check for similar past queries
  3. If similarity > 0.92 → return cached (json_get)
  4. If miss → proceed to retrieval

parallel(webSearch, neo4jQuery)

cacheWriter:
  → json_set result
  → set_vector_in_hash embedding
  → expire with TTL

synthesizer
```

---

## 11. Code Mode Agent

**File:** `code-mode.server.ts`

Orchestrate multiple MCP tools via JavaScript snippets executed server-side by the kg-agent gateway's `code-mode` tool family. The gateway's `code-mode` tool is a **factory** — its `args_schema` is `{name, servers}` and a successful call registers a new `code-mode-<name>` tool bound to those servers. The generated tool is what actually runs JS.

```typescript
router({ code_mode: 'Compose JS across multiple MCP tools…' })
→ routes({
    code_mode: chain(
      actorCritic(
        createActorControllerAdapter({
          toolNames: ['mcp-find', 'mcp-add', 'code-mode', 'mcp-exec'],
          dynamicPattern: /^code-mode-/,
          refreshOnCall: true,        // see newly-created tools across turns
        }),
        createCriticAdapter(),
        ['mcp-find', 'mcp-add', 'code-mode', 'mcp-exec'],
        {
          patternId: 'code-mode-loop',
          dynamicToolPattern: /^code-mode-/,   // allowlist for factory output
        }
      ),
      synthesizer({
        mode: 'thread',
        patternId: 'code-mode-synth',
        viewConfig: {
          // Final response built only from actor-side events; critic_result events
          // are filtered out so the critic's reasoning doesn't leak into the prompt.
          eventTypes: ['controller_action', 'tool_call', 'tool_result'],
        },
      })
    )
  })
```

- **Direct-response branch**: when `Router` returns `needs_tool: false`, the router sets `scope.data.response` to the conversational reply and `routes()` passes through — no synthesizer needed at the top level.
- **Cross-turn tool reuse**: `refreshOnCall: true` on the actor adapter forces a fresh `mcpListTools()` per invocation so `code-mode-<name>` tools created in earlier turns of the same session are still visible to the actor. `invalidateToolDescriptions()` is called from `actorCritic.server.ts` right after a successful `code-mode` execution, so the new tool appears in the next attempt's prompt.
- **actorCritic over simpleLoop**: the find → add → factory → call-generated-tool sequence has many ways to go wrong on the first try; actorCritic's retry-with-critic-feedback semantics fit better than simpleLoop's break-on-first-error.

---

## Creating Custom Agents

```typescript
// 1. Define pattern factory
async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools()

  const myPattern = simpleLoop(
    createNeo4jController(tools.neo4j ?? []),
    tools.neo4j ?? [],
    { patternId: 'my-pattern' }
  )

  return [myPattern, synthesizer({ mode: 'thread' })]
}

// 2. Register agent
export const myAgent: AgentConfig = {
  id: 'my-agent',
  name: 'My Agent',
  description: 'Does something useful',
  icon: '🤖',
  servers: ['neo4j-cypher'],
  createPatterns
}

// 3. Add to registry.server.ts
registerAgent(myAgent)
```

---

**Last Updated:** 2026-02-12
