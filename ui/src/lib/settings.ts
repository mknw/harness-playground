/**
 * Shared settings types and defaults.
 *
 * Safe to import from both client and server — contains only types and plain constants.
 */

/**
 * Sandbox compute settings. See docs/sandbox-plan.md → "Settings".
 *
 * Process-scoped values (`globalCap`, `perSessionCap`, `warmPool`, `idleEvictMs`)
 * are read once when the harness lazily constructs its singleton scheduler
 * and pool; per-call defaults (`defaultTimeoutSec`, `defaultMemoryMB`,
 * `defaultEgress`) are read each time `withSandbox` boots a VM whose caller
 * didn't override them. The settings panel UI does not currently surface
 * these — they're programmatic for v0.
 */
export interface SandboxSettings {
  /** Max concurrent sandbox attachments across the harness. */
  globalCap: number
  /** Max concurrent sandbox attachments per session. */
  perSessionCap: number
  /** Per-rootfs warm-pool depth. e.g. `{ base: 1 }`. */
  warmPool: Partial<Record<string, number>>
  /** Idle time before a pooled VM is destroyed (ms). */
  idleEvictMs: number
  /** Per-tool-call wall-clock cap when caller does not override. */
  defaultTimeoutSec: number
  /** Per-VM memory cap (MB) when caller does not override. */
  defaultMemoryMB: number
  /** Default egress profile when caller does not override. */
  defaultEgress: 'mcp-only' | 'pypi' | 'github-trusted' | 'open'
}

export interface HarnessSettings {
  maxToolTurns: number        // simpleLoop max iterations (default: 5)
  maxRetries: number          // actorCritic max attempts (default: 3)
  maxResultChars: number      // tool result truncation chars (default: 2000)
  maxResultForSummary: number // summarizer input limit chars (default: 3000)
  priorTurnCount: number      // prior turns for tool result memory (default: 3)
  routerTurnWindow: number    // router history window in turns (default: 5)
  sandbox: SandboxSettings    // compute sandbox caps + defaults
}

export const DEFAULT_SETTINGS: HarnessSettings = {
  maxToolTurns: 5,
  maxRetries: 3,
  maxResultChars: 2000,
  maxResultForSummary: 3000,
  priorTurnCount: 3,
  routerTurnWindow: 5,
  sandbox: {
    globalCap: 16,
    perSessionCap: 4,
    warmPool: { base: 1 },
    idleEvictMs: 300_000,
    defaultTimeoutSec: 60,
    defaultMemoryMB: 512,
    defaultEgress: 'mcp-only',
  },
}

/** Context window limits per BAML client (tokens) */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Groq
  GroqFast: 32_768,              // openai/gpt-oss-20b
  GroqGPT120B: 131_072,          // openai/gpt-oss-120b
  GroqQwen3_32b: 32_768,         // qwen/qwen3-32b
  // OpenRouter
  OpenRouterNemotron120B: 131_072,  // nvidia/nemotron-3-super-120b-a12b
  OpenRouterNemotron3Nano30B: 32_768, // nvidia/nemotron-3-nano-30b-a3b
  OpenRouterGemma4: 131_072,     // google/gemma-4-31b-it
  OpenRouterMiniMax2_5: 1_000_000, // minimax/minimax-m2.5
  // OpenAI
  OpenAIGPT5: 1_000_000,
  OpenAIGPT5Mini: 1_000_000,
  OpenAIGPT5Nano: 1_000_000,
  OpenAIGPT5Chat: 1_000_000,
  // Anthropic
  CustomHaiku: 200_000,
  CustomOpus4: 200_000,
  CustomSonnet4: 200_000,
  // Cerebras — separate-quota safety nets at end of each fallback chain
  CerebrasGPT120B: 131_072,        // gpt-oss-120b
  CerebrasZaiGLM4_7: 131_072,      // zai-glm-4.7
  CerebrasQwen3_235B: 131_072,     // qwen-3-235b-a22b-instruct-2507
  // Local (local-client.baml, not used in chains)
  LocalGLM: 16_384,
}

export const SETTINGS_STORAGE_KEY = 'kg_agent_settings'
