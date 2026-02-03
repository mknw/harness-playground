/**
 * Documentation Assistant Agent
 *
 * Multi-stage lookup: context7 → memory → synthesizer
 * Use case: Look up library documentation, persist key findings to memory.
 */
"use server";

import {
  simpleLoop,
  synthesizer,
  Tools,
  createContext7Controller,
  createMemoryController,
  type ConfiguredPattern,
} from "../../harness-patterns";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();

  // Stage 1: Look up documentation using Context7
  const docLookup = simpleLoop<SessionData>(
    createContext7Controller(tools.context7 ?? []),
    tools.context7 ?? [],
    {
      patternId: "doc-lookup",
      maxTurns: 4,
    },
  );

  // Stage 2: Store key findings in memory
  const memoryStore = simpleLoop<SessionData>(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    {
      patternId: "memory-store",
      maxTurns: 3,
    },
  );

  // Stage 3: Synthesize response
  const responseSynth = synthesizer<SessionData>({
    mode: "thread",
    patternId: "doc-synth",
  });

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
