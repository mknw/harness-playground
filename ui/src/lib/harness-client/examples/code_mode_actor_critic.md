# Code Mode Agent — actorCritic engineering

> **File:** `code-mode.server.ts` · **Pattern:** `router → routes(chain(actorCritic, synthesizer))`
> **Issue:** [#12](https://github.com/mknw/harness-playground/issues/12)

The code-mode agent orchestrates multi-step MCP tool work by writing
JavaScript that the kg-agent gateway runs server-side. Unlike the default
agent's per-route `simpleLoop` shape, code-mode's loop is `actorCritic`
because the workflow needs retry-with-feedback semantics — the factory
dance has many ways to go wrong on the first try and `simpleLoop` would
break on the first allowlist failure.

This doc covers the actor-side engineering: the prompt prelude, the
few-shots, the budget signal, and the synthesizer's error visibility.

---

## The factory tool

The gateway's `code-mode` tool is a **factory**. Its `args_schema` is
`{name, servers}`, and a successful call registers a new tool
`code-mode-<name>` bound to those servers. That generated tool is what
actually runs JavaScript:

```
mcp-find* → mcp-add* → code-mode({name, servers}) → code-mode-<name>({script})
```

Inside the script, every tool from the listed servers is callable as a
top-level async function (`await read_graph({})`, `await search({query})`,
etc.). One script can chain many operations server-side — that's the
leverage, and the failure mode the actor's prompt is engineered to avoid
is *under-using* it (treating `code-mode-<name>` as a thin shim around a
single tool call, exhausting the retry budget on discovery instead).

---

## Actor prompt engineering

Three additions to the generic `ActorController` BAML function
(`baml_src/actorCritic.baml`), all already used by `LoopController`:

1. **`context: string?`** — the adapter's `contextPrefix` option lands here
   and renders under a `CONTEXT:` heading. We use it for code-mode-specific
   guidance (see `CODE_MODE_ACTOR_GUIDANCE` in `code-mode.server.ts`).
2. **`few_shots: FewShot[]?`** — adapter's `fewShots` option. Two
   illustrative examples: one showing the factory `{name, servers}` call,
   one showing a multi-step script inside `code-mode-<name>({script})`. We
   keep it to two so a small model isn't over-anchored on the example
   wording.
3. **`attempt_n: int?` / `max_attempts: int?`** — `actorCritic.server.ts`
   passes the current `attempt + 1` and the configured `maxRetries` so the
   prompt can render `BUDGET: Attempt N of M` and, when N approaches M,
   nudge the actor toward `Return` with whatever partial results it has.

### What the guidance teaches

The prelude covers four behaviors, in priority order:

| # | Rule | Why it's there |
|---|---|---|
| 1 | Factory protocol: `code-mode {name, servers}` → `code-mode-<name>({script})` | Without this the actor doesn't know the factory step exists and tries `mcp-exec` as a shim. |
| 2 | Write ONE script that batches multiple operations server-side | The failure case (`hallucination-code-mode.json`) was the actor calling `code-mode-<name>` with `return read_graph({})` — a one-liner that dumped data instead of doing the full pipeline. |
| 3 | Skip `mcp-find` / `mcp-add` for tools already in `AVAILABLE TOOLS` | The user's per-conversation allowlist pre-loads tools; rediscovery wastes turns. |
| 4 | Return when done or near budget exhaustion | Combined with the `BUDGET:` line from Decision 3, this lets the actor wrap partial work into a final answer instead of being cut off mid-thought. |

---

## Few-shot catalog

Seven candidate few-shots were authored against the live gateway and vetted
for tool availability. Four ship today (in `CODE_MODE_FEW_SHOTS`); three
are documented alternates kept off the wire to avoid over-anchoring small
models. They're listed here so a future iteration (or a Skill migration —
see roadmap) can swap them in without re-discovery.

Selection criteria: vary **complexity** (simple → high), **server count
per script** (1–2), and **reasoning pattern** (transform · pipeline ·
branch · write-back · external-distill · search-fetch · multi-source join).

| ID | Status | Request | Servers | Reasoning |
|----|--------|---------|---------|-----------|
| **A** | ✅ shipped | "How many entities of each type are in the knowledge graph?" | memory | Read + groupBy |
| **B** | ✅ shipped | "Find the 2 most-connected nodes and search the web for related tech for each." | memory + web_search | Read → compute → loop with external |
| **C** | ✅ shipped | "Search the web for 'rust async runtimes' — check Redis cache first; cache for 1h on miss." | redis + web_search | Conditional branch on cache hit |
| **D** | alternate | "Look up SolidJS `createSignal` docs and save the key facts as a memory entity." | context7 + memory | External lookup → distill → persist |
| **E** | alternate | "Search 'WebAssembly 2026 spec changes' — return top-3 with title + first paragraph." | web_search (multi-step) | Search → iterate → fetch → extract |
| **F** | ✅ shipped | "Walk `./docs`, extract `##` headings from each `.md`, persist each as a `Concept` node linked to its `Doc`." | rust-mcp-filesystem + neo4j-cypher | File walk → parse → batch write |
| **G** | alternate | "List my last 5 PRs in repo X; mark any Concept node whose name appears in the PR body." | github + neo4j-cypher | Multi-source join + conditional write |

**Why these four ship and the rest don't:**

- **A** anchors the minimum-viable shape. Small LLMs need to see "even a one-server query goes through the factory."
- **B** is the canonical multi-server pipeline and the exact case the original hallucination log botched — keeping it front-and-centre.
- **C** is the only conditional/branching example. Without it, models default to linear chains.
- **F** is the most complex (write-back via parameterized Cypher) and stretches the model toward persistence patterns.
- **D** overlaps with A's read-and-transform shape and adds context7-specific noise.
- **E** is a weaker version of B (no in-graph computation).
- **G** is GitHub-specific and most users won't have that context loaded.

**Note on F (write-back) and execution environment:** F writes to Neo4j
via the standard MCP tool, but a parallel concern — what host-side write
capability does the JS *itself* have (Node fs? V8 isolate? sandbox?) — is
unresolved and tracked in
[#64](https://github.com/mknw/harness-playground/issues/64). That issue's
outcome may change whether a future few-shot can write to local files
directly (e.g. dumping a report to disk) or whether such work must
always route through an MCP server.

---

## Synthesizer error visibility

`synthesizer.server.ts` already calls `view.hasErrors()` /
`view.lastError()` and passes both to the BAML `Synthesize` template. The
template's behavior changes when `hasError` is true (it should report the
limitation honestly rather than fabricate). The code-mode synthesizer
explicitly opts into seeing error events through its `ViewConfig`:

```ts
viewConfig: {
  eventTypes: ["controller_action", "tool_call", "tool_result", "error"],
}
```

`critic_result` is deliberately excluded so the critic's reasoning doesn't
leak into the user-facing response — but `error` is in, so
`view.hasErrors()` surfaces a loop-exhaustion signal. Without this, a
`Max retries exceeded` event was silently filtered and the synthesizer
invented confident-but-fake content over incomplete tool results (see
`.harness-logs/hallucination-code-mode.json`).

Error scoping is naturally bounded by the synthesizer's own view window —
see the "Error scoping" note in
[`ui/src/lib/harness-patterns/README.md`](../../harness-patterns/README.md).

---

## Per-conversation tool allowlist

The actor's tool list isn't fixed at agent-construction time. The Tools
tab persists the user's selection on `data.codeModeAllowedTools` (rides in
the conversation's JSONB context blob). The adapter resolves the list
fresh per actor invocation via a `toolNamesProvider` async closure that
loads the conversation and unions the user's picks with the four required
meta-tools (`mcp-find`, `mcp-add`, `code-mode`, `mcp-exec`).

This means checkbox changes take effect on the **next actor turn** without
a pattern rebuild — see `code-mode.server.ts`'s `toolNamesProvider`
closure and `baml-adapters.server.ts`'s `ActorAdapterOptions`.

`actorCritic.server.ts` mirrors the same provider on the loop's strict
allowlist check via `dynamicToolAllowlist`, so the prompt and the runtime
gate stay in sync.

---

## Future: migrate guidance to a Skill

Once the harness gains Skill support (see [`docs/ROADMAP.md`](../../../../../docs/ROADMAP.md)
§ Harness pattern: Skill support), the four-point guidance + few-shots
move out of `code-mode.server.ts` into a reusable Skill the actor receives
via the standard mechanism. The shape stays the same (text + few-shots
+ optional budget signal); the storage location changes from "inline
const in the agent file" to "registered Skill". Other actorCritic agents
(`guardrailed-agent`, `ontology-builder`) can adopt the same migration
path for their domain-specific guidance.

---

## Files

| File | Role |
|---|---|
| `code-mode.server.ts` | Agent definition: actor + critic, factory tool wiring, contextPrefix + fewShots, per-conversation allowlist closure, synthesizer with `error` in view. |
| `baml_src/actorCritic.baml` · `ActorController` | BAML function with `context`, `few_shots`, `attempt_n`, `max_attempts` fields. |
| `lib/harness-patterns/baml-adapters.server.ts` · `createActorControllerAdapter` | Adapter options: `contextPrefix`, `fewShots`, `toolNamesProvider`. |
| `lib/harness-patterns/patterns/actorCritic.server.ts` | Threads `attempt + 1` / `maxRetries` into the actor call; consults `dynamicToolAllowlist` per turn. |
| `__tests__/agents/code-mode.test.ts` | E2E-shaped: factory workflow, direct-response branch, retry-budget regression, per-conversation allowlist passthrough. |
