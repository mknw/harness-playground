/**
 * Pattern Capabilities — static introspection of a pattern graph
 *
 * Pure helpers (no server-only deps) that walk the `children` of a
 * `ConfiguredPattern[]` to answer capability questions about a harness without
 * running it. Wrapping combinators (`chain`, `routes`, `parallel`, `guardrail`,
 * `hook`, `withApproval`, `withReferences`) expose their sub-patterns via
 * `ConfiguredPattern.children`; leaves omit it. Execution never reads `children`
 * — it's introspection-only.
 *
 * First consumer: the Tools panel greys itself out for conversations whose agent
 * does NOT compose a code-mode pattern (the only runtime consumer of the
 * per-conversation `codeModeAllowedTools` allowlist). See
 * `tool-config/config.server.ts` → `harness-client/registry.server.ts`
 * (`agentUsesCodeMode`).
 */

import type { ConfiguredPattern, ActorCriticConfig, PatternConfig } from './types'

/** A string the code-mode factory's `dynamicToolPattern` (`/^code-mode-/`)
 *  matches — used to probe a loop's config without depending on the regex's
 *  exact source. */
const CODE_MODE_TOOL_PROBE = 'code-mode-probe'

/**
 * True when a pattern's resolved config is a **code-mode loop** — i.e. an
 * `actorCritic` wired to the kg-agent `code-mode` factory. We detect it by the
 * structural signature the factory requires, not by a name an agent author
 * could choose differently:
 *
 *  - `dynamicToolPattern` (a RegExp) matches the `code-mode-<name>` factory
 *    tool naming — this is what lets the loop dispatch the generated tool, so
 *    any code-mode-composing agent has it; OR
 *  - `patternId === 'code-mode-loop'` (the convention the bundled agent uses),
 *    as a secondary signal.
 *
 * `dynamicToolPattern` lives on `ActorCriticConfig`, not the base
 * `PatternConfig`, so we widen the type to read it; `resolveConfig` preserves
 * it (it spreads the input config).
 */
export function isCodeModeLoopConfig(config: PatternConfig): boolean {
  const cfg = config as ActorCriticConfig
  if (cfg.patternId === 'code-mode-loop') return true
  const pattern = cfg.dynamicToolPattern
  // Build a fresh RegExp so a stray global flag's `lastIndex` can't make
  // `.test()` non-deterministic across calls.
  return pattern instanceof RegExp && new RegExp(pattern.source).test(CODE_MODE_TOOL_PROBE)
}

/**
 * True when any pattern in the (possibly nested) graph is a code-mode loop.
 * Walks `ConfiguredPattern.children` depth-first.
 */
export function usesCodeMode<T>(patterns: ConfiguredPattern<T>[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some(patternUsesCodeMode)
}

function patternUsesCodeMode<T>(pattern: ConfiguredPattern<T>): boolean {
  if (isCodeModeLoopConfig(pattern.config)) return true
  return usesCodeMode(pattern.children)
}
