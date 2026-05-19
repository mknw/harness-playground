/**
 * Client overrides — Server Only
 *
 * Single source of truth for per-call BAML client overrides.
 *
 * **Default behaviour:** every BAML function's declared client in `baml_src/`
 * is the Anthropic-only variant (`ControllerAnthropic`, `CriticAnthropic`,
 * etc.). The runtime override is `undefined` — no swap happens.
 *
 * **`USE_MIXED_CHAINS=1`:** the override returns the function's mixed-provider
 * fallback (`ControllerFallback`, `CriticFallback`, etc.) defined in
 * `baml_src/clients.baml`. Call sites spread the override into the BAML
 * options bag to swap at runtime. Production deployments and occasional
 * mixed-chain testing both go through this.
 *
 * Why default to Anthropic: cross-provider rate limits (Groq + OpenRouter +
 * OpenAI) interfered too much during dev iteration of multi-turn / actorCritic
 * scenarios. See `SCRATCHPAD.md` P1.5 for context.
 */

import { assertServerOnImport } from './assert.server'

assertServerOnImport()

export type BamlRole =
  | 'controller'   // ActorController + LoopController
  | 'critic'       // Critic
  | 'synth'        // Synthesize
  | 'router'       // Router
  | 'describe'     // ResultDescribe + GenerateConversationTitle + ReferenceSelector

const MIXED_CLIENT_BY_ROLE: Record<BamlRole, string> = {
  controller: 'ControllerFallback',
  critic: 'CriticFallback',
  synth: 'SynthesizerFallback',
  router: 'RouterFallback',
  describe: 'DescribeFallback',
}

/**
 * Returns `{ client: 'XFallback' }` when `USE_MIXED_CHAINS=1` is set,
 * otherwise `undefined` — letting the BAML function fall through to its
 * declared client (the Anthropic variant).
 *
 * Spread the result into the BAML call's options bag:
 *   await b.ActorController(..., { ...(collector ? { collector } : {}), ...clientOverrideFor('controller') })
 *
 * The adapter's manual `BamlValidationError` fallback (Groq → Groq) only
 * fires when the override IS active — it's only useful inside the mixed
 * chain where Groq's structured-output issues actually surface.
 */
export function clientOverrideFor(role: BamlRole): { client: string } | undefined {
  if (process.env.USE_MIXED_CHAINS !== '1') return undefined
  return { client: MIXED_CLIENT_BY_ROLE[role] }
}
