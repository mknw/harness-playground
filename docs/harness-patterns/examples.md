# Harness Pattern Examples

Complete implementations of 10 example agents demonstrating various pattern compositions.

## Table of Contents

1. [Default Agent](#1-default-agent)
2. [Knowledge Graph Builder](#2-knowledge-graph-builder)
3. [Documentation Assistant](#3-documentation-assistant)
4. [Multi-Source Research](#4-multi-source-research)
5. [LLM-as-Judge](#5-llm-as-judge)
6. [Guardrailed File Editor](#6-guardrailed-file-editor)
7. [Conversational Memory](#7-conversational-memory)
8. [Issue Triage](#8-issue-triage)
9. [Ontology Builder](#9-ontology-builder)
10. [Semantic Cache](#10-semantic-cache)

---

## 1. Default Agent

**Pattern:** `router → synthesizer`

The original multi-capability agent with intent-based routing.

```typescript
// Pattern: router(neo4j | web_search | code_mode) → synthesizer

"use server";

import {
  router,
  simpleLoop,
  actorCritic,
  synthesizer,
  withApproval,
  approvalPredicates,
  Tools,
  callTool,
  createNeo4jController,
  createWebSearchController,
  createActorControllerAdapter,
  createCriticAdapter,
  type ConfiguredPattern,
} from "../../harness-patterns";

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Neo4j with approval for mutations
  const neo4jPattern = withApproval(
    simpleLoop(createNeo4jController(tools.neo4j ?? []), tools.neo4j ?? [], {
      patternId: "neo4j-query",
      schema,
    }),
    approvalPredicates.mutations,
  );

  // Web search
  const webPattern = simpleLoop(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "web-search" },
  );

  // Code mode with actor-critic
  const codePattern = actorCritic(
    createActorControllerAdapter(tools.all),
    createCriticAdapter(),
    tools.all,
    { patternId: "code-mode" },
  );

  // Router dispatches to appropriate pattern
  const routerPattern = router(
    {
      neo4j: "Database queries and graph operations",
      web_search: "Web lookups and information retrieval",
      code_mode: "Multi-tool script composition",
    },
    {
      neo4j: neo4jPattern,
      web_search: webPattern,
      code_mode: codePattern,
    },
  );

  const responseSynth = synthesizer({ mode: "thread", patternId: "response-synth" });

  return [routerPattern, responseSynth];
}

export const defaultAgent: AgentConfig = {
  id: "default",
  name: "Default Agent",
  description: "Router-based agent with Neo4j, Web Search, and Code Mode",
  icon: "🤖",
  servers: ["neo4j-cypher", "web_search", "fetch"],
  createPatterns,
};
```

---

## 2. Knowledge Graph Builder

**Pattern:** `simpleLoop → simpleLoop → withApproval(simpleLoop) → synthesizer`

Multi-stage pipeline: research, extract entities, persist to graph databases.

```typescript
// Pattern: web-research → memory-extract → neo4j-persist → synthesizer

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Stage 1: Research the topic on the web
  const webResearch = simpleLoop(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "web-research", maxTurns: 8 },
  );

  // Stage 2: Extract entities and relations to memory
  const memoryExtract = simpleLoop(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    { patternId: "memory-extract", maxTurns: 6 },
  );

  // Stage 3: Persist to Neo4j with approval
  const neo4jPersist = withApproval(
    simpleLoop(
      createNeo4jController(tools.neo4j ?? []),
      tools.neo4j ?? [],
      { patternId: "neo4j-persist", schema, maxTurns: 10 },
    ),
    approvalPredicates.mutations,
  );

  const responseSynth = synthesizer({ mode: "thread", patternId: "kg-build-synth" });

  return [webResearch, memoryExtract, neo4jPersist, responseSynth];
}

export const kgBuilderAgent: AgentConfig = {
  id: "kg-builder",
  name: "Knowledge Graph Builder",
  description: "Research topics, extract entities, persist to Neo4j and memory",
  icon: "🕸️",
  servers: ["web_search", "memory", "neo4j-cypher"],
  createPatterns,
};
```

---

## 3. Documentation Assistant

**Pattern:** `simpleLoop → simpleLoop → synthesizer`

Look up library docs via Context7, persist key findings to memory.

```typescript
// Pattern: doc-lookup → memory-store → synthesizer

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();

  // Stage 1: Look up documentation using Context7
  const docLookup = simpleLoop(
    createContext7Controller(tools.context7 ?? []),
    tools.context7 ?? [],
    { patternId: "doc-lookup", maxTurns: 4 },
  );

  // Stage 2: Store key findings in memory
  const memoryStore = simpleLoop(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    { patternId: "memory-store", maxTurns: 3 },
  );

  const responseSynth = synthesizer({ mode: "thread", patternId: "doc-synth" });

  return [docLookup, memoryStore, responseSynth];
}

export const docAssistantAgent: AgentConfig = {
  id: "doc-assistant",
  name: "Documentation Assistant",
  description: "Look up library docs via Context7 and persist findings to memory",
  icon: "📚",
  servers: ["context7", "memory"],
  createPatterns,
};
```

---

## 4. Multi-Source Research

**Pattern:** `parallel → judge → synthesizer`

Concurrent search across multiple sources with quality-based ranking.

```typescript
// Pattern: parallel(web, github, docs) → judge → synthesizer

const judgeEvaluator: EvaluatorFn = async (query, candidates) => {
  const rankings = candidates.map(candidate => {
    const hasContent = candidate.content.length > 100;
    const hasRelevantTerms = query.split(" ").some(term =>
      candidate.content.toLowerCase().includes(term.toLowerCase())
    );
    const score = (hasContent ? 0.5 : 0) + (hasRelevantTerms ? 0.5 : 0);
    return { source: candidate.source, score, reason: "..." };
  });

  rankings.sort((a, b) => b.score - a.score);
  const best = candidates.find(c => c.source === rankings[0]?.source) ?? null;

  return { reasoning: "...", rankings, best };
};

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();

  const webSearch = simpleLoop(createWebSearchController(tools.web ?? []), tools.web ?? [],
    { patternId: "web-search", maxTurns: 3 });
  const githubSearch = simpleLoop(createGitHubController(tools.github ?? []), tools.github ?? [],
    { patternId: "github-search", maxTurns: 3 });
  const docSearch = simpleLoop(createContext7Controller(tools.context7 ?? []), tools.context7 ?? [],
    { patternId: "doc-lookup", maxTurns: 3 });

  // Parallel execution
  const researchPattern = parallel([webSearch, githubSearch, docSearch],
    { patternId: "parallel-research" });

  // Judge to rank results
  const evaluator = judge(judgeEvaluator, { patternId: "quality-judge" });

  const responseSynth = synthesizer({ mode: "response", patternId: "research-synth" });

  return [researchPattern, evaluator, responseSynth];
}

export const multiSourceResearchAgent: AgentConfig = {
  id: "multi-source-research",
  name: "Multi-Source Research",
  description: "Parallel search across web, GitHub, and docs with quality ranking",
  icon: "🔬",
  servers: ["web_search", "github", "context7"],
  createPatterns,
};
```

---

## 5. LLM-as-Judge

**Pattern:** `parallel → judge → synthesizer`

Similar to multi-source research but with sophisticated multi-criteria evaluation.

```typescript
// Judge evaluator with 4 criteria: content, relevance, authority, structure
const qualityJudgeEvaluator: EvaluatorFn = async (query, candidates) => {
  const rankings = [];

  for (const candidate of candidates) {
    let score = 0;
    const reasons = [];

    // Criterion 1: Content length
    if (candidate.content.length > 500) { score += 0.3; reasons.push("Substantial content"); }

    // Criterion 2: Relevance (query terms in content)
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    const matchedTerms = queryTerms.filter(term =>
      candidate.content.toLowerCase().includes(term));
    const relevanceRatio = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;
    score += relevanceRatio * 0.35;

    // Criterion 3: Source authority
    const authorityBonus = { "doc-lookup": 0.25, "github-search": 0.15, "web-search": 0.1 };
    score += authorityBonus[candidate.source] ?? 0;

    // Criterion 4: Structure (code blocks, lists)
    if (candidate.content.includes("```")) { score += 0.1; }

    rankings.push({ source: candidate.source, score: Math.min(score, 1.0), reason: reasons.join("; ") });
  }

  rankings.sort((a, b) => b.score - a.score);
  const best = candidates.find(c => c.source === rankings[0]?.source) ?? null;

  return { reasoning: "...", rankings, best };
};
```

---

## 6. Guardrailed File Editor

**Pattern:** `guardrail(actorCritic + withApproval)`

File editing with 5-layer validation: input, PII, path, tool scope, drift.

```typescript
// Custom rails
const topicalRail: Rail<SessionData> = {
  name: "topical",
  phase: "input",
  check: async ({ input }) => {
    const offTopicPatterns = [/delete.*database/i, /drop.*table/i, /rm\s+-rf/i];
    for (const pattern of offTopicPatterns) {
      if (pattern.test(input)) {
        return { ok: false, reason: "Destructive operation", action: "block" };
      }
    }
    return { ok: true };
  },
};

const toolScopeRail: Rail<SessionData> = {
  name: "tool-scope",
  phase: "execution",
  check: async ({ lastToolCall }) => {
    const allowed = new Set(["read_text_file", "write_file", "edit_file", "list_directory"]);
    const tool = (lastToolCall?.data as { tool: string })?.tool;
    return allowed.has(tool) ? { ok: true } : { ok: false, reason: `Tool '${tool}' not in scope`, action: "block" };
  },
};

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();

  const fileEditor = actorCritic(
    createActorControllerAdapter(tools.filesystem ?? []),
    createCriticAdapter(),
    tools.filesystem ?? [],
    { patternId: "file-edit", maxRetries: 3 },
  );

  const approvedEditor = withApproval(fileEditor, approvalPredicates.mutations);

  // Wrap with guardrails
  const safeEditor = guardrail(approvedEditor, {
    patternId: "safe-file-edit",
    rails: [topicalRail, piiScanRail, pathAllowlistRail, toolScopeRail, driftDetectorRail],
    circuitBreaker: { maxFailures: 3, windowMs: 60_000, cooldownMs: 30_000 },
    onBlock: (rail, reason) => console.warn(`[Guardrail] ${rail} blocked: ${reason}`),
  });

  const responseSynth = synthesizer({ mode: "thread", patternId: "edit-synth" });

  return [safeEditor, responseSynth];
}

export const guardrailedAgent: AgentConfig = {
  id: "guardrailed-agent",
  name: "Guardrailed File Editor",
  description: "File editing with 5-layer validation",
  icon: "🛡️",
  servers: ["rust-mcp-filesystem"],
  createPatterns,
};
```

---

## 7. Conversational Memory

**Pattern:** `sessionTracker → router → memoryWriter → synthesizer` + `hook(distillation)`

Memory as scratchpad with Neo4j KB distillation on session close.

```typescript
async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Session tracker: update turn count in redis
  const sessionTracker = configurePattern(
    "session-tracker",
    async (scope) => {
      const sessionKey = `session:${scope.data.sessionId}`;
      await callTool("hset", { key: sessionKey, field: "lastTurn", value: Date.now().toString() });
      await callTool("expire", { key: sessionKey, seconds: 7200 });
      return scope;
    },
    { patternId: "session-tracker" },
  );

  // Domain patterns
  const neo4jPattern = simpleLoop(createNeo4jController(tools.neo4j ?? []), tools.neo4j ?? [],
    { patternId: "neo4j-query", schema, maxTurns: 5 });
  const webPattern = simpleLoop(createWebSearchController(tools.web ?? []), tools.web ?? [],
    { patternId: "web-search", maxTurns: 4 });

  const routerPattern = router(
    { neo4j: "Knowledge base queries", web_search: "Web lookups" },
    { neo4j: neo4jPattern, web_search: webPattern },
  );

  // Memory writer
  const memoryWriter = simpleLoop(createMemoryController(tools.memory ?? []), tools.memory ?? [],
    { patternId: "memory-write", maxTurns: 3 });

  // Background hook for session close distillation
  const distillationHook = hook(
    configurePattern("distill-chain", async (scope, view) => {
      // Read memory → Persist to KB
      // ...
      return scope;
    }, { patternId: "distill-chain" }),
    { patternId: "session-close-hook", trigger: "session_close", background: true },
  );

  const responseSynth = synthesizer({ mode: "thread", patternId: "memory-synth" });

  return [sessionTracker, routerPattern, memoryWriter, responseSynth, distillationHook];
}

export const conversationalMemoryAgent: AgentConfig = {
  id: "conversational-memory",
  name: "Conversational Memory",
  description: "Memory scratchpad with KB distillation on session close",
  icon: "🧠",
  servers: ["memory", "neo4j-cypher", "web_search", "redis"],
  createPatterns,
};
```

---

## 8-10. Additional Agents

Additional agents follow similar patterns:

- **Issue Triage** (`issue-triage.server.ts`): GitHub issue analysis with labeling
- **Ontology Builder** (`ontology-builder.server.ts`): Schema extraction and evolution
- **Semantic Cache** (`semantic-cache.server.ts`): Redis-backed response caching

---

## Pattern Composition Guidelines

1. **Sequential stages**: Use multiple patterns in the array for pipeline execution
2. **Conditional routing**: Use `router` pattern for intent-based dispatch
3. **Parallel execution**: Use `parallel` pattern for concurrent operations
4. **Validation layers**: Use `guardrail` for input/output/execution validation
5. **User approval**: Use `withApproval` for sensitive operations
6. **Quality control**: Use `actorCritic` for generate-evaluate loops
7. **Response generation**: End with `synthesizer` for human-readable output
8. **Background tasks**: Use `hook` for session lifecycle events
