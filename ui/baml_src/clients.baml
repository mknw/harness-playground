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
client<llm> GroqReasoning {
  provider openai-generic
  retry_policy Exponential
  options {
    base_url "https://api.groq.com/openai/v1"
    api_key env.GROQ_API_KEY
    model "openai/gpt-oss-120b"
    max_tokens 4096
  }
}

// Groq — Evaluation & critique (Qwen3 32B, 400 t/s, 32K ctx)
client<llm> GroqEval {
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
client<llm> CustomGPT5 {
  provider openai-responses
  options {
    model "gpt-5"
    api_key env.OPENAI_API_KEY
    max_tokens 4096
  }
}

client<llm> CustomGPT5Mini {
  provider openai-responses
  retry_policy Exponential
  options {
    model "gpt-5-mini"
    api_key env.OPENAI_API_KEY
    max_tokens 4096
  }
}

// Fastest, most cost-efficient OpenAI model
client<llm> CustomGPT5Nano {
  provider openai-responses
  retry_policy Exponential
  options {
    model "gpt-5-nano"
    api_key env.OPENAI_API_KEY
    max_tokens 4096
  }
}

// Openai with chat completion
client<llm> CustomGPT5Chat {
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

// Example Ollama client for local models (uncomment to use)
// client<llm> CustomOllama {
//   provider openai-generic
//   options {
//     base_url "http://localhost:11434/v1"
//     model "llama4"
//     default_role "user" // Most local models prefer the user role
//     // No API key needed for local Ollama
//   }
// }

// https://docs.boundaryml.com/docs/snippets/clients/round-robin
client<llm> CustomFast {
  provider round-robin
  options {
    // This will alternate between the two clients
    strategy [CustomGPT5Mini, CustomHaiku]
  }
}

// Local llama-server — GLM 4.7 Flash (OpenAI-compatible API)
// Start with: pnpm dev:llama
client<llm> LocalGLM {
  provider openai-generic
  options {
    base_url "http://127.0.0.1:8080/v1"
    model "glm-4-flash"
    api_key "local"
    max_tokens 2048
  }
}

// Per-use-case fallback clients (LocalGLM primary, Groq fallback)
client<llm> RouterFallback {
  provider fallback
  options {
    strategy [LocalGLM, GroqFast, GroqReasoning]
  }
}

client<llm> ControllerFallback {
  provider fallback
  options {
    strategy [LocalGLM, GroqReasoning, GroqFast]
  }
}

client<llm> CriticFallback {
  provider fallback
  options {
    strategy [LocalGLM, GroqEval, GroqReasoning]
  }
}

client<llm> SynthesizerFallback {
  provider fallback
  options {
    strategy [LocalGLM, GroqReasoning, GroqEval]
  }
}

// Lightweight summarization — tiny/fast model for tool result descriptions
client<llm> DescribeFallback {
  provider fallback
  options {
    strategy [LocalGLM, GroqFast]
  }
}

// https://docs.boundaryml.com/docs/snippets/clients/fallback
client<llm> OpenaiFallback {
  provider fallback
  options {
    // This will try the clients in order until one succeeds
    strategy [CustomGPT5Mini, CustomGPT5]
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
  max_retries 3
  strategy {
    type exponential_backoff
    delay_ms 500
    multiplier 2
    max_delay_ms 10000
  }
}
