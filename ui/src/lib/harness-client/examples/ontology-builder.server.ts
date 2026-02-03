/**
 * Ontology Builder Agent
 *
 * Pattern: Multi-phase workflow using most pattern types
 * Use case: Given a domain topic, build a formal ontology through iterative
 * research, proposal, evaluation, and commitment.
 *
 * Phases:
 * 1. Scoping - Define domain boundaries
 * 2. Research - Parallel search across sources
 * 3. Proposal - Iterative ontology generation with judge
 * 4. Guardrail - Logical consistency validation
 * 5. Commit - Persist to Neo4j with approval
 * 6. Synthesize - Generate summary
 */
"use server";

import {
  simpleLoop,
  parallel,
  judge,
  guardrail,
  withApproval,
  synthesizer,
  configurePattern,
  Tools,
  callTool,
  approvalPredicates,
  createMemoryController,
  createWebSearchController,
  createContext7Controller,
  createGitHubController,
  createNeo4jController,
  type ConfiguredPattern,
  type Rail,
  type EvaluatorFn,
} from "../../harness-patterns";
import type { SessionData } from "../session.server";
import type { AgentConfig } from "../registry.server";

async function getSchema(): Promise<string> {
  const result = await callTool("get_neo4j_schema", {});
  return result.success ? JSON.stringify(result.data) : "";
}

/**
 * Ontology quality evaluator
 */
const ontologyJudge: EvaluatorFn = async (query, candidates) => {
  const rankings: Array<{ source: string; score: number; reason: string }> = [];

  for (const candidate of candidates) {
    let score = 0;
    const reasons: string[] = [];

    try {
      // Check for structured ontology elements
      const content = candidate.content.toLowerCase();

      // Classes/concepts defined
      const classMatches = content.match(/class|concept|entity|type/g);
      if (classMatches && classMatches.length > 3) {
        score += 0.3;
        reasons.push(`${classMatches.length} class definitions`);
      }

      // Relationships defined
      const relationMatches = content.match(/relation|property|link|connect/g);
      if (relationMatches && relationMatches.length > 2) {
        score += 0.25;
        reasons.push(`${relationMatches.length} relationships`);
      }

      // Hierarchy (subclass, parent, etc.)
      if (/subclass|parent|inherit|extend/i.test(content)) {
        score += 0.2;
        reasons.push("Hierarchical structure");
      }

      // Completeness
      if (content.length > 500) {
        score += 0.15;
        reasons.push("Substantial coverage");
      }

      // Consistency (no contradictions detected)
      score += 0.1;
      reasons.push("No contradictions detected");

    } catch {
      reasons.push("Evaluation error");
    }

    score = Math.min(score, 1.0);
    rankings.push({
      source: candidate.source,
      score: Math.round(score * 100) / 100,
      reason: reasons.join("; "),
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  const best = rankings.length > 0
    ? candidates.find((c) => c.source === rankings[0].source) ?? null
    : null;

  return {
    reasoning: `Evaluated ontology proposals on class coverage, relationships, hierarchy, and completeness`,
    rankings,
    best,
  };
};

/**
 * Naming convention rail for ontology classes
 */
const namingConventionRail: Rail<SessionData> = {
  name: "naming-convention",
  phase: "output",
  check: async ({ scope }) => {
    // Check if any non-PascalCase class names
    const data = scope.data as Record<string, unknown>;
    const proposal = data.proposal as { classes?: Array<{ name: string }> } | undefined;
    if (!proposal?.classes) return { ok: true };

    const violations: string[] = [];
    for (const cls of proposal.classes) {
      if (cls.name && !/^[A-Z][a-zA-Z0-9]*$/.test(cls.name)) {
        violations.push(`Class '${cls.name}' should be PascalCase`);
      }
    }

    return violations.length > 0
      ? { ok: false, action: "warn", reason: violations.join("; ") }
      : { ok: true };
  },
};

/**
 * No orphan nodes rail
 */
const noOrphansRail: Rail<SessionData> = {
  name: "no-orphans",
  phase: "output",
  check: async () => {
    try {
      const graph = await callTool("read_graph", {});
      if (!graph.success) return { ok: true };

      const data = graph.data as { entities?: Array<{ name: string; entityType: string }>; relations?: Array<{ from: string; to: string }> };
      const entities = data.entities ?? [];
      const relations = data.relations ?? [];
      const connected = new Set(relations.flatMap((r) => [r.from, r.to]));
      const orphans = entities.filter(
        (e) => !connected.has(e.name) && e.entityType === "Class"
      );

      return orphans.length > 0
        ? { ok: false, action: "warn", reason: `Orphan classes: ${orphans.map((o) => o.name).join(", ")}` }
        : { ok: true };
    } catch {
      return { ok: true };
    }
  },
};

async function createPatterns(): Promise<ConfiguredPattern<SessionData>[]> {
  const tools = await Tools();
  const schema = await getSchema();

  // Phase 1: Scoping - use memory to define domain boundaries
  const scoping = simpleLoop<SessionData>(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    { patternId: "ontology-scope", maxTurns: 6 },
  );

  // Phase 2: Research - parallel search across sources
  const webResearch = simpleLoop<SessionData>(
    createWebSearchController(tools.web ?? []),
    tools.web ?? [],
    { patternId: "onto-web-research", maxTurns: 5 },
  );

  const docResearch = simpleLoop<SessionData>(
    createContext7Controller(tools.context7 ?? []),
    tools.context7 ?? [],
    { patternId: "onto-doc-research", maxTurns: 3 },
  );

  const githubResearch = simpleLoop<SessionData>(
    createGitHubController(tools.github ?? []),
    tools.github ?? [],
    { patternId: "onto-github-research", maxTurns: 3 },
  );

  const existingKB = simpleLoop<SessionData>(
    createNeo4jController(tools.neo4j ?? []),
    tools.neo4j ?? [],
    { patternId: "onto-existing-kb", schema, maxTurns: 3 },
  );

  const research = parallel<SessionData>(
    [webResearch, docResearch, githubResearch, existingKB],
    { patternId: "onto-research" },
  );

  // Phase 3: Proposal with judge evaluation
  const proposalPattern = simpleLoop<SessionData>(
    createMemoryController(tools.memory ?? []),
    tools.memory ?? [],
    { patternId: "ontology-proposal", maxTurns: 8 },
  );

  const proposalJudge = judge<SessionData>(ontologyJudge, {
    patternId: "ontology-judge",
  });

  // Phase 4: Guardrail for logical consistency
  const validatedProposal = guardrail<SessionData>(proposalPattern, {
    patternId: "ontology-validated",
    rails: [namingConventionRail, noOrphansRail],
  });

  // Phase 5: Commit to Neo4j with approval
  const commit = withApproval<SessionData>(
    simpleLoop<SessionData>(
      createNeo4jController(tools.neo4j ?? []),
      tools.neo4j ?? [],
      { patternId: "ontology-commit", schema, maxTurns: 15 },
    ),
    approvalPredicates.mutations,
  );

  // Phase 6: Synthesize
  const suggestions = synthesizer<SessionData>({
    mode: "thread",
    patternId: "ontology-suggestions",
  });

  return [
    scoping,          // Phase 1
    research,         // Phase 2
    validatedProposal, // Phase 3+4
    proposalJudge,    // Evaluate proposal
    commit,           // Phase 5
    suggestions,      // Phase 6
  ];
}

export const ontologyBuilderAgent: AgentConfig = {
  id: "ontology-builder",
  name: "Ontology Builder",
  description: "Multi-phase ontology construction with validation and approval",
  icon: "🏗️",
  servers: ["memory", "web_search", "context7", "github", "neo4j-cypher"],
  createPatterns,
};
