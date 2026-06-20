/**
 * Code-Mode Agent
 *
 * Dedicated agent for the kg-agent gateway's `code-mode` tool family.
 *
 * Workflow (per harness log at .harness-logs/code_mode_context-cl-28-2026-05-13.json):
 *   `code-mode` is NOT a one-shot JS executor — its args_schema is
 *   `{name: string, servers: string[]}`. Calling it registers a new
 *   gateway tool named `code-mode-<name>` bound to the listed MCP servers,
 *   and that generated tool is what actually runs JS. Sequence:
 *
 *     mcp-find → mcp-add → code-mode({name, servers}) → code-mode-<name>({script})
 *
 *   (`mcp-exec` may be a one-shot escape hatch — its args_schema isn't
 *   captured in this repo. If present, the actor will likely converge on it
 *   instead of the factory dance.)
 *
 * Why a separate agent: the workflow needs `actorCritic`'s retry-with-feedback
 * semantics (the critic steers the actor through find → add → factory → call).
 * `simpleLoop` breaks on the first allowlist failure, which made the previous
 * default-agent code_mode route unable to recover from any step's setup error.
 *
 * Cross-turn tool reuse: `createActorControllerAdapter` is configured with
 * `refreshOnCall + dynamicPattern: /^code-mode-/` so each actor invocation
 * re-lists the gateway and surfaces any code-mode-* tools created in earlier
 * turns. The gateway persists those tools for its process lifetime, so a
 * `code-mode-search-graph` made in turn 1 is callable in turn 2 without
 * re-creating it.
 */
"use server";

import {
  router,
  routes,
  actorCritic,
  synthesizer,
  chain,
  Tools,
  createActorControllerAdapter,
  createCriticAdapter,
  type ConfiguredPattern,
  deserializeContext,
} from "../../harness-patterns";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";
import { getRequestUserId } from "../request-user.server";
import type { FewShot } from "../../../../baml_client/types";
// NOTE: loadSession is imported dynamically inside the closure (not at the
// top level) to avoid a circular import — registry.server.ts imports this
// file, so any value import of session.server.ts would deadlock the
// agent-registration sequence.

const CODE_MODE_TOOLS = ['mcp-find', 'mcp-add', 'code-mode', 'mcp-exec'];

/**
 * Actor-side guidance prepended to the `ActorController` prompt via
 * `createActorControllerAdapter({ contextPrefix })`. Covers the four
 * behaviors the actor needs to do code-mode well. This is shipped as a
 * code-string today; when the harness gains Skill support
 * (issue #86), the same content will live as a Skill the actor
 * receives via the standard mechanism instead.
 */
const CODE_MODE_ACTOR_GUIDANCE = `
The kg-agent gateway exposes a "code-mode" factory tool. Use it to:

1. FACTORY PROTOCOL. Call code-mode with {name, servers} to register a
   server-side script runner named code-mode-<name>. Then call
   code-mode-<name> with {script} to execute JavaScript that can invoke
   any tool from the listed servers (await each call).

2. BATCH OPERATIONS. Write ONE script that performs the whole user
   request (multiple tool calls + transformations + aggregations) instead
   of one round-trip per operation. The factory tool is the leverage —
   under-using it wastes turns.

3. SKIP REDUNDANT DISCOVERY. Tools already present in AVAILABLE TOOLS
   (above) don't need mcp-find or mcp-add — they're loaded.

4. LET THE CRITIC DECIDE COMPLETION. You don't need a Return tool — the
   critic evaluates each result and ends the loop when sufficient. Focus
   on producing the right tool call; don't try to short-circuit.
`.trim();

/**
 * Few-shots span four dimensions: complexity (simple → high), number of
 * servers per script (1 → 2), reasoning pattern (transform, multi-step
 * pipeline, conditional branch, write-back), and final-action shape. They
 * are the actual script bodies passed to `code-mode-<name>({script})` —
 * the factory-creation step before each is implied; we don't waste a
 * few-shot slot on the `{name, servers}` registration call because
 * CONTEXT teaches that protocol verbally.
 *
 * Four selected from a curated set of seven (see code_mode_actor_critic.md
 * § "Few-shot catalog"). The other three (D, E, G) are documented
 * alternates for future iteration but kept off the wire today to avoid
 * over-anchoring small models.
 */
const CODE_MODE_FEW_SHOTS: FewShot[] = [
  // A — Simple: 1 server, read + groupBy. Anchors the minimum viable script.
  {
    user: "How many entities of each type are in the knowledge graph?",
    reasoning:
      "One-server read + transform. Register a code-mode tool bound to memory, then run a tiny script that aggregates by entityType.",
    tool: "code-mode-count_entities_by_type",
    args: JSON.stringify({
      script: [
        "const g = await read_graph({});",
        "const counts = {};",
        "for (const e of g.entities) counts[e.entityType] = (counts[e.entityType] || 0) + 1;",
        "return counts;",
      ].join("\n"),
    }),
  },
  // B — Medium-high: 2 servers, multi-step pipeline. Canonical case the
  // hallucination log botched — show it done right.
  {
    user: "Find the 2 most-connected nodes in the knowledge graph and search the web for related tech for each.",
    reasoning:
      "Two servers (memory + web_search) in one script: read graph → count degree from relations → pick top-2 → loop a web search per name. ONE factory tool, ONE script — not four round-trips.",
    tool: "code-mode-graph_web_analysis",
    args: JSON.stringify({
      script: [
        "const g = await read_graph({});",
        "const deg = new Map();",
        "for (const r of g.relations) { deg.set(r.from, (deg.get(r.from)||0)+1); deg.set(r.to, (deg.get(r.to)||0)+1); }",
        "const top2 = [...deg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([n])=>n);",
        "const out = { top_nodes: top2, searches: {} };",
        "for (const name of top2) { out.searches[name] = await search({query: name + ' related technologies'}); }",
        "return out;",
      ].join("\n"),
    }),
  },
  // C — Medium: 2 servers, conditional branch on cache hit. The only
  // branching example — without it, models default to linear chains.
  {
    user: "Search the web for 'rust async runtimes', but check Redis cache first; if miss, cache for 1 hour.",
    reasoning:
      "Cache-aware lookup. Get from redis; on hit return immediately, on miss run search and write back with TTL. Demonstrates conditional script flow.",
    tool: "code-mode-cached_web_search",
    args: JSON.stringify({
      script: [
        "const key = 'web:rust-async-runtimes';",
        "const cached = await get({name: key});",
        "if (cached) return { source: 'cache', data: JSON.parse(cached) };",
        "const fresh = await search({query: 'rust async runtimes'});",
        "await set({name: key, value: JSON.stringify(fresh), expire_seconds: 3600});",
        "return { source: 'web', data: fresh };",
      ].join("\n"),
    }),
  },
  // F — High: 2 servers, file walk + batch write-back. Stretches the model
  // toward persist patterns and shows parameterized Cypher.
  {
    user: "Walk ./docs, extract '##' headings from each .md, persist each as a Concept node linked to its source Doc.",
    reasoning:
      "Read-many → parse → one batch write. Collect all (concept, doc) pairs first, then UNWIND them in a single parameterized Cypher MERGE — cheaper than per-pair round-trips.",
    tool: "code-mode-docs_to_graph",
    args: JSON.stringify({
      script: [
        "const files = await list_directory({path: './docs'});",
        "const ops = [];",
        "for (const f of files.filter(x => x.endsWith('.md'))) {",
        "  const body = await read_text_file({path: './docs/' + f});",
        "  const heads = [...body.matchAll(/^##\\s+(.+)$/gm)].map(m => m[1]);",
        "  for (const h of heads) ops.push({concept: h, doc: f});",
        "}",
        "const query = 'UNWIND $ops AS op MERGE (d:Doc {path: op.doc}) MERGE (c:Concept {name: op.concept}) MERGE (c)-[:DEFINED_IN]->(d)';",
        "await write_neo4j_cypher({query, params: {ops}});",
        "return { docs_processed: files.length, concepts_created: ops.length };",
      ].join("\n"),
    }),
  },
];

async function createPatterns(sessionId: string): Promise<ConfiguredPattern<SessionData>[]> {
  // Resolve the meta-tool subset live each call instead of snapshotting at
  // construction. The previous design captured `tools.all` once at
  // `createPatterns()` time — if the gateway was unreachable then
  // (post-restart with a stale singleton, etc.), the snapshot stayed empty
  // forever and every actor turn got rejected by the allowlist. Now the
  // closure re-runs `Tools()` per invocation; combined with
  // `mcp-client.server.ts`'s `withReconnect`, a transient gateway outage
  // resolves on the next actor turn instead of poisoning the session.
  const getDefaultCodeTools = async (): Promise<string[]> => {
    const tools = await Tools();
    return CODE_MODE_TOOLS.filter((t) => tools.all.includes(t));
  };

  // One-shot snapshot for actorCritic's `tools` argument (the static side of
  // the allowlist check). May be empty if the gateway is down at startup —
  // that's fine because the per-call `dynamicToolAllowlist` below always
  // re-resolves and is consulted on every actor turn.
  const initialDefaults = await getDefaultCodeTools();

  // Resolves the actor's tool allowlist live per invocation. Reads the
  // user's per-conversation selection from data.codeModeAllowedTools (set
  // by the Tools tab via setCodeModeAllowedTools) and unions it with the
  // meta-tools the actor always needs. When no userId scope is active
  // (defensive — should never happen during a real turn) or no selection
  // exists yet, falls back to the meta-tools alone.
  const toolNamesProvider = async (): Promise<string[]> => {
    const defaults = await getDefaultCodeTools();
    const userId = getRequestUserId();
    if (!userId) return defaults;
    try {
      const { loadSession } = await import("../session.server");
      const loaded = await loadSession(sessionId, userId);
      if (!loaded) return defaults;
      const ctx = deserializeContext<SessionData>(loaded.serializedContext);
      const allowed = ctx.data?.codeModeAllowedTools;
      if (!allowed || allowed.length === 0) return defaults;
      // User picks *additions*; meta-tools are always reachable so the
      // agent's factory dance still works even with a sparse selection.
      return Array.from(new Set([...defaults, ...allowed]));
    } catch {
      return defaults;
    }
  };

  const actor = createActorControllerAdapter({
    toolNamesProvider,
    // Surface any `code-mode-<name>` tool the gateway has registered. This
    // covers both intra-turn re-attempts (after the factory creates a tool)
    // and cross-turn reuse (tools created in prior user turns persist on the
    // gateway and reappear in fresh listTools calls).
    dynamicPattern: /^code-mode-/,
    refreshOnCall: true,
    // Teach the actor about the factory protocol + batching heuristic.
    // See code_mode_actor_critic.md and the constants above for rationale.
    contextPrefix: CODE_MODE_ACTOR_GUIDANCE,
    fewShots: CODE_MODE_FEW_SHOTS,
  });
  const critic = createCriticAdapter();

  const loop = actorCritic<SessionData>(actor, critic, initialDefaults, {
    patternId: "code-mode-loop",
    liveEvents: true,
    // Allow actorCritic to dispatch dynamically-created tools whose names
    // start with `code-mode-` (factory output) without listing them in `tools`.
    dynamicToolPattern: /^code-mode-/,
    // Keep the strict allowlist in sync with what the actor's prompt
    // advertises. Same provider closure as above so user-curated additions
    // pass the loop's tool-allowed check (actorCritic.server.ts:117).
    dynamicToolAllowlist: toolNamesProvider,
    // Factory happy path is `mcp-find → mcp-add → code-mode → code-mode-<name>`
    // = 4 productive turns minimum; multi-server prompts add a second find/add
    // pair. Default 3 (settings.ts) exhausts the loop before any useful work.
    maxRetries: 8,
  });

  // Synthesizer that reads actor-side events from the loop plus any error
  // event the loop emitted (e.g. "Max retries (8) exceeded"). `thread` mode
  // naturally consumes only `controller_action` + `tool_call` + `tool_result`
  // via `view.tools()` / `view.actions()`, but `viewConfig.eventTypes` pins
  // the filter explicitly so `critic_result` stays out of the prompt. We
  // include 'error' so `view.hasErrors()` / `view.lastError()` surface a
  // loop-exhaustion signal to the BAML Synthesize template — without it the
  // synthesizer would happily fabricate a confident answer over an incomplete
  // trace (see hallucination-code-mode.json: Max retries fired, synth invented
  // node names and fake web search results). The error scoping is naturally
  // bounded by this synthesizer's own view window — see harness-patterns
  // README "Error scoping" note.
  const synth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "code-mode-synth",
    liveEvents: true,
    viewConfig: {
      eventTypes: ["controller_action", "tool_call", "tool_result", "error"],
    },
  });

  const codeChain = chain<SessionData>(loop, synth);

  const routerPattern = router<SessionData>(
    {
      code_mode:
        "Compose JavaScript that orchestrates multiple MCP tools — the gateway runs it server-side via the code-mode factory",
    },
    { liveEvents: true },
  );

  const routesPattern = routes<SessionData>(
    { code_mode: codeChain },
    { liveEvents: true },
  );

  // No top-level synthesizer: the inner chain handles the code_mode branch's
  // response; the direct-response branch sets `scope.data.response` inside
  // `routeMessageOp` and `routes()` passes through.
  return [routerPattern, routesPattern];
}

export const codeModeAgent: AgentConfig = {
  id: "code-mode",
  name: "Code Mode Agent",
  description:
    "Orchestrate multiple MCP tools via JavaScript scripts run by the kg-agent gateway",
  icon: "📜",
  servers: ["kg-agent-mcp-gateway"],
  createPatterns,
};
