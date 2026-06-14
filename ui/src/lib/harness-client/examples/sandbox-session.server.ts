/**
 * Sandbox Session Agent (persistent)
 *
 * Like the Sandbox Demo agent, but the sandbox is **session-persistent**:
 * `withSandbox({ id: sessionId })` keys the VM to the conversation via the
 * shared AttachmentTable, so every turn reuses the same container with its
 * /work files, installed packages, and env intact — and it's the *same*
 * container the interactive Shell terminal attaches to (the PTY manager keys
 * on sessionId too). Write a file with the agent, then `cat` it in the
 * Terminal tab's Shell; both see one workspace.
 *
 * Contrast with `sandbox-demo` (ephemeral): there each turn gets a fresh,
 * reset VM. Pick this agent when follow-ups should build on prior state.
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

const SANDBOX_SESSION_GUIDANCE = `
You have a PERSISTENT Linux sandbox for this conversation. Files, installed
packages, and shell state under /work survive across turns, and you share
this workspace with the user's interactive terminal — they may inspect or
edit files you create, and you can pick up where a previous turn left off.

Available tools (all run inside the sandbox VM):
- sandbox_bash: run a shell command. Python 3 is available.
- sandbox_write / sandbox_read / sandbox_edit: manage files under /work.
- sandbox_list / sandbox_search: inspect the working directory.

Guidance:
1. Build incrementally — reuse files and results from earlier turns instead
   of recreating them. Check what's already in /work before starting fresh.
2. For anything computational, run code in the sandbox rather than guessing.
3. When you have the answer, call Return with the result and a short summary.
`.trim();

async function createPatterns(sessionId: string): Promise<ConfiguredPattern<SessionData>[]> {
  const actor = createActorControllerAdapter({
    contextPrefix: SANDBOX_SESSION_GUIDANCE,
  });
  const critic = createCriticAdapter();

  const loop = actorCritic<SessionData>(actor, critic, [], {
    patternId: "sandbox-session-loop",
    availableTools: [],
    liveEvents: true,
    maxRetries: 6,
  });

  // id: sessionId → the attachment table keys this VM to the conversation, so
  // it persists across turns AND is the same container the Shell terminal
  // attaches to (PtyManager keys on sessionId). Release decrements refCount
  // without resetting, so /work survives between turns.
  const sandboxedLoop = withSandbox({
    id: sessionId,
    sessionId,
    rootfs: "base",
    egress: "mcp-only",
  })(loop);

  const synth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "sandbox-session-synth",
    liveEvents: true,
    viewConfig: {
      eventTypes: ["user_message", "controller_action", "tool_call", "tool_result", "error"],
    },
  });

  return [sandboxedLoop, synth];
}

export const sandboxSessionAgent: AgentConfig = {
  id: "sandbox-session",
  name: "Sandbox · Session",
  description:
    "Persistent sandbox VM shared across turns and with the interactive Shell — build incrementally, inspect files live.",
  icon: "🖥️",
  servers: [],
  createPatterns,
};
