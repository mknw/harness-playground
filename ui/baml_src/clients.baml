// Learn more about clients at https://docs.boundaryml.com/docs/snippets/clients/overview

// Groq — Fast routing & classification (1000 t/s, cheapest, 32K ctx)
client<llm> GroqFast {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://api.groq.com/openai/v1"
    api_key env.GROQ_API_KEY
    model "openai/gpt-oss-20b"
    max_tokens 2048
  }
}

// Groq — Strong reasoning for controllers (131K ctx, GPT-OSS 120B)
client<llm> GroqGPT120B {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://api.groq.com/openai/v1"
    api_key env.GROQ_API_KEY
    model "openai/gpt-oss-120b"
    max_tokens 4096
  }
}

// OpenRouter — MiniMax (NVIDIA, strong structured-output reasoning, 131K ctx)
client<llm> OpenRouterMiniMax2_5 {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://openrouter.ai/api/v1"
    api_key env.OPENROUTER_API_KEY
    model "minimax/minimax-m2.5:free"
    max_tokens 4096
  }
}

// OpenRouter — Nemotron Super (NVIDIA, strong structured-output reasoning, 131K ctx)
client<llm> OpenRouterNemotron120B {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://openrouter.ai/api/v1"
    api_key env.OPENROUTER_API_KEY
    model "nvidia/nemotron-3-super-120b-a12b:free"
    max_tokens 4096
  }
}


client<llm> OpenRouterNemotron3Nano30B {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://openrouter.ai/api/v1"
    api_key env.OPENROUTER_API_KEY
    model "nvidia/nemotron-3-nano-30b-a3b:free"
    max_tokens 4096
  }
}

// OpenRouter — Gemma 4 27B (Google, fast synthesis, 128K ctx)
client<llm> OpenRouterGemma4 {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://openrouter.ai/api/v1"
    api_key env.OPENROUTER_API_KEY
    model "google/gemma-4-31b-it:free"
    max_tokens 4096
  }
}

// Cerebras — wafer-scale inference, separate quota pool from Groq/OpenRouter.
// OpenAI-compatible API. Used as the *final* safety net in fallback chains so
// 429s on the primary cloud providers don't surface to the user.
client<llm> CerebrasGPT120B {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://api.cerebras.ai/v1"
    api_key env.CEREBRAS_API_KEY
    model "gpt-oss-120b"
    max_tokens 4096
  }
}

client<llm> CerebrasZaiGLM4_7 {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://api.cerebras.ai/v1"
    api_key env.CEREBRAS_API_KEY
    model "zai-glm-4.7"
    max_tokens 4096
  }
}

client<llm> CerebrasQwen3_235B {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://api.cerebras.ai/v1"
    api_key env.CEREBRAS_API_KEY
    model "qwen-3-235b-a22b-instruct-2507"
    max_tokens 4096
  }
}

// Groq — Evaluation & critique (Qwen3 32B, 400 t/s, 32K ctx)
client<llm> GroqQwen3_32b {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://api.groq.com/openai/v1"
    api_key env.GROQ_API_KEY
    model "qwen/qwen3-32b"
    max_tokens 2048
  }
}

// Using the new OpenAI Responses API for enhanced formatting
client<llm> OpenAIGPT5 {
  provider openai-responses
  options {
    model "gpt-5"
    api_key env.OPENAI_API_KEY
    max_tokens 4096
  }
}

client<llm> OpenAIGPT5Mini {
  provider openai-responses
  retry_policy Exponential
  options {
    model "gpt-5-mini"
    api_key env.OPENAI_API_KEY
    max_tokens 4096
  }
}

// Fastest, most cost-efficient OpenAI model
client<llm> OpenAIGPT5Nano {
  provider openai-responses
  retry_policy Exponential
  options {
    model "gpt-5-nano"
    api_key env.OPENAI_API_KEY
    max_tokens 4096
  }
}

// Openai with chat completion
client<llm> OpenAIGPT5Chat {
  provider openai
  options {
    model "gpt-5"
    api_key env.OPENAI_API_KEY
    max_tokens 4096
  }
}

// Latest Anthropic Claude 4 models
client<llm> CustomOpus4 {
  provider anthropic
  options {
    model "claude-opus-4-1-20250805"
    api_key env.ANTHROPIC_API_KEY
    max_tokens 4096
  }
}

client<llm> CustomSonnet4 {
  provider anthropic
  options {
    model "claude-sonnet-4-20250514"
    api_key env.ANTHROPIC_API_KEY
    max_tokens 4096
  }
}

client<llm> CustomHaiku {
  provider anthropic
  retry_policy Constant
  options {
    model "claude-3-5-haiku-20241022"
    api_key env.ANTHROPIC_API_KEY
    max_tokens 4096
  }
}

// Example Google AI client (uncomment to use)
// client<llm> CustomGemini {
//   provider google-ai
//   options {
//     model "gemini-2.5-pro"
//     api_key env.GOOGLE_API_KEY
//   }
// }

// Example AWS Bedrock client (uncomment to use)
// client<llm> CustomBedrock {
//   provider aws-bedrock
//   options {
//     model "anthropic.claude-sonnet-4-20250514-v1:0"
//     region "us-east-1"
//     // AWS credentials are auto-detected from env vars
//   }
// }

// Example Azure OpenAI client (uncomment to use)
// client<llm> CustomAzure {
//   provider azure-openai
//   options {
//     model "gpt-5"
//     api_key env.AZURE_OPENAI_API_KEY
//     base_url "https://MY_RESOURCE_NAME.openai.azure.com/openai/deployments/MY_DEPLOYMENT_ID"
//     api_version "2024-10-01-preview"
//   }
// }

// Example Vertex AI client (uncomment to use)
// client<llm> CustomVertex {
//   provider vertex-ai
//   options {
//     model "gemini-2.5-pro"
//     location "us-central1"
//     // Uses Google Cloud Application Default Credentials
//   }
// }


// https://docs.boundaryml.com/docs/snippets/clients/round-robin
client<llm> CustomFast {
  provider round-robin
  options {
    // This will alternate between the two clients
    strategy [OpenAIGPT5Mini, CustomHaiku]
  }
}

// Per-use-case fallback clients. Cerebras sits at the end of every chain as
// a separate-quota safety net, so a 429 on Groq/OpenRouter/OpenAI no longer
// surfaces to the user.
client<llm> RouterFallback {
  provider fallback
  options {
    // Classification only — fast 20B model sufficient, larger models as backstops
    strategy [OpenRouterGemma4, GroqFast, GroqGPT120B, CerebrasGPT120B]
  }
}

client<llm> ControllerFallback {
  provider fallback
  options {
    // Tool-loop reasoning + structured output. Cerebras GPT-OSS-120B mirrors
    // Groq's model class with independent rate limits.
    strategy [OpenRouterNemotron120B, OpenAIGPT5, OpenRouterMiniMax2_5, GroqGPT120B, CerebrasGPT120B]
  }
}

client<llm> CriticFallback {
  provider fallback
  options {
    // Qwen-family evaluators preferred; CerebrasQwen3_235B as final backstop.
    strategy [GroqQwen3_32b, GroqGPT120B, OpenRouterMiniMax2_5, CerebrasQwen3_235B]
  }
}

client<llm> SynthesizerFallback {
  provider fallback
  options {
    // Prose synthesis. CerebrasZaiGLM4_7 (GLM-4.7) handles natural-language
    // formatting well as the final safety net.
    strategy [OpenRouterGemma4, GroqQwen3_32b, OpenAIGPT5, CerebrasZaiGLM4_7]
  }
}

// Lightweight summarization — fast 20B model is sufficient alone.
// CerebrasZaiGLM4_7 closes the chain as the cross-provider safety net.
client<llm> DescribeFallback {
  provider fallback
  options {
    strategy [GroqFast, OpenRouterGemma4, OpenAIGPT5, CerebrasZaiGLM4_7]
  }
}

// https://docs.boundaryml.com/docs/snippets/clients/fallback
client<llm> OpenaiFallback {
  provider fallback
  options {
    // This will try the clients in order until one succeeds
    strategy [OpenAIGPT5Mini, OpenAIGPT5]
  }
}

// https://docs.boundaryml.com/docs/snippets/clients/retry
retry_policy Constant {
  max_retries 3
  strategy {
    type constant_delay
    delay_ms 200
  }
}

retry_policy Exponential {
  max_retries 2
  strategy {
    type exponential_backoff
    delay_ms 500
    multiplier 1.5
    max_delay_ms 10000
  }
}
