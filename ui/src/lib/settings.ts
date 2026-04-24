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
  GroqFast: 32_768,        // openai/gpt-oss-20b
  GroqReasoning: 131_072,  // openai/gpt-oss-120b
  GroqEval: 32_768,        // qwen/qwen3-32b
  LocalGLM: 16_384,        // glm-4-flash
  CustomGPT5: 1_000_000,
  CustomGPT5Mini: 1_000_000,
  CustomGPT5Nano: 1_000_000,
  CustomHaiku: 200_000,
  CustomOpus4: 200_000,
  CustomSonnet4: 200_000,
}

export const SETTINGS_STORAGE_KEY = 'kg_agent_settings'
