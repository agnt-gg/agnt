/**
 * SINGLE SOURCE OF TRUTH for all AI provider configurations.
 *
 * To add a new provider: add one object to the PROVIDER_CONFIGS array.
 * Everything else (LlmService, ProviderRegistry, ModelRoutes) reads from here.
 *
 * To update a provider: change it here and only here.
 */

// ─────────────────────────── PROVIDER CONFIGS ───────────────────────────

const PROVIDER_CONFIGS = [
  // ─────────────────────────── OPENAI ───────────────────────────
  {
    key: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      imageGen: {
        models: ['dall-e-3'],
        operations: ['generate', 'edit', 'variation'],
        defaultModel: 'dall-e-3',
        supportedSizes: {
          'dall-e-2': ['256x256', '512x512', '1024x1024'],
          'dall-e-3': ['1024x1024', '1792x1024', '1024x1792'],
        },
        supportedFormats: ['url', 'b64_json'],
        maxImages: 10,
        supportsQuality: true,
        supportsStyle: true,
      },
    },
    fallbackModels: ['gpt-5-pro', 'gpt-5', 'o3', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    fallbackVisionModels: ['gpt-4.1'],
    modelMetadata: {
      'gpt-4.1': { contextWindow: 1047576, maxOutputTokens: 32768, inputCostPer1M: 2.0, outputCostPer1M: 8.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4o': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 2.5, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4o-mini': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: true, supportsTools: true, reasoning: false },
      'o3': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 10.0, outputCostPer1M: 40.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-3.5-turbo': { contextWindow: 16385, maxOutputTokens: 4096, inputCostPer1M: 0.5, outputCostPer1M: 1.5, supportsVision: false, supportsTools: true, reasoning: false },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── OPENAI CODEX ───────────────────────────
  {
    key: 'openai-codex',
    name: 'OpenAI Codex',
    baseURL: 'https://api.openai.com/v1',
    sdkType: 'openai',
    authScheme: 'codex',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      imageGen: {
        models: ['dall-e-3'],
        operations: ['generate', 'edit', 'variation'],
        defaultModel: 'dall-e-3',
        supportedSizes: {
          'dall-e-2': ['256x256', '512x512', '1024x1024'],
          'dall-e-3': ['1024x1024', '1792x1024', '1024x1792'],
        },
        supportedFormats: ['url', 'b64_json'],
        maxImages: 10,
        supportsQuality: true,
        supportsStyle: true,
      },
    },
    fallbackModels: ['gpt-4.1'],
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── OPENAI CODEX CLI ───────────────────────────
  {
    key: 'openai-codex-cli',
    name: 'OpenAI Codex CLI',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    sdkType: 'openai',
    authScheme: 'codex-cli',
    staticModels: true,
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    fallbackModels: ['gpt-5-codex', 'gpt-5'],
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── ANTHROPIC ───────────────────────────
  {
    key: 'anthropic',
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    sdkType: 'anthropic',
    authScheme: 'api-key',
    fetchHeaders: { 'anthropic-version': '2023-06-01' },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    fallbackModels: [
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    fallbackVisionModels: ['claude-sonnet-4-5-20250929'],
    modelMetadata: {
      'claude-sonnet-4-5': { contextWindow: 200000, maxOutputTokens: 16384, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-haiku-4-5': { contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 0.8, outputCostPer1M: 4.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-3-5-sonnet-20241022': { contextWindow: 200000, maxOutputTokens: 8192, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-3-opus-20240229': { contextWindow: 200000, maxOutputTokens: 4096, inputCostPer1M: 15.0, outputCostPer1M: 75.0, supportsVision: true, supportsTools: true, reasoning: false },
    },
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.display_name || raw.id,
      description: raw.description || '',
      contextLength: raw.max_tokens || 0,
      createdAt: raw.created_at,
    }),
    modelFilter: (m) => m.id && m.display_name,
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── CLAUDE CODE ───────────────────────────
  {
    key: 'claude-code',
    name: 'Claude Code',
    baseURL: 'https://api.anthropic.com/v1',
    sdkType: 'anthropic',
    authScheme: 'claude-code',
    fetchHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      'user-agent': 'claude-cli/2.1.2 (external, cli)',
      'x-app': 'cli',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    sdkOptions: {
      defaultHeaders: {
        'anthropic-beta':
          'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31',
        'user-agent': 'claude-cli/2.1.2 (external, cli)',
        'x-app': 'cli',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    },
    pagination: {
      enabled: true,
      pageSize: 100,
      cursorParam: 'after_id',
      hasMoreField: 'has_more',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    fallbackModels: [
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-20241022',
    ],
    fallbackVisionModels: ['claude-sonnet-4-5-20250929'],
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.display_name || raw.id,
      description: raw.description || '',
      contextLength: raw.max_tokens || 0,
      createdAt: raw.created_at,
    }),
    compat: {},
  },

  // ─────────────────────────── GEMINI ───────────────────────────
  {
    key: 'gemini',
    name: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    sdkType: 'gemini',
    authScheme: 'query-param',
    responseDataPath: 'models',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      imageGen: {
        models: ['gemini-3-pro-image-preview', 'nano-banana-pro-preview'],
        operations: ['generate'],
        defaultModel: 'nano-banana-pro-preview',
        supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        supportedResolutions: ['1K', '2K', '4K'],
        supportsGoogleSearch: true,
      },
    },
    fallbackModels: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    fallbackVisionModels: ['gemini-3-pro-preview'],
    modelMetadata: {
      'gemini-2.5-pro': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-2.0-flash-exp': { contextWindow: 1048576, maxOutputTokens: 8192, inputCostPer1M: 0.1, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
      'gemini-1.5-pro': { contextWindow: 2097152, maxOutputTokens: 8192, inputCostPer1M: 1.25, outputCostPer1M: 5.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gemini-1.5-flash': { contextWindow: 1048576, maxOutputTokens: 8192, inputCostPer1M: 0.075, outputCostPer1M: 0.3, supportsVision: true, supportsTools: true, reasoning: false },
    },
    modelTransform: (raw) => ({
      id: raw.name?.replace('models/', '') || raw.id,
      name: raw.displayName || raw.name?.replace('models/', '') || raw.id,
      description: raw.description || '',
      contextLength: raw.inputTokenLimit || 0,
      outputTokenLimit: raw.outputTokenLimit || 0,
    }),
    modelFilter: (m) => m.name && m.supportedGenerationMethods?.includes('generateContent'),
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── GROKAI (xAI) ───────────────────────────
  {
    key: 'grokai',
    name: 'Grok AI',
    baseURL: 'https://api.x.ai/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      imageGen: {
        models: ['grok-4-1-fast-reasoning'],
        operations: ['generate'],
        defaultModel: 'grok-4-1-fast-reasoning',
        supportedFormats: ['url', 'b64_json'],
        maxImages: 10,
        supportsRevisedPrompt: true,
      },
    },
    fallbackModels: ['grok-4', 'grok-4-0709', 'grok-3', 'grok-3-mini', 'grok-2-vision-1212', 'grok-code-fast-1'],
    fallbackVisionModels: ['grok-4-1-fast-reasoning'],
    modelMetadata: {
      'grok-3': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: false, supportsTools: true, reasoning: false },
      'grok-3-mini': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 0.5, supportsVision: false, supportsTools: true, reasoning: true },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── GROQ ───────────────────────────
  {
    key: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    fallbackModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    modelMetadata: {
      'llama-3.3-70b-versatile': { contextWindow: 128000, maxOutputTokens: 32768, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true, reasoning: false },
      'llama-3.1-8b-instant': { contextWindow: 128000, maxOutputTokens: 8192, inputCostPer1M: 0.05, outputCostPer1M: 0.08, supportsVision: false, supportsTools: true, reasoning: false },
      'mixtral-8x7b-32768': { contextWindow: 32768, maxOutputTokens: 32768, inputCostPer1M: 0.24, outputCostPer1M: 0.24, supportsVision: false, supportsTools: true, reasoning: false },
    },
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.id,
      description: '',
      createdAt: raw.created,
      ownedBy: raw.owned_by,
      contextWindow: raw.context_window || 0,
      active: raw.active,
    }),
    modelFilter: (m) => m.id && m.active !== false,
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── DEEPSEEK ───────────────────────────
  {
    key: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
    modelMetadata: {
      'deepseek-chat': { contextWindow: 64000, maxOutputTokens: 8192, inputCostPer1M: 0.14, outputCostPer1M: 0.28, supportsVision: false, supportsTools: true, reasoning: false },
      'deepseek-reasoner': { contextWindow: 64000, maxOutputTokens: 8192, inputCostPer1M: 0.55, outputCostPer1M: 2.19, supportsVision: false, supportsTools: false, reasoning: true },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── OPENROUTER ───────────────────────────
  {
    key: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    sdkOptions: {
      defaultHeaders: {
        'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3333',
        'X-Title': process.env.SITE_NAME || 'TaskTitan',
      },
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    fallbackModels: [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-3-5-sonnet-20241022',
      'anthropic/claude-3-haiku-20240307',
      'google/gemini-pro-1.5',
      'meta-llama/llama-3.1-70b-instruct',
      'mistralai/mixtral-8x7b-instruct',
    ],
    fallbackVisionModels: [
      'openai/gpt-4-turbo',
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-pro-1.5-vision',
    ],
    modelTransform: (raw) => ({
      id: raw.id,
      name: raw.name || raw.id,
      description: raw.description || '',
      contextLength: raw.context_length || raw.top_provider?.context_length || 0,
      pricing: {
        prompt: parseFloat(raw.pricing?.prompt || '0'),
        completion: parseFloat(raw.pricing?.completion || '0'),
      },
    }),
    modelFilter: (m) => m.id && m.name,
    compat: {},
  },

  // ─────────────────────────── TOGETHERAI ───────────────────────────
  {
    key: 'togetherai',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    responseDataPath: 'root',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    fallbackModels: [
      'deepseek-ai/DeepSeek-V3',
      'moonshotai/Kimi-K2-Instruct',
      'Qwen/Qwen3-235B-A22B-Thinking-2507',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
    ],
    modelFilter: (m) => m.id && m.type === 'chat',
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── CEREBRAS ───────────────────────────
  {
    key: 'cerebras',
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    sdkType: 'cerebras',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    fallbackModels: ['llama3.1-8b', 'llama-3.3-70b', 'gpt-oss-120b', 'qwen-3-32b', 'qwen-3-235b-a22b-instruct-2507', 'zai-glm-4.6'],
    compat: {},
    sdkOptions: { warmTCPConnection: false },
  },

  // ─────────────────────────── KIMI ───────────────────────────
  {
    key: 'kimi',
    name: 'Kimi',
    baseURL: 'https://api.moonshot.ai/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    fallbackModels: ['kimi-k2.5', 'kimi-k2-thinking', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    fallbackVisionModels: ['kimi-k2.5'],
    modelMetadata: {
      'moonshot-v1-8k': { contextWindow: 8192, maxOutputTokens: 4096, inputCostPer1M: 0.85, outputCostPer1M: 0.85, supportsVision: false, supportsTools: true, reasoning: false },
      'moonshot-v1-32k': { contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 1.7, outputCostPer1M: 1.7, supportsVision: false, supportsTools: true, reasoning: false },
      'moonshot-v1-128k': { contextWindow: 131072, maxOutputTokens: 4096, inputCostPer1M: 8.5, outputCostPer1M: 8.5, supportsVision: false, supportsTools: true, reasoning: false },
    },
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── MINIMAX ───────────────────────────
  {
    key: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.io/v1',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    fallbackModels: ['MiniMax-M2.1', 'MiniMax-M2'],
    compat: {},
    sdkOptions: {},
  },

  // ─────────────────────────── ZAI ───────────────────────────
  {
    key: 'zai',
    name: 'Z.AI',
    baseURL: 'https://api.z.ai/api/paas/v4',
    sdkType: 'openai',
    authScheme: 'bearer',
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    fallbackModels: ['GLM-4.7', 'GLM-4.6', 'GLM-4.5'],
    fallbackVisionModels: ['GLM-4.7', 'GLM-4.6', 'GLM-4.5'],
    compat: {},
    sdkOptions: {},
  },
];

// ─────────────────────────── PROVIDER TEMPLATES ───────────────────────────
// Pre-configured templates for the generic OpenAI-compatible provider system.
// Users select a template when adding a custom provider — it auto-fills name, URL, etc.

export const PROVIDER_TEMPLATES = [
  {
    key: 'mistral',
    name: 'Mistral AI',
    baseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    description: 'Mistral AI — European AI lab with efficient, high-quality models',
  },
  {
    key: 'fireworks',
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    supportsTools: true,
    supportsStreaming: true,
    description: 'Fireworks AI — Fast inference for open-source models',
  },
  {
    key: 'ollama',
    name: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    supportsTools: true,
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'Ollama — Run open-source LLMs locally',
  },
  {
    key: 'lm-studio',
    name: 'LM Studio (Local)',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'loaded-model',
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'LM Studio — Desktop app for running local LLMs',
  },
  {
    key: 'deepinfra',
    name: 'DeepInfra',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    supportsTools: true,
    supportsStreaming: true,
    description: 'DeepInfra — Affordable serverless GPU inference',
  },
  {
    key: 'perplexity',
    name: 'Perplexity AI',
    baseURL: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    supportsTools: false,
    supportsStreaming: true,
    description: 'Perplexity AI — Search-grounded AI answers',
  },
  {
    key: 'sambanova',
    name: 'SambaNova',
    baseURL: 'https://api.sambanova.ai/v1',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    supportsStreaming: true,
    description: 'SambaNova — Enterprise AI inference platform',
  },
  {
    key: 'novita',
    name: 'Novita AI',
    baseURL: 'https://api.novita.ai/v3/openai',
    defaultModel: 'meta-llama/llama-3.1-70b-instruct',
    supportsStreaming: true,
    description: 'Novita AI — Scalable model inference API',
  },
  {
    key: 'nebius',
    name: 'Nebius',
    baseURL: 'https://api.studio.nebius.ai/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    supportsStreaming: true,
    description: 'Nebius — Cloud AI inference (Yandex spinoff)',
  },
  {
    key: 'nvidia-nim',
    name: 'NVIDIA NIM',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    supportsStreaming: true,
    description: 'NVIDIA NIM — GPU-optimized model inference microservices',
  },
  {
    key: 'scaleway',
    name: 'Scaleway',
    baseURL: 'https://api.scaleway.ai/v1',
    defaultModel: 'llama-3.3-70b-instruct',
    supportsStreaming: true,
    description: 'Scaleway — European cloud AI inference',
  },
  {
    key: 'hyperbolic',
    name: 'Hyperbolic',
    baseURL: 'https://api.hyperbolic.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    supportsStreaming: true,
    description: 'Hyperbolic — Open-access AI cloud',
  },
  {
    key: 'meta-llama',
    name: 'Meta Llama API',
    baseURL: 'https://api.llama.com/v1',
    defaultModel: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
    supportsTools: true,
    supportsStreaming: true,
    description: 'Meta Llama API — Official Llama model API from Meta',
  },
  {
    key: 'cohere',
    name: 'Cohere',
    baseURL: 'https://api.cohere.com/compatibility/v1',
    defaultModel: 'command-r-plus',
    supportsTools: true,
    supportsStreaming: true,
    description: 'Cohere — Enterprise AI with RAG-optimized models (OpenAI-compat mode)',
  },
  {
    key: 'lambda',
    name: 'Lambda',
    baseURL: 'https://api.lambdalabs.com/v1',
    defaultModel: 'llama3.3-70b-instruct-fp8',
    supportsStreaming: true,
    description: 'Lambda — GPU cloud with model inference API',
  },
  {
    key: 'lepton',
    name: 'Lepton AI',
    baseURL: 'https://api.lepton.ai/v1',
    defaultModel: 'llama3.1-70b',
    supportsStreaming: true,
    description: 'Lepton AI — Serverless AI inference platform',
  },
  {
    key: 'vllm',
    name: 'vLLM (Local)',
    baseURL: 'http://localhost:8000/v1',
    defaultModel: 'default',
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'vLLM — High-throughput local LLM serving engine',
  },
  {
    key: 'jan',
    name: 'Jan (Local)',
    baseURL: 'http://localhost:1337/v1',
    defaultModel: 'default',
    supportsStreaming: true,
    requiresApiKey: false,
    description: 'Jan — Open-source desktop AI assistant',
  },
];

// ─────────────────────────── EXPORTS ───────────────────────────

/** Get all built-in provider configs */
export function getAllProviderConfigs() {
  return PROVIDER_CONFIGS;
}

/** Get a provider config by key */
export function getProviderConfig(key) {
  return PROVIDER_CONFIGS.find((p) => p.key === key.toLowerCase());
}

/** Get all provider keys */
export function getAllProviderKeys() {
  return PROVIDER_CONFIGS.map((p) => p.key);
}

/** Get providers that support a specific capability */
export function getProvidersWithCapability(capability) {
  return PROVIDER_CONFIGS.filter((p) => p.capabilities[capability] != null);
}

/** Get all provider templates for the generic provider system */
export function getAllProviderTemplates() {
  return PROVIDER_TEMPLATES;
}

/** Get a specific provider template by key */
export function getProviderTemplate(key) {
  return PROVIDER_TEMPLATES.find((t) => t.key === key.toLowerCase());
}

/** Build a PROVIDER_CAPABILITIES object (for backward compat with ProviderRegistry) */
export function buildProviderCapabilities() {
  const caps = {};
  for (const config of PROVIDER_CONFIGS) {
    caps[config.key] = {};
    if (config.capabilities.text) {
      caps[config.key].text = {
        models: config.fallbackModels,
        ...config.capabilities.text,
      };
    }
    if (config.capabilities.vision) {
      caps[config.key].vision = {
        models: config.fallbackVisionModels || config.fallbackModels,
        ...config.capabilities.vision,
      };
    } else {
      caps[config.key].vision = null;
    }
    if (config.capabilities.imageGen) {
      caps[config.key].imageGen = config.capabilities.imageGen;
    } else {
      caps[config.key].imageGen = null;
    }
  }
  return caps;
}

/** Build a baseURLs map (for backward compat with LlmService) */
export function buildBaseURLs() {
  const urls = {};
  for (const config of PROVIDER_CONFIGS) {
    urls[config.key] = config.baseURL;
  }
  // Add local provider
  urls.local = 'http://127.0.0.1:1234/v1';
  return urls;
}

// ─────────────────────────── MODEL METADATA HELPERS ───────────────────────────

/**
 * Get metadata for a specific model.
 * Returns null if provider or model metadata not found (graceful degradation).
 */
export function getModelMetadata(providerKey, modelId) {
  const config = getProviderConfig(providerKey);
  if (!config?.modelMetadata) return null;
  return config.modelMetadata[modelId] || null;
}

/**
 * Estimate cost for a given number of input/output tokens.
 * Returns null if pricing metadata not available.
 */
export function getModelCost(providerKey, modelId, inputTokens, outputTokens) {
  const meta = getModelMetadata(providerKey, modelId);
  if (!meta || meta.inputCostPer1M == null || meta.outputCostPer1M == null) return null;
  return {
    inputCost: (inputTokens / 1_000_000) * meta.inputCostPer1M,
    outputCost: (outputTokens / 1_000_000) * meta.outputCostPer1M,
    totalCost: (inputTokens / 1_000_000) * meta.inputCostPer1M + (outputTokens / 1_000_000) * meta.outputCostPer1M,
  };
}

/**
 * Check if a model is a reasoning/thinking model.
 * Returns false if metadata not available.
 */
export function isReasoningModel(providerKey, modelId) {
  const meta = getModelMetadata(providerKey, modelId);
  return meta?.reasoning === true;
}

/**
 * Get all model metadata for a provider (for bulk API responses).
 * Returns empty object if no metadata available.
 */
export function getAllModelMetadata(providerKey) {
  const config = getProviderConfig(providerKey);
  return config?.modelMetadata || {};
}

export default PROVIDER_CONFIGS;
