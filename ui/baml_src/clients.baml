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

// Per-use-case fallback clients (Groq-only; LocalGLM available in local-client.baml)
client<llm> RouterFallback {
  provider fallback
  options {
    // Classification only — fast 20B model sufficient, 120B as backstop
    strategy [OpenRouterGemma4, GroqFast, GroqGPT120B]
  }
}

client<llm> ControllerFallback {
  provider fallback
  options {
    // 1. GroqGPT120B — gpt-oss-120b, fastest; 2. OpenRouterNemotron120B — when Groq fails structured output
    // on large context; 3. OpenAIGPT5Chat — reliable OpenAI fallback
    strategy [OpenRouterNemotron120B, OpenAIGPT5, OpenRouterMiniMax2_5, GroqGPT120B]
  }
}

client<llm> CriticFallback {
  provider fallback
  options {
    // Qwen3-32B purpose-built for evaluation; GroqGPT120B as backstop
    strategy [GroqQwen3_32b, GroqGPT120B, OpenRouterMiniMax2_5]
  }
}

client<llm> SynthesizerFallback {
  provider fallback
  options {
    // 1. OpenRouterGemma4 — fast prose synthesis; 2. GroqQwen3_32b (Qwen3-32B); 3. OpenAIGPT5Mini
    strategy [OpenRouterGemma4, GroqQwen3_32b, OpenAIGPT5Mini]
  }
}

// Lightweight summarization — fast 20B model is sufficient alone
client<llm> DescribeFallback {
  provider fallback
  options {
    strategy [GroqFast, OpenRouterGemma4, OpenAIGPT5Mini]
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
