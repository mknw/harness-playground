/**
 * Sandbox Demo Agent
 *
 * The simplest end-to-end exercise of the compute sandbox (#79): an
 * `actorCritic` loop wrapped in `withSandbox`, followed by a synthesizer.
 *
 * The actor sees no host-gateway tools — its entire toolset is the in-VM
 * `sandbox_*` surface (filesystem + shell), surfaced into its prompt by the
 * BAML adapter from the active AsyncLocalStorage sandbox scope. Every tool
 * call routes to the isolated VM over `docker exec` stdio; nothing touches
 * the host gateway. The critic steers the actor (write a script → run it →
 * accept once the result is in hand); the synthesizer reads the tool_result
 * trace and reports the answer.
 *
 * Because the loop runs with `liveEvents: true`, each `tool_call` /
 * `tool_result` streams to the UI as it happens — the existing observability
 * timeline shows the sandbox commands and their stdout live, and the
 * Terminal panel filters that same stream down to the `sandbox_*` calls.
 *
 * Requires the `kg-sandbox:base` image (see rootfs/README.md) and a reachable
 * Docker engine on the host running the dev server.
 */
"use server";

import {
  actorCritic,
  synthesizer,
  createActorControllerAdapter,
  createCriticAdapter,
  type ConfiguredPattern,
} from "../../harness-patterns";
import { withSandbox } from "../../sandbox/with-sandbox.server";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

/**
 * Actor guidance prepended to the prompt. Teaches the actor that it has a
 * real Linux sandbox and should compute answers by running code, not by
 * reasoning over them. Mirrors the `contextPrefix` mechanism the code-mode
 * agent uses.
 */
const SANDBOX_ACTOR_GUIDANCE = `
You have an isolated Linux sandbox. Use it to compute answers by running
code rather than reasoning about them in your head.

Available tools (all run inside the sandbox VM):
- sandbox_bash: run a shell command. Python 3 is available — e.g.
  sandbox_bash({ command: "python3 -c '...'" }) or run a script you wrote.
- sandbox_write / sandbox_read / sandbox_edit: manage files under /work.
- sandbox_list / sandbox_search: inspect the working directory.

Guidance:
1. For anything computational (counting, parsing, math, data wrangling),
   write or run code in the sandbox — don't guess the result.
2. Files live under /work; the shell's cwd defaults there.
3. When you have the answer, call Return with the result and a short summary.
   Don't keep calling tools past that point.
`.trim();

async function createPatterns(sessionId: string): Promise<ConfiguredPattern<SessionData>[]> {
  // No host-gateway tools — the actor's toolset is the in-VM sandbox_* surface,
  // injected into its prompt from the active sandbox scope by the adapter.
  const actor = createActorControllerAdapter({
    contextPrefix: SANDBOX_ACTOR_GUIDANCE,
  });
  const critic = createCriticAdapter();

  const loop = actorCritic<SessionData>(actor, critic, [], {
    patternId: "sandbox-loop",
    availableTools: [],
    liveEvents: true,
    maxRetries: 6,
  });

  // The sandbox lives for the loop's duration: boot/pool-acquire on entry,
  // reset-and-park (or destroy) on exit. The synthesizer that follows reads
  // the recorded tool_result events — it doesn't need the VM, so it stays
  // outside the wrapper.
  const sandboxedLoop = withSandbox({
    rootfs: "base",
    sessionId,
    egress: "mcp-only",
  })(loop);

  const synth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "sandbox-synth",
    liveEvents: true,
    viewConfig: {
      eventTypes: ["controller_action", "tool_call", "tool_result", "error"],
    },
  });

  return [sandboxedLoop, synth];
}

export const sandboxDemoAgent: AgentConfig = {
  id: "sandbox-demo",
  name: "Sandbox Demo",
  description:
    "Runs an actor-critic loop inside an isolated Docker sandbox VM — Python via sandbox_bash, files under /work.",
  icon: "🧪",
  // No host MCP servers — tools come from the in-VM filesystem + shell servers.
  servers: [],
  createPatterns,
};
