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
    recommendedModels: ['gpt-5.2', 'o4-mini', 'gpt-4.1'],
    fallbackModels: ['gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o4-mini', 'o3', 'o3-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini'],
    fallbackVisionModels: ['gpt-5.2', 'gpt-4.1'],
    modelMetadata: {
      'gpt-5.2': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.75, outputCostPer1M: 14.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-5.1': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5-mini': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 0.25, outputCostPer1M: 2.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-5-nano': { contextWindow: 400000, maxOutputTokens: 128000, inputCostPer1M: 0.05, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
      'o4-mini': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 1.1, outputCostPer1M: 4.4, supportsVision: true, supportsTools: true, reasoning: true },
      'o3': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 2.0, outputCostPer1M: 8.0, supportsVision: true, supportsTools: true, reasoning: true },
      'o3-mini': { contextWindow: 200000, maxOutputTokens: 100000, inputCostPer1M: 1.1, outputCostPer1M: 4.4, supportsVision: true, supportsTools: true, reasoning: true },
      'gpt-4.1': { contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 2.0, outputCostPer1M: 8.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4.1-mini': { contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 0.4, outputCostPer1M: 1.6, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4.1-nano': { contextWindow: 1000000, maxOutputTokens: 32768, inputCostPer1M: 0.1, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4o': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 2.5, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gpt-4o-mini': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: true, supportsTools: true, reasoning: false },
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
    recommendedModels: ['gpt-4.1'],
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
    recommendedModels: ['gpt-5.2-codex', 'gpt-5.1-codex'],
    fallbackModels: ['gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.2'],
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
    recommendedModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    fallbackModels: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
    ],
    fallbackVisionModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    modelMetadata: {
      'claude-opus-4-6': { contextWindow: 200000, maxOutputTokens: 128000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-sonnet-4-6': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-opus-4-5-20251101': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 5.0, outputCostPer1M: 25.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-sonnet-4-5-20250929': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: true },
      'claude-haiku-4-5-20251001': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 1.0, outputCostPer1M: 5.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-sonnet-4-20250514': { contextWindow: 200000, maxOutputTokens: 64000, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: false },
      'claude-opus-4-20250514': { contextWindow: 200000, maxOutputTokens: 32000, inputCostPer1M: 15.0, outputCostPer1M: 75.0, supportsVision: true, supportsTools: true, reasoning: false },
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
    recommendedModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    fallbackModels: [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
    ],
    fallbackVisionModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
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
    pagination: {
      enabled: true,
      pageSize: 100,
      limitParam: 'pageSize',
      cursorParam: 'pageToken',
      hasMoreField: 'nextPageToken',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
      imageGen: {
        models: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'],
        operations: ['generate'],
        defaultModel: 'gemini-3.1-flash-image-preview',
        supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        supportedResolutions: ['1K', '2K', '4K'],
        supportsGoogleSearch: true,
      },
    },
    recommendedModels: ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    fallbackModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    fallbackVisionModels: ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
    modelMetadata: {
      'gemini-3.1-pro-preview': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 2.0, outputCostPer1M: 12.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-3-flash-preview': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.5, outputCostPer1M: 3.0, supportsVision: true, supportsTools: true, reasoning: false },
      'gemini-2.5-pro': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 1.25, outputCostPer1M: 10.0, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-2.5-flash': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.3, outputCostPer1M: 2.5, supportsVision: true, supportsTools: true, reasoning: true },
      'gemini-2.5-flash-lite': { contextWindow: 1048576, maxOutputTokens: 65536, inputCostPer1M: 0.1, outputCostPer1M: 0.4, supportsVision: true, supportsTools: true, reasoning: false },
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

  // ─────────────────────────── GEMINI CLI ───────────────────────────
  {
    key: 'gemini-cli',
    name: 'Gemini CLI',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    sdkType: 'gemini',
    authScheme: 'gemini-cli',
    responseDataPath: 'models',
    pagination: {
      enabled: true,
      pageSize: 100,
      limitParam: 'pageSize',
      cursorParam: 'pageToken',
      hasMoreField: 'nextPageToken',
    },
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
    fallbackModels: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    fallbackVisionModels: ['gemini-2.5-pro'],
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
        models: ['grok-imagine-image-pro', 'grok-imagine-image'],
        operations: ['generate'],
        defaultModel: 'grok-imagine-image-pro',
        supportedFormats: ['url', 'b64_json'],
        maxImages: 10,
        supportsRevisedPrompt: true,
      },
    },
    recommendedModels: ['grok-4-0709', 'grok-4-1-fast-reasoning'],
    fallbackModels: ['grok-4-0709', 'grok-4-1-fast-reasoning', 'grok-code-fast-1', 'grok-3', 'grok-3-mini'],
    fallbackVisionModels: ['grok-4-0709'],
    modelMetadata: {
      'grok-4-0709': { contextWindow: 256000, maxOutputTokens: 131072, inputCostPer1M: 3.0, outputCostPer1M: 15.0, supportsVision: true, supportsTools: true, reasoning: true },
      'grok-4-1-fast-reasoning': { contextWindow: 2000000, maxOutputTokens: 131072, inputCostPer1M: 0.2, outputCostPer1M: 0.5, supportsVision: false, supportsTools: true, reasoning: true },
      'grok-code-fast-1': { contextWindow: 256000, maxOutputTokens: 131072, inputCostPer1M: 0.2, outputCostPer1M: 1.5, supportsVision: false, supportsTools: true, reasoning: true },
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
    recommendedModels: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
    fallbackModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen/qwen3-32b', 'meta-llama/llama-4-scout-17b-16e-instruct'],
    modelMetadata: {
      'openai/gpt-oss-120b': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: false, supportsTools: true, reasoning: false },
      'openai/gpt-oss-20b': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.075, outputCostPer1M: 0.3, supportsVision: false, supportsTools: true, reasoning: false },
      'llama-3.3-70b-versatile': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.59, outputCostPer1M: 0.79, supportsVision: false, supportsTools: true, reasoning: false },
      'llama-3.1-8b-instant': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 0.05, outputCostPer1M: 0.08, supportsVision: false, supportsTools: true, reasoning: false },
      'qwen/qwen3-32b': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.29, outputCostPer1M: 0.59, supportsVision: false, supportsTools: true, reasoning: false },
      'meta-llama/llama-4-scout-17b-16e-instruct': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.11, outputCostPer1M: 0.34, supportsVision: false, supportsTools: true, reasoning: false },
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
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner'],
    fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
    modelMetadata: {
      'deepseek-chat': { contextWindow: 128000, maxOutputTokens: 8192, inputCostPer1M: 0.28, outputCostPer1M: 0.42, supportsVision: false, supportsTools: true, reasoning: false },
      'deepseek-reasoner': { contextWindow: 128000, maxOutputTokens: 64000, inputCostPer1M: 0.28, outputCostPer1M: 0.42, supportsVision: false, supportsTools: true, reasoning: true },
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
    recommendedModels: ['openai/gpt-5.2', 'anthropic/claude-sonnet-4-6', 'google/gemini-2.5-pro'],
    fallbackModels: [
      'openai/gpt-5.2',
      'openai/gpt-4.1',
      'openai/o4-mini',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5-20251001',
      'google/gemini-2.5-pro',
      'google/gemini-2.5-flash',
      'x-ai/grok-4-1-fast-reasoning',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
    ],
    fallbackVisionModels: [
      'openai/gpt-5.2',
      'openai/gpt-4.1',
      'anthropic/claude-sonnet-4-6',
      'google/gemini-2.5-pro',
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
    recommendedModels: ['deepseek-ai/DeepSeek-V3', 'moonshotai/Kimi-K2.5'],
    fallbackModels: [
      'deepseek-ai/DeepSeek-V3',
      'moonshotai/Kimi-K2.5',
      'MiniMaxAI/MiniMax-M2.5',
      'Qwen/Qwen3-235B-A22B-Thinking-2507',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ],
    modelMetadata: {
      'deepseek-ai/DeepSeek-V3': { contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.30, outputCostPer1M: 0.88, supportsVision: false, supportsTools: true, reasoning: false },
      'deepseek-ai/DeepSeek-R1': { contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.75, outputCostPer1M: 2.19, supportsVision: false, supportsTools: true, reasoning: true },
      'moonshotai/Kimi-K2.5': { contextWindow: 131072, maxOutputTokens: 16384, inputCostPer1M: 0.20, outputCostPer1M: 0.88, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMaxAI/MiniMax-M2.5': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 0.30, outputCostPer1M: 1.20, supportsVision: false, supportsTools: true, reasoning: true },
      'Qwen/Qwen3-235B-A22B-Thinking-2507': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.50, outputCostPer1M: 1.50, supportsVision: false, supportsTools: true, reasoning: true },
      'meta-llama/Llama-3.3-70B-Instruct-Turbo': { contextWindow: 131072, maxOutputTokens: 32768, inputCostPer1M: 0.18, outputCostPer1M: 0.34, supportsVision: false, supportsTools: true, reasoning: false },
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8': { contextWindow: 1048576, maxOutputTokens: 32768, inputCostPer1M: 0.27, outputCostPer1M: 0.35, supportsVision: true, supportsTools: true, reasoning: false },
      'meta-llama/Llama-4-Scout-17B-16E-Instruct': { contextWindow: 524288, maxOutputTokens: 32768, inputCostPer1M: 0.18, outputCostPer1M: 0.30, supportsVision: true, supportsTools: true, reasoning: false },
    },
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
    recommendedModels: ['gpt-oss-120b', 'qwen-3-235b-a22b-instruct-2507'],
    fallbackModels: ['gpt-oss-120b', 'llama3.1-8b', 'qwen-3-235b-a22b-instruct-2507', 'zai-glm-4.7'],
    modelMetadata: {
      'gpt-oss-120b': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.35, outputCostPer1M: 0.75, supportsVision: false, supportsTools: true, reasoning: false },
      'llama3.1-8b': { contextWindow: 131072, maxOutputTokens: 131072, inputCostPer1M: 0.1, outputCostPer1M: 0.1, supportsVision: false, supportsTools: true, reasoning: false },
      'qwen-3-235b-a22b-instruct-2507': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 0.6, outputCostPer1M: 1.2, supportsVision: false, supportsTools: true, reasoning: false },
      'zai-glm-4.7': { contextWindow: 131072, maxOutputTokens: 65536, inputCostPer1M: 2.25, outputCostPer1M: 2.75, supportsVision: false, supportsTools: true, reasoning: false },
    },
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
    recommendedModels: ['kimi-k2.5', 'kimi-k2-thinking'],
    fallbackModels: ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    fallbackVisionModels: ['kimi-k2.5'],
    modelMetadata: {
      'kimi-k2.5': { contextWindow: 256000, maxOutputTokens: 16384, inputCostPer1M: 0.6, outputCostPer1M: 2.5, supportsVision: true, supportsTools: true, reasoning: true },
      'kimi-k2-thinking': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.6, outputCostPer1M: 2.5, supportsVision: false, supportsTools: true, reasoning: true },
      'kimi-k2': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.5, outputCostPer1M: 2.0, supportsVision: false, supportsTools: true, reasoning: false },
      'moonshot-v1-128k': { contextWindow: 131072, maxOutputTokens: 4096, inputCostPer1M: 8.5, outputCostPer1M: 8.5, supportsVision: false, supportsTools: true, reasoning: false },
      'moonshot-v1-32k': { contextWindow: 32768, maxOutputTokens: 4096, inputCostPer1M: 1.7, outputCostPer1M: 1.7, supportsVision: false, supportsTools: true, reasoning: false },
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
    staticModels: true, // MiniMax has no /models endpoint (GitHub issue #60)
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
    },
    recommendedModels: ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
    fallbackModels: ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed'],
    modelMetadata: {
      'MiniMax-M2.5': { contextWindow: 1000000, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 1.2, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMax-M2.5-highspeed': { contextWindow: 200000, maxOutputTokens: 131072, inputCostPer1M: 0.3, outputCostPer1M: 2.4, supportsVision: false, supportsTools: true, reasoning: true },
      'MiniMax-M2.1': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.3, outputCostPer1M: 1.2, supportsVision: false, supportsTools: true, reasoning: false },
      'MiniMax-M2.1-highspeed': { contextWindow: 128000, maxOutputTokens: 16384, inputCostPer1M: 0.15, outputCostPer1M: 0.6, supportsVision: false, supportsTools: true, reasoning: false },
    },
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
    staticModels: true, // Z.AI has no /models endpoint
    capabilities: {
      text: { supportsStreaming: true, supportsTools: true },
      vision: { supportsStreaming: true },
    },
    recommendedModels: ['glm-5', 'glm-4.7'],
    fallbackModels: ['glm-5', 'glm-4.7', 'glm-4.7-flash', 'glm-4.6v', 'glm-4.6v-flash', 'glm-4.5-flash'],
    fallbackVisionModels: ['glm-4.6v', 'glm-4.6v-flash'],
    modelMetadata: {
      'glm-5': { contextWindow: 200000, maxOutputTokens: 128000, inputCostPer1M: 1.0, outputCostPer1M: 3.2, supportsVision: false, supportsTools: true, reasoning: true },
      'glm-4.7': { contextWindow: 128000, maxOutputTokens: 128000, inputCostPer1M: 0.6, outputCostPer1M: 2.2, supportsVision: false, supportsTools: true, reasoning: false },
      'glm-4.7-flash': { contextWindow: 128000, maxOutputTokens: 128000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: false, supportsTools: true, reasoning: false },
      'glm-4.6v': { contextWindow: 128000, maxOutputTokens: 32000, inputCostPer1M: 0.3, outputCostPer1M: 0.9, supportsVision: true, supportsTools: true, reasoning: false },
      'glm-4.6v-flash': { contextWindow: 128000, maxOutputTokens: 32000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: true, supportsTools: true, reasoning: false },
      'glm-4.5-flash': { contextWindow: 128000, maxOutputTokens: 96000, inputCostPer1M: 0, outputCostPer1M: 0, supportsVision: false, supportsTools: true, reasoning: false },
    },
    compat: {},
    sdkOptions: {
      timeout: 300000, // 5 min — GLM-5 reasoning mode can have long TTFB
      defaultHeaders: { 'Accept-Language': 'en-US,en' }, // Required per Z.AI docs
    },
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

/** Get a provider config by key or name (display name, slug, etc.) */
export function getProviderConfig(key) {
  const lower = key.toLowerCase();
  // Direct key match
  const byKey = PROVIDER_CONFIGS.find((p) => p.key === lower);
  if (byKey) return byKey;
  // Fuzzy match: strip non-alphanumeric and compare
  const stripped = lower.replace(/[^a-z0-9]/g, '');
  return PROVIDER_CONFIGS.find((p) => p.key === stripped || p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === stripped);
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

/** Get recommended models for a provider (top models to show first in dropdowns) */
export function getRecommendedModels(providerKey) {
  const config = getProviderConfig(providerKey);
  return config?.recommendedModels || config?.fallbackModels?.slice(0, 3) || [];
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
 * Mapping of provider variants to their parent provider for metadata fallback.
 * When a variant (e.g. 'openai-codex') has no modelMetadata, we check the parent.
 */
const PROVIDER_METADATA_FALLBACK = {
  'openai-codex': 'openai',
  'openai-codex-cli': 'openai',
  'claude-code': 'anthropic',
  'gemini-cli': 'gemini',
};

/**
 * Dynamic pricing cache — populated at runtime from provider API responses.
 * Keyed by "providerKey:modelId", values are metadata objects with inputCostPer1M/outputCostPer1M.
 * Used for providers like OpenRouter that return per-model pricing in their API.
 */
const dynamicPricingCache = new Map();

/**
 * Register dynamic pricing for a model (from provider API response).
 * @param {string} providerKey - Provider key (e.g., 'openrouter')
 * @param {string} modelId - Model ID
 * @param {Object} metadata - { inputCostPer1M, outputCostPer1M, ... }
 */
export function registerDynamicPricing(providerKey, modelId, metadata) {
  if (metadata?.inputCostPer1M != null && metadata?.outputCostPer1M != null) {
    dynamicPricingCache.set(`${providerKey}:${modelId}`, metadata);
  }
}

/**
 * Register dynamic pricing from an array of fetched model objects.
 * Automatically extracts pricing from models that have it (e.g., OpenRouter format).
 * @param {string} providerKey - Provider key
 * @param {Object[]} models - Array of model objects from fetchModels()
 */
export function registerDynamicPricingFromModels(providerKey, models) {
  if (!models?.length) return;
  let registered = 0;
  for (const model of models) {
    // OpenRouter format: pricing.prompt/completion are cost per token
    if (model.pricing?.prompt != null && model.pricing?.completion != null) {
      const inputCostPer1M = parseFloat(model.pricing.prompt) * 1_000_000;
      const outputCostPer1M = parseFloat(model.pricing.completion) * 1_000_000;
      if (inputCostPer1M > 0 || outputCostPer1M > 0) {
        dynamicPricingCache.set(`${providerKey}:${model.id}`, {
          inputCostPer1M,
          outputCostPer1M,
          contextWindow: model.contextLength || 0,
          dynamic: true,
        });
        registered++;
      }
    }
  }
  if (registered > 0) {
    console.log(`[Dynamic Pricing] Registered pricing for ${registered} ${providerKey} models`);
  }
}

/**
 * Get metadata for a specific model.
 * Lookup order:
 *   1. Static modelMetadata on the requested provider
 *   2. Parent provider metadata (for known variants like claude-code → anthropic)
 *   3. Dynamic pricing cache (from provider API responses, e.g. OpenRouter)
 *   4. Cross-provider search (same model ID on a different provider)
 * Returns null if no metadata found (graceful degradation).
 */
export function getModelMetadata(providerKey, modelId) {
  // 1. Direct lookup on the requested provider
  const config = getProviderConfig(providerKey);
  if (config?.modelMetadata?.[modelId]) return config.modelMetadata[modelId];

  // 2. Fallback to parent provider for known variants
  const fallbackKey = PROVIDER_METADATA_FALLBACK[providerKey];
  if (fallbackKey) {
    const fallbackConfig = getProviderConfig(fallbackKey);
    if (fallbackConfig?.modelMetadata?.[modelId]) return fallbackConfig.modelMetadata[modelId];
  }

  // 3. Dynamic pricing cache (populated from provider API responses)
  const dynamicMeta = dynamicPricingCache.get(`${providerKey}:${modelId}`);
  if (dynamicMeta) return dynamicMeta;

  // 4. Last resort: search all providers for this model ID
  for (const p of PROVIDER_CONFIGS) {
    if (p.key === providerKey || p.key === fallbackKey) continue;
    if (p.modelMetadata?.[modelId]) return p.modelMetadata[modelId];
  }

  return null;
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
