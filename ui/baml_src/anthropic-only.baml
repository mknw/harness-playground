// Anthropic-only client variants for development iteration.
//
// Used when `USE_ANTHROPIC_ONLY=1` is set — see `harness-patterns/clients.server.ts`.
// Production code paths use the per-use-case fallback chains in clients.baml
// (RouterFallback / ControllerFallback / CriticFallback / SynthesizerFallback /
// DescribeFallback) which span multiple providers.
//
// Purpose: avoid Groq / OpenRouter / OpenAI rate-limit interference while
// iterating on actorCritic / multi-turn / hallucination scenarios.

client<llm> RouterAnthropic {
  provider fallback
  options {
    strategy [AnthropicHaiku45, AnthropicSonnet5]
  }
}

client<llm> ControllerAnthropic {
  provider fallback
  options {
    // Sonnet 5 leads — near-Opus structured-output/agentic quality at Sonnet
    // cost. Backstop is Sonnet 4.6, NOT Haiku: a rate-limit fallback on the
    // controller must stay Sonnet-tier (Haiku's weaker structured output was
    // implicated in tool-loop parse failures).
    strategy [AnthropicSonnet5, AnthropicSonnet46]
  }
}

client<llm> CriticAnthropic {
  provider fallback
  options {
    // Haiku 4.5 leads — critic is short evaluative judgment, doesn't need
    // Sonnet-tier reasoning. Sonnet 5 as backstop.
    strategy [AnthropicHaiku45, AnthropicSonnet5]
  }
}

client<llm> SynthesizerAnthropic {
  provider fallback
  options {
    strategy [AnthropicSonnet5, AnthropicHaiku45]
  }
}

client<llm> DescribeAnthropic {
  provider fallback
  options {
    strategy [AnthropicHaiku45]
  }
}
