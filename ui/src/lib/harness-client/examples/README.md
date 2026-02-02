# Harness Pattern Examples

Example `actions.server.ts` configurations demonstrating pattern
compositions across all available MCP servers.

## Available Servers

| Server | Namespace | Capabilities |
|--------|-----------|-------------|
| neo4j-cypher | `tools.neo4j` | Graph queries, schema introspection, Cypher write |
| fetch | `tools.web` | HTTP content retrieval |
| web_search | `tools.web` | DuckDuckGo search + content parsing |
| context7 | `tools.context7` | Library doc resolution + retrieval |
| rust-mcp-filesystem | `tools.filesystem` | File read/write/search/edit |
| github | `tools.github` | Issues, PRs, code search, commits |
| memory | `tools.memory` | Entity/relation knowledge graph (ephemeral) |
| redis | `tools.redis` | Key/value, hashes, lists, sets, sorted sets, streams, JSON, vector search |
| database-server | `tools.database` | PostgreSQL/MySQL/SQLite query + schema introspection |

## Pattern Catalog

### Existing Patterns

| Pattern | Signature | Purpose |
|---------|-----------|---------|
| `simpleLoop` | `(controller, tools, config?)` | ReAct decide-execute loop |
| `actorCritic` | `(actor, critic, tools, config?)` | Generate-evaluate with retry |
| `withApproval` | `(pattern, predicate)` | Pause for user approval on matching actions |
| `synthesizer` | `(config)` | Transform tool results into natural language |
| `router` | `(routes, patterns)` | Intent classification to sub-patterns |
| `chain` | `(ctx, patterns)` | Sequential composition |
| `harness` | `(...patterns)` | Top-level agent entry point |

### Proposed New Patterns

| Pattern | Purpose |
|---------|---------|
| `parallel` | Execute multiple patterns concurrently via `Promise.allSettled`, merge events |
| `guardrail` | Multi-layered validation: input rails, execution rails, output rails, circuit breakers |
| `judge` | Score/rank results from multiple sources, select the best |
| `hook` | Side-effect pattern triggered by lifecycle events (session close, error, etc.) |

---

## Examples

### 1. Documentation Assistant

**Servers**: context7, memory
**Patterns**: `simpleLoop` → `simpleLoop` → `synthesizer`
**Use case**: Look up library documentation, persist key findings to memory.

```
User: "How does SolidJS createSignal work?"

chain:
  1. simpleLoop(context7Controller, tools.context7)
     → resolve-library-id("solidjs")
     → get-library-docs(id, topic="createSignal")

  2. simpleLoop(memoryController, tools.memory)
     → create_entities([{ name: "createSignal", type: "API" }])
     → add_observations(entity, ["returns [getter, setter] tuple", ...])

  3. synthesizer({ mode: 'thread' })
     → Combines doc content + stored entities into response
```

```typescript
const docLookup = simpleLoop(b.Context7Controller.bind(b), tools.context7 ?? [], {
  patternId: "doc-lookup",
});

const memoryStore = simpleLoop(b.MemoryController.bind(b), tools.memory ?? [], {
  patternId: "memory-store",
});

const responseSynth = synthesizer({ mode: "thread", patternId: "doc-synth" });

return [docLookup, memoryStore, responseSynth];
```

---

### 2. Multi-Source Research (parallel)

**Servers**: web_search, github, context7, redis
**Patterns**: `parallel` → `judge` → `synthesizer`
**Use case**: Search three sources concurrently, cache in redis, rank results.

```
User: "What's the best way to handle auth in SvelteKit?"

parallel:
  ├─ simpleLoop(webController, tools.web)          → DuckDuckGo results
  ├─ simpleLoop(githubController, tools.github)     → GitHub code examples
  └─ simpleLoop(context7Controller, tools.context7) → SvelteKit official docs

redis: cache each source's results as JSON with TTL
  → json_set("research:{hash}", "$", results)
  → expire("research:{hash}", 3600)

judge(b.JudgeController):
  → Scores each source on: accuracy, recency, authority
  → Returns ranked list

synthesizer({ mode: 'response' })
  → Presents top-ranked answer with source attribution
```

```typescript
function parallel<T>(...patterns: ConfiguredPattern<T>[]): ConfiguredPattern<T> {
  const resolved = resolveConfig("parallel", { patternId: "parallel" });
  return {
    name: "parallel",
    fn: async (scope, view) => {
      return tracer.startActiveSpan("pattern.parallel", async (span) => {
        span.setAttribute("branchCount", patterns.length);
        // Each branch gets an isolated scope with empty events
        const results = await Promise.allSettled(
          patterns.map((p) =>
            p.fn({ ...scope, id: p.name, events: [], startTime: Date.now() }, view),
          ),
        );
        // Merge fulfilled events; log rejected branches
        for (const [i, r] of results.entries()) {
          if (r.status === "fulfilled") {
            scope.events.push(...r.value.events);
            scope.data = { ...scope.data, ...r.value.data };
          } else {
            trackEvent(scope, "error", {
              error: `Branch ${patterns[i].name} failed: ${r.reason}`,
            }, true);
          }
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return scope;
      });
    },
    config: resolved,
  };
}

// Cache layer: wrap each source to persist results in redis
function withCache<T>(
  pattern: ConfiguredPattern<T>,
  ttlSeconds: number = 3600,
): ConfiguredPattern<T> {
  return {
    ...pattern,
    fn: async (scope, view) => {
      const cacheKey = `research:${pattern.name}:${hashInput(scope.data.input)}`;
      // Check redis cache first
      const cached = await callTool("json_get", { key: cacheKey, path: "$" });
      if (cached.success && cached.data) {
        trackEvent(scope, "tool_result", {
          tool: "cache_hit", result: cached.data, success: true,
        }, true);
        return scope;
      }
      const result = await pattern.fn(scope, view);
      // Store in redis with TTL
      const lastResult = result.events.filter((e) => e.type === "tool_result").pop();
      if (lastResult) {
        await callTool("json_set", { key: cacheKey, path: "$", value: JSON.stringify(lastResult.data) });
        await callTool("expire", { key: cacheKey, seconds: ttlSeconds });
      }
      return result;
    },
    config: pattern.config,
  };
}

// Usage
const researchPattern = parallel(
  withCache(simpleLoop(b.WebSearchController.bind(b), tools.web ?? [], { patternId: "web-search" })),
  withCache(simpleLoop(b.GitHubSearchController.bind(b), tools.github ?? [], { patternId: "github-search" })),
  withCache(simpleLoop(b.Context7Controller.bind(b), tools.context7 ?? [], { patternId: "doc-lookup" })),
);

const evaluator = judge(b.JudgeController.bind(b), { patternId: "quality-judge" });

return [researchPattern, evaluator, synthesizer({ mode: "response", patternId: "research-synth" })];
```

---

### 3. Guardrailed Agent (multi-layer guardrail)

**Servers**: rust-mcp-filesystem, redis, neo4j
**Patterns**: `guardrail(input + execution + output + circuit)` wrapping `actorCritic` + `withApproval`
**Use case**: File editing agent with five distinct guardrail layers.

The guardrail pattern draws from NeMo Guardrails' rail taxonomy (input, dialog,
execution, output, retrieval) and Guardrails AI's validator approach. It wraps an
inner pattern with composable validation stages.

```
User: "Refactor the utils module to use named exports"

┌─ INPUT RAILS ────────────────────────────────────────────────────┐
│  • Topical: reject off-topic requests (e.g. "delete the DB")    │
│  • PII scan: redact secrets/tokens before they reach the LLM    │
│  • Budget: check remaining tool-call budget from redis counter   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ EXECUTION RAILS ────────────────────────────────────────────────┐
│  • Path allowlist: reject paths outside workspace                │
│  • Tool scope: only filesystem tools allowed (no neo4j/github)   │
│  • Rate limit: max N tool calls per minute (redis INCR + EXPIRE) │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
         actorCritic(fileEditController, fileEditCritic)
         + withApproval(approvalPredicates.mutations)
                              │
                              ▼
┌─ OUTPUT RAILS ───────────────────────────────────────────────────┐
│  • Schema: verify tool_result matches expected structure          │
│  • Provenance: cross-reference edits against original file        │
│  • Drift detector: flag if >60% of file changed (unintended)     │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ CIRCUIT BREAKER ────────────────────────────────────────────────┐
│  • Track consecutive failures in redis sorted set                │
│  • If 3+ failures in 60s window → trip breaker, refuse new calls │
│  • Cooldown period before retry                                  │
└──────────────────────────────────────────────────────────────────┘
```

```typescript
// --- guardrail pattern: composable rail layers ---

interface Rail<T> {
  name: string;
  phase: "input" | "execution" | "output";
  check: (ctx: RailContext<T>) => Promise<RailResult>;
}

interface RailResult {
  ok: boolean;
  reason?: string;
  action?: "block" | "warn" | "redact" | "retry";
  redacted?: string; // For input redaction
}

interface RailContext<T> {
  input: string;
  scope: PatternScope<T>;
  view: EventView;
  lastToolCall?: ContextEvent;
  lastToolResult?: ContextEvent;
}

interface GuardrailConfig<T> extends PatternConfig {
  rails: Rail<T>[];
  circuitBreaker?: {
    maxFailures: number;
    windowMs: number;
    cooldownMs: number;
  };
  onBlock?: (rail: string, reason: string) => void;
}

function guardrail<T>(
  pattern: ConfiguredPattern<T>,
  config: GuardrailConfig<T>,
): ConfiguredPattern<T> {
  const resolved = resolveConfig("guardrail", config);
  const inputRails = config.rails.filter((r) => r.phase === "input");
  const execRails = config.rails.filter((r) => r.phase === "execution");
  const outputRails = config.rails.filter((r) => r.phase === "output");

  return {
    name: `guardrail(${pattern.name})`,
    fn: async (scope, view) => {
      return tracer.startActiveSpan("pattern.guardrail", async (span) => {
        // --- Circuit breaker check (redis-backed) ---
        if (config.circuitBreaker) {
          const cb = config.circuitBreaker;
          const key = `circuit:${scope.id}`;
          const now = Date.now();
          // Count recent failures using redis sorted set
          const recentFailures = await callTool("zrange", {
            key, start: now - cb.windowMs, stop: now,
          });
          if (recentFailures.success &&
              Array.isArray(recentFailures.data) &&
              recentFailures.data.length >= cb.maxFailures) {
            trackEvent(scope, "error", {
              error: `Circuit breaker tripped: ${recentFailures.data.length} failures in ${cb.windowMs}ms`,
            }, true);
            span.end();
            return scope;
          }
        }

        // --- Input rails ---
        const railCtx: RailContext<T> = { input: scope.data.input ?? "", scope, view };
        for (const rail of inputRails) {
          const result = await rail.check(railCtx);
          span.addEvent(`rail.input.${rail.name}`, { ok: result.ok });
          if (!result.ok) {
            if (result.action === "redact" && result.redacted) {
              railCtx.input = result.redacted; // Scrub and continue
            } else {
              trackEvent(scope, "error", {
                error: `Input rail '${rail.name}' blocked: ${result.reason}`,
              }, true);
              config.onBlock?.(rail.name, result.reason ?? "");
              span.end();
              return scope;
            }
          }
        }

        // --- Execute with execution rails as interceptors ---
        const originalCallTool = callTool;
        const interceptedCallTool = async (name: string, args: Record<string, unknown>) => {
          for (const rail of execRails) {
            const result = await rail.check({
              ...railCtx,
              lastToolCall: { type: "tool_call", ts: Date.now(), patternId: scope.id, data: { tool: name, args } },
            });
            if (!result.ok) {
              trackEvent(scope, "error", {
                error: `Execution rail '${rail.name}' blocked ${name}: ${result.reason}`,
              }, true);
              return { success: false, data: null, error: result.reason };
            }
          }
          // Rate limit via redis INCR
          const rateKey = `ratelimit:${scope.id}:${Math.floor(Date.now() / 60000)}`;
          await callTool("set", { key: rateKey, value: "0", nx: true });
          await callTool("expire", { key: rateKey, seconds: 60 });
          const count = await callTool("hget", { key: rateKey, field: "count" });
          // ... rate limit check omitted for brevity
          return originalCallTool(name, args);
        };

        // Execute wrapped pattern
        const result = await pattern.fn(scope, view);

        // --- Output rails ---
        for (const rail of outputRails) {
          const check = await rail.check({
            ...railCtx,
            scope: result,
            lastToolResult: result.events.filter((e) => e.type === "tool_result").pop(),
          });
          span.addEvent(`rail.output.${rail.name}`, { ok: check.ok });
          if (!check.ok) {
            if (check.action === "retry") {
              // Track failure for circuit breaker
              if (config.circuitBreaker) {
                await callTool("zadd", {
                  key: `circuit:${scope.id}`, score: Date.now(), member: `fail-${Date.now()}`,
                });
              }
              trackEvent(result, "error", {
                error: `Output rail '${rail.name}' rejected: ${check.reason}`,
              }, true);
            }
          }
        }

        span.end();
        return result;
      });
    },
    config: resolved,
  };
}

// --- Concrete rails ---

const topicalRail: Rail<any> = {
  name: "topical",
  phase: "input",
  check: async ({ input }) => {
    // Use BAML classifier to check if input is on-topic
    const classification = await b.TopicClassifier(input, [
      "file_editing", "code_refactoring", "file_search",
    ]);
    return classification.onTopic
      ? { ok: true }
      : { ok: false, reason: `Off-topic: ${classification.detected}`, action: "block" };
  },
};

const piiScanRail: Rail<any> = {
  name: "pii-scan",
  phase: "input",
  check: async ({ input }) => {
    // Regex-based fast scan for common secrets
    const patterns = [
      { name: "AWS key", re: /AKIA[0-9A-Z]{16}/ },
      { name: "GitHub token", re: /ghp_[a-zA-Z0-9]{36}/ },
      { name: "JWT", re: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/ },
      { name: "private key", re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
    ];
    for (const { name, re } of patterns) {
      if (re.test(input)) {
        return {
          ok: false,
          action: "redact",
          reason: `Found ${name} in input`,
          redacted: input.replace(re, `[REDACTED:${name}]`),
        };
      }
    }
    return { ok: true };
  },
};

const pathAllowlistRail: Rail<any> = {
  name: "path-allowlist",
  phase: "execution",
  check: async ({ lastToolCall }) => {
    const data = lastToolCall?.data as { tool: string; args: { path?: string } };
    if (!data?.args?.path) return { ok: true };
    const blocked = [/node_modules/, /\.env/, /\.git\//, /\/etc\//, /\/proc\//];
    const match = blocked.find((p) => p.test(data.args.path!));
    return match
      ? { ok: false, reason: `Blocked path: ${data.args.path}`, action: "block" }
      : { ok: true };
  },
};

const toolScopeRail: Rail<any> = {
  name: "tool-scope",
  phase: "execution",
  check: async ({ lastToolCall }) => {
    const data = lastToolCall?.data as { tool: string };
    const allowed = new Set([
      "read_text_file", "write_file", "edit_file", "list_directory",
      "directory_tree", "search_files", "search_files_content",
      "get_file_info", "read_file_lines", "head_file", "tail_file",
    ]);
    return allowed.has(data?.tool)
      ? { ok: true }
      : { ok: false, reason: `Tool '${data?.tool}' not in scope`, action: "block" };
  },
};

const driftDetectorRail: Rail<any> = {
  name: "drift-detector",
  phase: "output",
  check: async ({ lastToolResult }) => {
    const data = lastToolResult?.data as { tool: string; result: string; success: boolean };
    if (data?.tool !== "edit_file" || !data?.success) return { ok: true };
    // Check if edit replaced >60% of file content
    try {
      const diff = JSON.parse(data.result);
      if (diff.linesChanged && diff.totalLines) {
        const ratio = diff.linesChanged / diff.totalLines;
        if (ratio > 0.6) {
          return {
            ok: false,
            action: "retry",
            reason: `Edit changed ${(ratio * 100).toFixed(0)}% of file — likely unintended`,
          };
        }
      }
    } catch { /* non-diff result, pass through */ }
    return { ok: true };
  },
};

// --- Composition ---
const safeFileEditor = guardrail(
  withApproval(
    actorCritic(b.FileEditController.bind(b), b.FileEditCritic.bind(b), tools.filesystem ?? [], {
      patternId: "file-edit",
    }),
    approvalPredicates.mutations,
  ),
  {
    patternId: "safe-file-edit",
    rails: [topicalRail, piiScanRail, pathAllowlistRail, toolScopeRail, driftDetectorRail],
    circuitBreaker: { maxFailures: 3, windowMs: 60_000, cooldownMs: 30_000 },
  },
);

return [safeFileEditor, synthesizer({ mode: "thread", patternId: "edit-synth" })];
```

---

### 4. Issue Triage Agent (router + parallel)

**Servers**: github, web_search, neo4j, redis
**Patterns**: `router` → (`parallel` | `simpleLoop`) → `synthesizer`
**Use case**: Triage GitHub issues by gathering context from multiple sources.
Uses redis sorted sets to track triage history and priority scores.

```
User: "Triage issue #42 in org/repo"

router:
  "issue_context" → simpleLoop(githubController)
     → get_issue(42), get_pull_request_files, list_commits

  "research" → parallel:
     ├─ simpleLoop(webController)    → search error messages
     └─ simpleLoop(neo4jController)  → query project knowledge graph

  "triage" → simpleLoop(triageController)
     → Classify severity, assign labels, suggest fix
     → zadd("triage:scores", priority, "issue:42")

synthesizer({ mode: 'thread' })
```

```typescript
const issueContext = simpleLoop(b.GitHubIssueController.bind(b), tools.github ?? [], {
  patternId: "issue-context",
});

const research = parallel(
  simpleLoop(b.WebSearchController.bind(b), tools.web ?? [], {
    patternId: "web-research",
  }),
  simpleLoop(b.Neo4jController.bind(b), tools.neo4j ?? [], {
    patternId: "kg-lookup",
    schema,
  }),
);

const routerPattern = router(
  {
    issue_context: "Fetch issue details and linked PRs from GitHub",
    research: "Search web and knowledge graph for related context",
  },
  { issue_context: issueContext, research },
);

return [routerPattern, synthesizer({ mode: "thread", patternId: "triage-synth" })];
```

---

### 5. Knowledge Graph Builder (chain)

**Servers**: web_search, neo4j, memory
**Patterns**: `simpleLoop` → `simpleLoop` → `withApproval(simpleLoop)` → `synthesizer`
**Use case**: Research a topic, extract entities, persist to both neo4j and memory.

```
User: "Build a knowledge graph about WebAssembly runtimes"

chain:
  1. simpleLoop(webController)
     → search("WebAssembly runtimes comparison")
     → fetch_content(top results)

  2. simpleLoop(memoryController)
     → create_entities([wasmtime, wasmer, wasm3, ...])
     → create_relations([{from: "wasmtime", to: "Bytecode Alliance", type: "maintained_by"}])

  3. withApproval(simpleLoop(neo4jController))
     → CREATE (n:Runtime {name: "wasmtime", ...})
     → CREATE (n)-[:MAINTAINED_BY]->(org)

  4. synthesizer({ mode: 'thread' })
```

```typescript
const webResearch = simpleLoop(b.WebSearchController.bind(b), tools.web ?? [], {
  patternId: "web-research",
  maxTurns: 8,
});

const memoryExtract = simpleLoop(b.MemoryExtractController.bind(b), tools.memory ?? [], {
  patternId: "memory-extract",
});

const neo4jPersist = withApproval(
  simpleLoop(b.Neo4jController.bind(b), tools.neo4j ?? [], {
    patternId: "neo4j-persist",
    schema,
  }),
  approvalPredicates.mutations,
);

const responseSynth = synthesizer({ mode: "thread", patternId: "kg-build-synth" });

return [webResearch, memoryExtract, neo4jPersist, responseSynth];
```

---

### 6. LLM-as-Judge (judge pattern)

**Servers**: web_search, context7, github
**Patterns**: `parallel` → `judge` → `synthesizer`
**Use case**: Retrieve competing answers, have an LLM rank them by quality.

```
User: "What's the recommended state management for React 19?"

parallel:
  ├─ simpleLoop(webController)       → web opinions
  ├─ simpleLoop(context7Controller)  → official React docs
  └─ simpleLoop(githubController)    → GitHub discussions/issues

judge(b.JudgeController):
  → Receives all results as candidates
  → Scores each on: accuracy, recency, source authority
  → Returns ranked list with reasoning

synthesizer({ mode: 'response' })
  → Presents top-ranked answer with attribution
```

```typescript
function judge<T>(
  evaluator: BamlFunction,
  config?: PatternConfig,
): ConfiguredPattern<T> {
  const resolved = resolveConfig("judge", config);
  return {
    name: config?.patternId ?? "judge",
    fn: async (scope, view) => {
      return tracer.startActiveSpan("pattern.judge", async (span) => {
        // Collect all tool_result events from previous patterns
        const candidates = view.fromAll().ofType("tool_result").get();
        span.setAttribute("candidateCount", candidates.length);

        // Call BAML evaluator with structured candidates
        const evaluation = await evaluator(
          scope.data?.input ?? "",
          candidates.map((c) => ({
            source: c.patternId,
            content: JSON.stringify(c.data),
          })),
        );

        trackEvent(scope, "controller_action", {
          reasoning: evaluation.reasoning,
          rankings: evaluation.rankings,
          selected: evaluation.best,
        }, resolved.trackHistory);

        // Forward best result as the response for synthesizer
        scope.data = {
          ...scope.data,
          response: evaluation.best?.content,
          judgeReasoning: evaluation.reasoning,
        };

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return scope;
      });
    },
    config: resolved,
  };
}

// Usage
const sources = parallel(
  simpleLoop(b.WebSearchController.bind(b), tools.web ?? [], { patternId: "web-search" }),
  simpleLoop(b.Context7Controller.bind(b), tools.context7 ?? [], { patternId: "doc-lookup" }),
  simpleLoop(b.GitHubSearchController.bind(b), tools.github ?? [], { patternId: "github-search" }),
);

const evaluator = judge(b.JudgeController.bind(b), { patternId: "quality-judge" });

return [sources, evaluator, synthesizer({ mode: "response", patternId: "judge-synth" })];
```

---

### 7. Conversational Memory with KB Distillation (memory + neo4j + redis)

**Servers**: memory (short-term), neo4j (long-term KB), redis (session state + vector)
**Patterns**: Main loop + `hook` pattern on session close
**Use case**: Memory as conversational scratchpad; neo4j as persistent KB.
On session close, a background hook distills useful facts from memory into the KB.

#### Architecture

```
                       ┌──────────────────────────┐
  User message ──────► │  Router (normal flow)     │
                       │  → neo4j / web / code      │
                       └────────┬─────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌──────────────┐       ┌──────────────┐
            │ memory       │       │ redis        │
            │ (scratchpad) │       │ (session)    │
            │              │       │              │
            │ Stores:      │       │ Stores:      │
            │ • user prefs │       │ • turn count │
            │ • key facts  │       │ • embeddings │
            │ • corrections│       │ • TTL state  │
            └──────┬───────┘       └──────────────┘
                   │
                   │  on session.close
                   ▼
            ┌──────────────────────────────────────┐
            │  Distillation Hook (background)       │
            │                                       │
            │  1. read_graph() from memory           │
            │  2. BAML DistillController:             │
            │     → filter noise, extract durable     │
            │       facts, user corrections, prefs    │
            │  3. write_neo4j_cypher:                 │
            │     → MERGE nodes, relationships        │
            │     → SET properties with provenance    │
            │  4. delete transient memory entities    │
            └──────────────────────────────────────┘
```

#### Session flow

```typescript
// --- Main conversation agent ---

// Memory controller writes to memory MCP during conversation
const memoryWriter = simpleLoop(b.MemoryWriter.bind(b), tools.memory ?? [], {
  patternId: "memory-write",
  // Runs after each router result to capture key facts
  viewConfig: { fromLast: true, eventTypes: ["tool_result"] },
});

// Redis tracks session metadata (turn count, timestamps, topic drift)
const sessionTracker: ConfiguredPattern<SessionData> = {
  name: "session-tracker",
  fn: async (scope, _view) => {
    const sessionKey = `session:${scope.data.sessionId}`;
    await callTool("hset", { key: sessionKey, field: "lastTurn", value: Date.now().toString() });
    await callTool("hset", { key: sessionKey, field: "turnCount", value: String((scope.data.turnCount ?? 0) + 1) });
    await callTool("expire", { key: sessionKey, seconds: 7200 }); // 2hr TTL
    scope.data = { ...scope.data, turnCount: (scope.data.turnCount ?? 0) + 1 };
    return scope;
  },
  config: resolveConfig("session-tracker", { patternId: "session-tracker" }),
};

// Router dispatches to domain patterns (neo4j, web, code)
const routerPattern = router(routes, domainPatterns);

// Compose: track → route → memorize → synthesize
return [sessionTracker, routerPattern, memoryWriter, responseSynth];
```

#### Session close hook (distillation)

```typescript
// --- hook pattern: triggered by lifecycle events ---

interface HookConfig<T> extends PatternConfig {
  trigger: "session_close" | "error" | "approval_timeout" | "custom";
  background?: boolean; // Run async, don't block response
}

function hook<T>(
  pattern: ConfiguredPattern<T>,
  config: HookConfig<T>,
): ConfiguredPattern<T> {
  const resolved = resolveConfig("hook", config);
  return {
    name: `hook:${config.trigger}(${pattern.name})`,
    fn: async (scope, view) => {
      // Hook runs the wrapped pattern but doesn't block the main chain
      if (config.background) {
        // Fire-and-forget: schedule for execution after response
        queueMicrotask(async () => {
          try { await pattern.fn(scope, view); }
          catch (e) { console.error(`Hook ${config.trigger} failed:`, e); }
        });
        return scope;
      }
      return pattern.fn(scope, view);
    },
    config: resolved,
  };
}

// --- Distillation workflow ---

async function createDistillationHook(schema: string): Promise<ConfiguredPattern<SessionData>> {
  // Step 1: Read all memory entities from this session
  const readMemory = simpleLoop(b.MemoryReadController.bind(b), tools.memory ?? [], {
    patternId: "distill-read",
    maxTurns: 2,
  });

  // Step 2: BAML distill — filter noise, extract durable facts
  const distill: ConfiguredPattern<SessionData> = {
    name: "distill-extract",
    fn: async (scope, view) => {
      const memoryEvents = view.fromPattern("distill-read").ofType("tool_result").get();
      const distilled = await b.DistillController(
        JSON.stringify(memoryEvents.map((e) => e.data)),
        scope.data.sessionId ?? "unknown",
      );
      scope.data = { ...scope.data, distilledFacts: distilled.facts, distilledRelations: distilled.relations };
      return scope;
    },
    config: resolveConfig("distill-extract", { patternId: "distill-extract" }),
  };

  // Step 3: Write to neo4j KB
  const persistToKB = simpleLoop(b.Neo4jController.bind(b), tools.neo4j ?? [], {
    patternId: "distill-persist",
    schema,
  });

  // Step 4: Cleanup transient memory
  const cleanupMemory = simpleLoop(b.MemoryCleanupController.bind(b), tools.memory ?? [], {
    patternId: "distill-cleanup",
  });

  // Wrap in chain as a single hook
  const distillChain: ConfiguredPattern<SessionData> = {
    name: "distill-chain",
    fn: async (scope, view) => {
      // Sequential: read → extract → persist → cleanup
      for (const p of [readMemory, distill, persistToKB, cleanupMemory]) {
        const result = await p.fn(scope, view);
        scope.events.push(...result.events);
        scope.data = { ...scope.data, ...result.data };
      }
      return scope;
    },
    config: resolveConfig("distill-chain", { patternId: "distill-chain" }),
  };

  return hook(distillChain, { patternId: "session-close-hook", trigger: "session_close", background: true });
}

// --- Server action for session close ---
export async function closeSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session?.serializedContext) return;

  const schema = await getSchema();
  const distillHook = await createDistillationHook(schema);

  // Run distillation on the final session context
  const ctx = deserializeContext(session.serializedContext);
  const scope = createScope("distill", ctx.data);
  const view = createEventView(ctx);
  await distillHook.fn(scope, view);

  deleteSession(sessionId);
}
```

---

### 8. Ontology Builder (long-running agent)

**Servers**: web_search, context7, github, memory, neo4j, redis, rust-mcp-filesystem, database-server
**Patterns**: Multi-phase workflow using most pattern types
**Use case**: Given a domain topic, build a formal ontology through iterative research,
proposal, evaluation, and commitment.

#### Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ONTOLOGY BUILDER PIPELINE                           │
│                                                                             │
│  Phase 1: SCOPING                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  simpleLoop(scopingController)                                      │   │
│  │  → Ask clarifying questions to delineate domain boundaries           │   │
│  │  → Store domain constraints in memory                                │   │
│  │  → Cache scope definition in redis (json_set)                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 2: RESEARCH                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  parallel:                                                           │   │
│  │  ├─ simpleLoop(webController)       → academic papers, standards     │   │
│  │  ├─ simpleLoop(context7Controller)  → library/framework docs         │   │
│  │  ├─ simpleLoop(githubController)    → existing ontologies on GH      │   │
│  │  └─ simpleLoop(neo4jController)     → existing KB for related terms  │   │
│  │                                                                      │   │
│  │  redis: vector index for semantic deduplication                       │   │
│  │  → set_vector_in_hash for each discovered concept                    │   │
│  │  → vector_search_hash to find near-duplicates before adding          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 3: PROPOSAL (iterative with judge)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  loop:                                                               │   │
│  │    actor: OntologyProposalController                                 │   │
│  │    → Propose classes, properties, relationships in memory             │   │
│  │    → create_entities, create_relations                                │   │
│  │                                                                      │   │
│  │    judge: OntologyJudge                                               │   │
│  │    → Evaluate completeness, consistency, naming conventions           │   │
│  │    → Score on: coverage, precision, hierarchy depth, relation types   │   │
│  │    → Returns { pass: bool, score: float, feedback: string }          │   │
│  │                                                                      │   │
│  │    if !pass: feed judge.feedback back to actor, retry                 │   │
│  │    max 5 iterations                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 4: GUARDRAIL (logical consistency)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  guardrail(output rails):                                            │   │
│  │  • No orphan nodes (every class reachable from root)                 │   │
│  │  • No circular subClassOf hierarchies                                │   │
│  │  • Property domains/ranges reference existing classes                 │   │
│  │  • Naming convention consistency (PascalCase classes, camelCase props)│   │
│  │  • Cardinality constraints make sense                                 │   │
│  │  • No duplicate labels or ambiguous terms                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 5: COMMIT                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  withApproval(simpleLoop(neo4jOntologyController)):                  │   │
│  │  → CREATE CONSTRAINT ON (c:OntologyClass) ASSERT c.uri IS UNIQUE    │   │
│  │  → MERGE (c:OntologyClass {name, description, ...})                 │   │
│  │  → MERGE (c)-[:SUBCLASS_OF]->(parent)                               │   │
│  │  → MERGE (p:OntologyProperty {name, domain, range, ...})            │   │
│  │  → CREATE (:OntologyVersion {version, createdAt, topic})            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 6: DOCUMENTATION                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  actorCritic(docController, docCritic, tools.filesystem):            │   │
│  │  → Generate markdown docs for each major class                       │   │
│  │  → Include: description, properties, relationships, examples         │   │
│  │  → Write to filesystem: ontology/{topic}/classes/*.md                │   │
│  │  → Write index: ontology/{topic}/README.md                          │   │
│  │  → Critic ensures completeness and cross-references                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 7: SUGGESTIONS                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  synthesizer({ mode: 'thread' }):                                    │   │
│  │  → Summarize what was built                                          │   │
│  │  → Suggest code examples for working with the ontology               │   │
│  │  → Propose analysis queries (MATCH paths, centrality, clustering)    │   │
│  │  → Offer next steps: extend, validate against data, export as OWL    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Phase 8: ANALYSIS (optional, requires approval)                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  withApproval(actorCritic(analysisController, analysisCritic)):      │   │
│  │  → Generate analysis script (Python/Cypher)                          │   │
│  │  → Write to filesystem                                               │   │
│  │  → (Future: configure microVM, execute, return stats)                │   │
│  │  → Query neo4j for: node degree distribution, path lengths,          │   │
│  │    connected components, property coverage statistics                 │   │
│  │  → Store analysis results in database-server (postgres)              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Implementation

```typescript
async function createOntologyBuilder(): Promise<ConfiguredPattern<OntologyData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // --- Phase 1: Scoping ---
  const scoping = simpleLoop(b.OntologyScopingController.bind(b), [...(tools.memory ?? [])], {
    patternId: "ontology-scope",
    maxTurns: 6, // Allow back-and-forth with user
  });

  // --- Phase 2: Research (parallel with dedup) ---
  const dedup: ConfiguredPattern<OntologyData> = {
    name: "semantic-dedup",
    fn: async (scope, view) => {
      // Before adding a concept, check redis vector index for near-duplicates
      const concepts = view.fromLastPattern().ofType("tool_result").get();
      for (const c of concepts) {
        const data = c.data as { result: string };
        // Store embedding and check similarity
        await callTool("set_vector_in_hash", {
          key: `concept:${scope.data.topic}:${c.patternId}`,
          field: "embedding",
          vector: data.result, // Assumes embedding is pre-computed
        });
        const similar = await callTool("vector_search_hash", {
          index: `idx:concepts:${scope.data.topic}`,
          query_vector: data.result,
          top_k: 3,
        });
        if (similar.success) {
          trackEvent(scope, "tool_result", {
            tool: "dedup_check",
            result: JSON.stringify(similar.data),
            success: true,
          }, true);
        }
      }
      return scope;
    },
    config: resolveConfig("semantic-dedup", { patternId: "semantic-dedup" }),
  };

  const research = parallel(
    simpleLoop(b.WebSearchController.bind(b), tools.web ?? [], {
      patternId: "onto-web-research", maxTurns: 8,
    }),
    simpleLoop(b.Context7Controller.bind(b), tools.context7 ?? [], {
      patternId: "onto-doc-research",
    }),
    simpleLoop(b.GitHubSearchController.bind(b), tools.github ?? [], {
      patternId: "onto-github-research",
    }),
    simpleLoop(b.Neo4jController.bind(b), tools.neo4j ?? [], {
      patternId: "onto-existing-kb", schema,
    }),
  );

  // --- Phase 3: Proposal with judge loop ---
  const proposalLoop: ConfiguredPattern<OntologyData> = {
    name: "ontology-proposal",
    fn: async (scope, view) => {
      return tracer.startActiveSpan("pattern.ontology-proposal", async (span) => {
        const maxIterations = 5;
        let feedback = "";

        for (let i = 0; i < maxIterations; i++) {
          span.addEvent("proposal.iteration", { iteration: i });

          // Actor: propose ontology structure in memory
          const proposal = await b.OntologyProposalController(
            scope.data.input ?? "",
            scope.data.scopeDefinition ?? "",
            JSON.stringify(view.fromPattern("onto-web-research").ofType("tool_result").get()),
            feedback,
            i,
          );

          // Write proposal to memory
          for (const entity of proposal.classes) {
            await callTool("create_entities", { entities: [entity] });
          }
          for (const rel of proposal.relations) {
            await callTool("create_relations", { relations: [rel] });
          }

          trackEvent(scope, "controller_action", {
            reasoning: proposal.reasoning,
            classCount: proposal.classes.length,
            relationCount: proposal.relations.length,
            iteration: i,
          }, true);

          // Judge: evaluate proposal quality
          const judgment = await b.OntologyJudge(
            scope.data.scopeDefinition ?? "",
            JSON.stringify(proposal),
          );

          trackEvent(scope, "critic_result", {
            is_sufficient: judgment.pass,
            score: judgment.score,
            explanation: judgment.feedback,
          }, true);

          if (judgment.pass && judgment.score >= 0.7) {
            scope.data = { ...scope.data, proposal, judgeScore: judgment.score };
            break;
          }

          feedback = judgment.feedback;

          // Clean up rejected proposal from memory
          if (i < maxIterations - 1) {
            await callTool("delete_entities", {
              entityNames: proposal.classes.map((c: any) => c.name),
            });
          }
        }

        span.end();
        return scope;
      });
    },
    config: resolveConfig("ontology-proposal", { patternId: "ontology-proposal" }),
  };

  // --- Phase 4: Logical consistency guardrails ---
  const consistencyRails: Rail<OntologyData>[] = [
    {
      name: "no-orphans",
      phase: "output",
      check: async ({ scope }) => {
        const graph = await callTool("read_graph", {});
        if (!graph.success) return { ok: true }; // Can't verify, pass
        const entities = (graph.data as any)?.entities ?? [];
        const relations = (graph.data as any)?.relations ?? [];
        const connected = new Set(relations.flatMap((r: any) => [r.from, r.to]));
        const orphans = entities.filter((e: any) => !connected.has(e.name) && e.entityType === "Class");
        return orphans.length > 0
          ? { ok: false, action: "warn", reason: `Orphan classes: ${orphans.map((o: any) => o.name).join(", ")}` }
          : { ok: true };
      },
    },
    {
      name: "no-circular-hierarchy",
      phase: "output",
      check: async ({ scope }) => {
        // Use neo4j to detect cycles in SUBCLASS_OF
        const cycleCheck = await callTool("read_neo4j_cypher", {
          query: `
            MATCH path = (a:OntologyClass)-[:SUBCLASS_OF*]->(a)
            RETURN nodes(path) AS cycle LIMIT 1
          `,
        });
        return cycleCheck.success && Array.isArray(cycleCheck.data) && cycleCheck.data.length > 0
          ? { ok: false, action: "retry", reason: "Circular subClassOf hierarchy detected" }
          : { ok: true };
      },
    },
    {
      name: "naming-convention",
      phase: "output",
      check: async ({ scope }) => {
        const violations: string[] = [];
        const proposal = scope.data.proposal;
        if (!proposal) return { ok: true };
        for (const cls of proposal.classes ?? []) {
          if (cls.name && !/^[A-Z][a-zA-Z0-9]*$/.test(cls.name)) {
            violations.push(`Class '${cls.name}' should be PascalCase`);
          }
        }
        return violations.length > 0
          ? { ok: false, action: "warn", reason: violations.join("; ") }
          : { ok: true };
      },
    },
  ];

  const validated = guardrail(proposalLoop, {
    patternId: "ontology-validated",
    rails: consistencyRails,
  });

  // --- Phase 5: Commit to neo4j ---
  const commit = withApproval(
    simpleLoop(b.Neo4jOntologyCommitController.bind(b), tools.neo4j ?? [], {
      patternId: "ontology-commit",
      schema,
      maxTurns: 15, // Many MERGE statements
    }),
    approvalPredicates.mutations,
  );

  // --- Phase 6: Documentation ---
  const documentation = actorCritic(
    b.OntologyDocController.bind(b),
    b.OntologyDocCritic.bind(b),
    tools.filesystem ?? [],
    { patternId: "ontology-docs", maxRetries: 2 },
  );

  // --- Phase 7: Suggestions ---
  const suggestions = synthesizer({
    mode: "thread",
    patternId: "ontology-suggestions",
  });

  // --- Phase 8: Analysis (optional) ---
  const analysis = withApproval(
    actorCritic(
      b.OntologyAnalysisController.bind(b),
      b.OntologyAnalysisCritic.bind(b),
      [...(tools.neo4j ?? []), ...(tools.filesystem ?? []), ...(tools.database ?? [])],
      { patternId: "ontology-analysis" },
    ),
    // Custom predicate: always require approval for analysis phase
    (_action) => true,
  );

  return [
    scoping,         // Phase 1
    research,        // Phase 2
    dedup,           // Phase 2b
    validated,       // Phase 3+4
    commit,          // Phase 5
    documentation,   // Phase 6
    suggestions,     // Phase 7
    analysis,        // Phase 8
  ];
}

// --- Server action ---
export async function buildOntology(
  sessionId: string,
  topic: string,
): Promise<HarnessResultScoped<OntologyData>> {
  const patterns = await createOntologyBuilder();
  const agent = harness(...patterns);
  return agent(
    `Build a formal ontology for the domain: ${topic}`,
    sessionId,
    { topic } as Partial<OntologyData>,
  );
}
```

#### Types

```typescript
interface OntologyData extends HarnessData {
  topic?: string;
  scopeDefinition?: string;
  proposal?: {
    classes: Array<{ name: string; description: string; parent?: string }>;
    relations: Array<{ from: string; to: string; type: string; cardinality?: string }>;
    properties: Array<{ name: string; domain: string; range: string }>;
    reasoning: string;
  };
  judgeScore?: number;
  distilledFacts?: unknown[];
  distilledRelations?: unknown[];
  turnCount?: number;
  sessionId?: string;
}
```

---

### 9. Semantic Cache & Retrieval (redis-native)

**Servers**: redis, web_search, neo4j
**Patterns**: `simpleLoop` with redis vector search as primary retrieval
**Use case**: Build a semantic cache that stores embeddings of previous queries and
results. On new queries, check redis vector similarity first before hitting web/neo4j.

```
User: "What's the difference between RDF and property graphs?"

1. Compute query embedding (via BAML function)
2. vector_search_hash in redis → check for similar past queries
3. If similarity > 0.92 → return cached result (redis json_get)
4. If miss:
   a. parallel: web_search + neo4j query
   b. Store result + embedding in redis (json_set + set_vector_in_hash)
   c. Add to neo4j as ConceptComparison node
5. synthesizer
```

```typescript
const semanticRetrieval: ConfiguredPattern<CacheData> = {
  name: "semantic-cache",
  fn: async (scope, view) => {
    return tracer.startActiveSpan("pattern.semantic-cache", async (span) => {
      const input = scope.data.input ?? "";

      // Step 1: Get embedding from BAML
      const embedding = await b.EmbedQuery(input);

      // Step 2: Search redis vector index
      const cached = await callTool("vector_search_hash", {
        index: "idx:query_cache",
        query_vector: embedding.vector,
        top_k: 1,
      });

      if (cached.success && cached.data?.[0]?.score > 0.92) {
        // Cache hit
        const cacheKey = cached.data[0].key;
        const result = await callTool("json_get", { key: cacheKey, path: "$.result" });
        span.addEvent("cache.hit", { key: cacheKey, score: cached.data[0].score });
        trackEvent(scope, "tool_result", {
          tool: "semantic_cache_hit", result: result.data, success: true,
        }, true);
        scope.data = { ...scope.data, response: result.data, cacheHit: true };
        span.end();
        return scope;
      }

      // Cache miss: proceed to actual retrieval
      span.addEvent("cache.miss");
      scope.data = { ...scope.data, cacheHit: false, queryEmbedding: embedding.vector };
      span.end();
      return scope;
    });
  },
  config: resolveConfig("semantic-cache", { patternId: "semantic-cache" }),
};

// Post-retrieval: store in cache
const cacheWriter: ConfiguredPattern<CacheData> = {
  name: "cache-writer",
  fn: async (scope, view) => {
    if (scope.data.cacheHit) return scope; // Skip if already cached

    const results = view.fromLastPattern().ofType("tool_result").get();
    const cacheKey = `query:${hashInput(scope.data.input ?? "")}`;

    // Store result as JSON
    await callTool("json_set", {
      key: cacheKey, path: "$",
      value: JSON.stringify({ query: scope.data.input, result: results, ts: Date.now() }),
    });

    // Store embedding for vector search
    if (scope.data.queryEmbedding) {
      await callTool("set_vector_in_hash", {
        key: cacheKey, field: "embedding", vector: scope.data.queryEmbedding,
      });
    }

    // TTL: 24 hours
    await callTool("expire", { key: cacheKey, seconds: 86400 });
    return scope;
  },
  config: resolveConfig("cache-writer", { patternId: "cache-writer" }),
};

// Compose
const retrieval = parallel(
  simpleLoop(b.WebSearchController.bind(b), tools.web ?? [], { patternId: "web-search" }),
  simpleLoop(b.Neo4jController.bind(b), tools.neo4j ?? [], { patternId: "kg-search", schema }),
);

return [
  semanticRetrieval,  // Check cache first
  retrieval,          // On miss: fetch from sources
  cacheWriter,        // Store result in cache
  synthesizer({ mode: "thread", patternId: "retrieval-synth" }),
];
```

---

## Pattern Composition Matrix

| | neo4j | fetch | web_search | context7 | filesystem | github | memory | redis | database |
|---|---|---|---|---|---|---|---|---|---|
| **simpleLoop** | Query/write | Fetch URLs | Search | Resolve docs | Read/search | Issues/PRs | Entity CRUD | Get/set/hash | SQL query |
| **actorCritic** | Complex queries | - | - | - | File refactoring | PR review | - | - | Schema migration |
| **withApproval** | Write queries | - | - | - | Write/move | Create issue | Delete entities | Delete keys | DROP/ALTER |
| **parallel** | Multi-query | Multi-fetch | Multi-search | Multi-lib | Multi-file | Multi-repo | - | - | Multi-DB |
| **guardrail** | Cypher injection | URL allowlist | Topic scope | - | Path safety | Org/repo scope | - | Rate limit | SQL injection |
| **judge** | - | - | Rank results | Rank docs | - | Rank code | - | Score cache | - |
| **hook** | KB distill | - | - | - | Log to file | - | Session cleanup | TTL mgmt | Audit log |

## BAML Functions Needed

| BAML Function | Pattern | Servers Used |
|---------------|---------|-------------|
| `Context7Controller` | simpleLoop | context7 |
| `MemoryController` / `MemoryWriter` | simpleLoop | memory |
| `MemoryReadController` / `MemoryCleanupController` | simpleLoop (hook) | memory |
| `MemoryExtractController` | simpleLoop | memory |
| `DistillController` | custom (hook) | memory → neo4j |
| `GitHubSearchController` / `GitHubIssueController` | simpleLoop | github |
| `FileEditController` / `FileEditCritic` | actorCritic | rust-mcp-filesystem |
| `JudgeController` | judge | (evaluator, no tools) |
| `TopicClassifier` | guardrail (input rail) | (classifier, no tools) |
| `OntologyScopingController` | simpleLoop | memory |
| `OntologyProposalController` | custom (proposal loop) | memory |
| `OntologyJudge` | custom (judge in loop) | (evaluator, no tools) |
| `Neo4jOntologyCommitController` | simpleLoop | neo4j |
| `OntologyDocController` / `OntologyDocCritic` | actorCritic | rust-mcp-filesystem |
| `OntologyAnalysisController` / `OntologyAnalysisCritic` | actorCritic | neo4j + filesystem + database |
| `EmbedQuery` | custom (cache) | (embedding, no tools) |
| `Neo4jController` | simpleLoop | neo4j-cypher (existing) |
| `WebSearchController` | simpleLoop | web_search (existing) |
| `CodeModeController` / `CodeModeCritic` | actorCritic (existing) | all |
