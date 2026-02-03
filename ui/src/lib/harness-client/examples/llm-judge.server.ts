/**
 * LLM-as-Judge Agent
 *
 * Pattern: parallel → judge → synthesizer
 * Use case: Retrieve competing answers, have an LLM rank them by quality.
 */
"use server";

import {
  simpleLoop,
  parallel,
  judge,
  synthesizer,
  Tools,
  createWebSearchController,
  createContext7Controller,
  createGitHubController,
  type ConfiguredPattern,
  type EvaluatorFn,
} from "../../harness-patterns";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

/**
 * Sophisticated judge evaluator that scores results on multiple criteria.
 */
const qualityJudgeEvaluator: EvaluatorFn = async (query, candidates) => {
  const rankings: Array<{ source: string; score: number; reason: string }> = [];

  for (const candidate of candidates) {
    let score = 0;
    const reasons: string[] = [];

    // Criterion 1: Content length (substantive answers)
    const contentLength = candidate.content.length;
    if (contentLength > 500) {
      score += 0.3;
      reasons.push("Substantial content");
    } else if (contentLength > 100) {
      score += 0.15;
      reasons.push("Moderate content");
    }

    // Criterion 2: Relevance (query terms in content)
    const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    const matchedTerms = queryTerms.filter((term) =>
      candidate.content.toLowerCase().includes(term)
    );
    const relevanceRatio = queryTerms.length > 0
      ? matchedTerms.length / queryTerms.length
      : 0;
    score += relevanceRatio * 0.35;
    if (relevanceRatio > 0.5) {
      reasons.push(`High relevance (${Math.round(relevanceRatio * 100)}% terms matched)`);
    }

    // Criterion 3: Source authority
    const authorityBonus: Record<string, number> = {
      "doc-lookup": 0.25, // Official docs are most authoritative
      "github-search": 0.15, // Code examples are valuable
      "web-search": 0.1, // General web is less authoritative
    };
    const sourceBonus = authorityBonus[candidate.source] ?? 0;
    score += sourceBonus;
    if (sourceBonus > 0) {
      reasons.push(`Authoritative source (${candidate.source})`);
    }

    // Criterion 4: Structure (code blocks, lists, etc.)
    if (candidate.content.includes("```")) {
      score += 0.1;
      reasons.push("Contains code examples");
    }
    if (/\n[-*]\s/.test(candidate.content)) {
      score += 0.05;
      reasons.push("Structured with lists");
    }

    // Cap score at 1.0
    score = Math.min(score, 1.0);

    rankings.push({
      source: candidate.source,
      score: Math.round(score * 100) / 100,
      reason: reasons.length > 0 ? reasons.join("; ") : "Minimal criteria met",
    });
  }

  // Sort by score descending
  rankings.sort((a, b) => b.score - a.score);

  const best = rankings.length > 0
    ? candidates.find((c) => c.source === rankings[0].source) ?? null
    : null;

  return {
    reasoning: `Evaluated ${candidates.length} sources on content quality, relevance, authority, and structure. ` +
      `Best source: ${rankings[0]?.source ?? "none"} with score ${rankings[0]?.score ?? 0}`,
    rankings,
    best,
  };
};

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();

  // Create source patterns
  const webSearch = simpleLoop<SessionData>(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "web-search", maxTurns: 3 },
  );

  const docLookup = simpleLoop<SessionData>(
    createContext7Controller(tools.context7 ?? []),
    tools.context7 ?? [],
    { patternId: "doc-lookup", maxTurns: 3 },
  );

  const githubSearch = simpleLoop<SessionData>(
    createGitHubController(tools.github ?? []),
    tools.github ?? [],
    { patternId: "github-search", maxTurns: 3 },
  );

  // Parallel search across all sources
  const sources = parallel<SessionData>(
    [webSearch, docLookup, githubSearch],
    { patternId: "parallel-sources" },
  );

  // Judge to rank and select best
  const evaluator = judge<SessionData>(qualityJudgeEvaluator, {
    patternId: "quality-judge",
  });

  const responseSynth = synthesizer<SessionData>({
    mode: "response",
    patternId: "judge-synth",
  });

  return [sources, evaluator, responseSynth];
}

export const llmJudgeAgent: AgentConfig = {
  id: "llm-judge",
  name: "LLM-as-Judge",
  description: "Multi-source retrieval with quality-based ranking",
  icon: "⚖️",
  servers: ["web_search", "context7", "github"],
  createPatterns,
};
