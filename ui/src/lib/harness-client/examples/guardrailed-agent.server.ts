/**
 * Guardrailed Agent
 *
 * Pattern: guardrail(actorCritic + withApproval)
 * Use case: File editing agent with multiple validation layers.
 */
"use server";

import {
  actorCritic,
  withApproval,
  guardrail,
  synthesizer,
  piiScanRail,
  pathAllowlistRail,
  driftDetectorRail,
  Tools,
  createActorControllerAdapter,
  createCriticAdapter,
  approvalPredicates,
  type ConfiguredPattern,
  type Rail,
} from "../../harness-patterns";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

/**
 * Topical rail: reject off-topic requests
 */
const topicalRail: Rail<SessionData> = {
  name: "topical",
  phase: "input",
  check: async ({ input }) => {
    const offTopicPatterns = [
      /delete.*database/i,
      /drop.*table/i,
      /rm\s+-rf/i,
      /format.*drive/i,
    ];

    for (const pattern of offTopicPatterns) {
      if (pattern.test(input)) {
        return {
          ok: false,
          reason: "Request appears to be a destructive system operation",
          action: "block",
        };
      }
    }

    return { ok: true };
  },
};

/**
 * Tool scope rail: only allow filesystem tools
 */
const toolScopeRail: Rail<SessionData> = {
  name: "tool-scope",
  phase: "execution",
  check: async ({ lastToolCall }) => {
    const data = lastToolCall?.data as { tool: string } | undefined;
    if (!data?.tool) return { ok: true };

    const allowed = new Set([
      "read_text_file",
      "write_file",
      "edit_file",
      "list_directory",
      "directory_tree",
      "search_files",
      "search_files_content",
      "get_file_info",
      "read_file_lines",
      "head_file",
      "tail_file",
    ]);

    return allowed.has(data.tool)
      ? { ok: true }
      : { ok: false, reason: `Tool '${data.tool}' not in scope`, action: "block" };
  },
};

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();

  // File editing pattern with actor-critic
  const fileEditor = actorCritic<SessionData>(
    createActorControllerAdapter(tools.filesystem ?? []),
    createCriticAdapter(),
    tools.filesystem ?? [],
    { patternId: "file-edit", maxRetries: 3 },
  );

  // Add approval for mutations
  const approvedEditor = withApproval<SessionData>(
    fileEditor,
    approvalPredicates.mutations,
  );

  // Wrap with guardrails
  const safeEditor = guardrail<SessionData>(approvedEditor, {
    patternId: "safe-file-edit",
    rails: [
      topicalRail,
      piiScanRail,
      pathAllowlistRail,
      toolScopeRail,
      driftDetectorRail,
    ],
    circuitBreaker: {
      maxFailures: 3,
      windowMs: 60_000,
      cooldownMs: 30_000,
    },
    onBlock: (rail, reason) => {
      console.warn(`[Guardrail] ${rail} blocked: ${reason}`);
    },
  });

  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "edit-synth",
  });

  return [safeEditor, responseSynth];
}

export const guardrailedAgent: AgentConfig = {
  id: "guardrailed-agent",
  name: "Guardrailed File Editor",
  description: "File editing with 5-layer validation: input, PII, path, tool scope, drift",
  icon: "🛡️",
  servers: ["rust-mcp-filesystem"],
  createPatterns,
};
