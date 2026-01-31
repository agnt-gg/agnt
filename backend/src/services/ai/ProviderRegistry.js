/**
 * Centralized registry of AI provider capabilities
 * Single source of truth for what each provider supports
 *
 * Models can be fetched dynamically via fetchProviderModels()
 * Static models serve as fallbacks if dynamic fetching fails
 */

import fetch from 'node-fetch';

// Cache for dynamically fetched models
const modelCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 60 minutes

export const PROVIDER_CAPABILITIES = {
  openai: {
    text: {
      models: ['gpt-4.1'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['gpt-4.1'],
      supportsStreaming: true,
    },
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

  // OpenAI Codex uses the same OpenAI API surface but is authenticated via Codex CLI.
  'openai-codex': {
    text: {
      models: ['gpt-4.1'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['gpt-4.1'],
      supportsStreaming: true,
    },
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

  // OpenAI Codex CLI runs locally via `codex exec` and does not use the OpenAI Platform API.
  'openai-codex-cli': {
    text: {
      models: ['gpt-5-codex', 'gpt-5'],
      supportsStreaming: true,
      supportsTools: false,
    },
  },

  anthropic: {
    text: {
      models: ['claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['claude-sonnet-4-5-20250929'],
      supportsStreaming: true,
    },
  },

  // Claude Code uses the same Anthropic API surface but is authenticated via Claude CLI OAuth.
  'claude-code': {
    text: {
      models: ['claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['claude-sonnet-4-5-20250929'],
      supportsStreaming: true,
    },
  },

  cerebras: {
    text: {
      models: ['llama3.1-8b', 'llama-3.3-70b', 'gpt-oss-120b', 'qwen-3-32b', 'qwen-3-235b-a22b-instruct-2507', 'zai-glm-4.6'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: null,
    imageGen: null,
  },

  gemini: {
    text: {
      models: ['gemini-3-pro-preview'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['gemini-3-pro-preview'],
      supportsStreaming: true,
    },
    imageGen: {
      models: ['gemini-3-pro-image-preview', 'nano-banana-pro-preview'],
      operations: ['generate'],
      defaultModel: 'nano-banana-pro-preview',
      supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
      supportedResolutions: ['1K', '2K', '4K'],
      supportsGoogleSearch: true, // Grounding with real-time search
    },
  },

  grokai: {
    text: {
      models: ['grok-4-1-fast-reasoning'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['grok-4-1-fast-reasoning'],
      supportsStreaming: true,
    },
    imageGen: {
      models: ['grok-4-1-fast-reasoning'],
      operations: ['generate'],
      defaultModel: 'grok-4-1-fast-reasoning',
      supportedFormats: ['url', 'b64_json'],
      maxImages: 10,
      supportsRevisedPrompt: true, // Auto-enhanced prompts
    },
  },

  openrouter: {
    text: {
      models: [
        'openai/gpt-4-turbo',
        'openai/gpt-4',
        'openai/gpt-3.5-turbo',
        'anthropic/claude-3.5-sonnet',
        'anthropic/claude-3-opus',
        'google/gemini-pro-1.5',
        'meta-llama/llama-3.1-70b-instruct',
        'mistralai/mixtral-8x7b-instruct',
      ],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: [
        'openai/gpt-4-turbo',
        'openai/gpt-4o',
        'anthropic/claude-3.5-sonnet',
        'google/gemini-pro-1.5-vision',
      ],
      supportsStreaming: true,
    },
    imageGen: null,
  },

  kimi: {
    text: {
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['moonshot-v1-128k'],
      supportsStreaming: true,
    },
    imageGen: null,
  },

  minimax: {
    text: {
      models: ['abab6.5s-chat', 'abab6.5-chat', 'abab6.5g-chat', 'abab5.5s-chat'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: null,
    imageGen: null,
  },

  zai: {
    text: {
      models: ['glm-4.7', 'glm-4-plus', 'glm-4', 'glm-4-air', 'glm-4-flash'],
      supportsStreaming: true,
      supportsTools: true,
    },
    vision: {
      models: ['glm-4.7', 'glm-4-plus', 'glm-4'],
      supportsStreaming: true,
    },
    imageGen: null,
  },
};

/**
 * Get all providers that support image generation
 * @returns {Array<{provider: string, models: string[], operations: string[], defaultModel: string}>}
 */
export function getImageGenProviders() {
  return Object.entries(PROVIDER_CAPABILITIES)
    .filter(([_, caps]) => caps.imageGen !== null)
    .map(([provider, caps]) => ({
      provider,
      models: caps.imageGen.models,
      operations: caps.imageGen.operations,
      defaultModel: caps.imageGen.defaultModel,
      capabilities: caps.imageGen,
    }));
}

/**
 * Check if a provider supports image generation
 * @param {string} provider - Provider name (case-insensitive)
 * @returns {boolean}
 */
export function supportsImageGeneration(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps && caps.imageGen !== null;
}

/**
 * Get image generation capabilities for a specific provider
 * @param {string} provider - Provider name (case-insensitive)
 * @returns {object|null} Image generation capabilities or null if not supported
 */
export function getImageGenCapabilities(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.imageGen || null;
}

/**
 * Get the default image generation model for a provider
 * @param {string} provider - Provider name (case-insensitive)
 * @returns {string|null} Default model name or null if not supported
 */
export function getDefaultImageModel(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.imageGen?.defaultModel || null;
}

/**
 * Validate if a model supports image generation for a given provider
 * @param {string} provider - Provider name (case-insensitive)
 * @param {string} model - Model name
 * @returns {boolean}
 */
export function isValidImageModel(provider, model) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.imageGen?.models.includes(model) || false;
}

/**
 * Get all text generation models for a provider
 * @param {string} provider - Provider name (case-insensitive)
 * @returns {string[]} Array of model names
 */
export function getTextModels(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.text?.models || [];
}

/**
 * Get all vision models for a provider
 * @param {string} provider - Provider name (case-insensitive)
 * @returns {string[]} Array of model names
 */
export function getVisionModels(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.vision?.models || [];
}

/**
 * Get a formatted list of image generation providers for display
 * @returns {string} Formatted string listing providers and their capabilities
 */
export function getImageGenProvidersDescription() {
  const providers = getImageGenProviders();

  if (providers.length === 0) {
    return 'No image generation providers available.';
  }

  const descriptions = providers.map(({ provider, models, operations, defaultModel }) => {
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
    return `- **${providerName}**: Models: ${models.join(', ')} (default: ${defaultModel}). Operations: ${operations.join(', ')}`;
  });

  return descriptions.join('\n');
}

/**
 * Fetch models dynamically from the ModelRoutes API
 * @param {string} provider - Provider name
 * @param {string} userId - User ID for authentication
 * @param {string} authToken - Bearer token for API authentication
 * @returns {Promise<string[]>} Array of model names
 */
export async function fetchProviderModels(provider, userId, authToken) {
  const normalizedProvider = provider.toLowerCase();
  const cacheKey = `${normalizedProvider}-${userId}`;

  // Check cache first
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[ProviderRegistry] Using cached models for ${provider}`);
    return cached.models;
  }

  try {
    const apiUrl = `http://localhost:${process.env.PORT || 3333}/api/models/${normalizedProvider}/models`;
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      console.warn(`[ProviderRegistry] Failed to fetch models for ${provider}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const models = data.models || [];

    // Cache the results
    modelCache.set(cacheKey, {
      models,
      timestamp: Date.now(),
    });

    console.log(`[ProviderRegistry] Fetched ${models.length} models for ${provider}`);
    return models;
  } catch (error) {
    console.error(`[ProviderRegistry] Error fetching models for ${provider}:`, error.message);
    return null;
  }
}

/**
 * Filter models to identify image generation models
 * @param {string[]} models - Array of model names
 * @param {string} provider - Provider name
 * @returns {string[]} Array of image generation model names
 */
function filterImageGenModels(models, provider) {
  const normalizedProvider = provider.toLowerCase();

  // Provider-specific filtering logic
  const filters = {
    openai: (model) => model.includes('dall-e') || model.includes('gpt-image'),
    gemini: (model) => model.includes('image') || model.includes('nano-banana') || model.includes('imagen'),
    grokai: (model) => model.includes('image') || model.includes('grok-2-image'),
  };

  const filter = filters[normalizedProvider];
  if (!filter) {
    return [];
  }

  return models.filter(filter);
}

/**
 * Get image generation models dynamically with fallback to static list
 * @param {string} provider - Provider name
 * @param {string} userId - User ID (optional, for dynamic fetching)
 * @param {string} authToken - Auth token (optional, for dynamic fetching)
 * @returns {Promise<string[]>} Array of image generation model names
 */
export async function getImageGenModels(provider, userId = null, authToken = null) {
  const normalizedProvider = provider.toLowerCase();

  // Try dynamic fetching if credentials provided
  if (userId && authToken) {
    try {
      const allModels = await fetchProviderModels(normalizedProvider, userId, authToken);
      if (allModels && allModels.length > 0) {
        const imageModels = filterImageGenModels(allModels, normalizedProvider);
        if (imageModels.length > 0) {
          console.log(`[ProviderRegistry] Using ${imageModels.length} dynamic image models for ${provider}`);
          return imageModels;
        }
      }
    } catch (error) {
      console.warn(`[ProviderRegistry] Dynamic fetch failed for ${provider}, falling back to static list`);
    }
  }

  // Fallback to static list
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  const staticModels = caps?.imageGen?.models || [];
  console.log(`[ProviderRegistry] Using ${staticModels.length} static image models for ${provider}`);
  return staticModels;
}

/**
 * Validate if a model supports image generation (checks both dynamic and static lists)
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {string} userId - User ID (optional)
 * @param {string} authToken - Auth token (optional)
 * @returns {Promise<boolean>}
 */
export async function isValidImageModelDynamic(provider, model, userId = null, authToken = null) {
  const models = await getImageGenModels(provider, userId, authToken);
  return models.includes(model);
}

/**
 * Clear the model cache (useful for testing or forcing refresh)
 */
export function clearModelCache() {
  modelCache.clear();
  console.log('[ProviderRegistry] Model cache cleared');
}

export default {
  PROVIDER_CAPABILITIES,
  getImageGenProviders,
  supportsImageGeneration,
  getImageGenCapabilities,
  getDefaultImageModel,
  isValidImageModel,
  isValidImageModelDynamic,
  getTextModels,
  getVisionModels,
  getImageGenProvidersDescription,
  fetchProviderModels,
  getImageGenModels,
  clearModelCache,
};
