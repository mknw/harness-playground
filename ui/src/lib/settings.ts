/**
 * Shared settings types and defaults.
 *
 * Safe to import from both client and server — contains only types and plain constants.
 */

export interface HarnessSettings {
  maxToolTurns: number        // simpleLoop max iterations (default: 5)
  maxRetries: number          // actorCritic max attempts (default: 3)
  maxResultChars: number      // tool result truncation chars (default: 2000)
  maxResultForSummary: number // summarizer input limit chars (default: 3000)
  priorTurnCount: number      // prior turns for tool result memory (default: 3)
  routerTurnWindow: number    // router history window in turns (default: 5)
}

export const DEFAULT_SETTINGS: HarnessSettings = {
  maxToolTurns: 5,
  maxRetries: 3,
  maxResultChars: 2000,
  maxResultForSummary: 3000,
  priorTurnCount: 3,
  routerTurnWindow: 5,
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
