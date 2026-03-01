/**
 * Centralized registry of AI provider capabilities.
 * Now derived from providerConfigs.js (single source of truth).
 *
 * Models can be fetched dynamically via fetchProviderModels()
 * Static models serve as fallbacks if dynamic fetching fails.
 */

import fetch from 'node-fetch';
import { buildProviderCapabilities, getProviderConfig, getAllProviderConfigs } from './providerConfigs.js';

// Cache for dynamically fetched models
const modelCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 60 minutes

// Derive PROVIDER_CAPABILITIES from the declarative config
export const PROVIDER_CAPABILITIES = buildProviderCapabilities();

/**
 * Get all providers that support image generation
 */
export function getImageGenProviders() {
  return Object.entries(PROVIDER_CAPABILITIES)
    .filter(([_, caps]) => caps.imageGen !== null && caps.imageGen !== undefined)
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
 */
export function supportsImageGeneration(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps && caps.imageGen !== null && caps.imageGen !== undefined;
}

/**
 * Get image generation capabilities for a specific provider
 */
export function getImageGenCapabilities(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.imageGen || null;
}

/**
 * Get the default image generation model for a provider
 */
export function getDefaultImageModel(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.imageGen?.defaultModel || null;
}

/**
 * Validate if a model supports image generation for a given provider
 */
export function isValidImageModel(provider, model) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.imageGen?.models.includes(model) || false;
}

/**
 * Get all text generation models for a provider
 */
export function getTextModels(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.text?.models || [];
}

/**
 * Get all vision models for a provider
 */
export function getVisionModels(provider) {
  const normalizedProvider = provider.toLowerCase();
  const caps = PROVIDER_CAPABILITIES[normalizedProvider];
  return caps?.vision?.models || [];
}

/**
 * Get a formatted list of image generation providers for display
 */
export function getImageGenProvidersDescription() {
  const providers = getImageGenProviders();

  if (providers.length === 0) {
    return 'No image generation providers available.';
  }

  const descriptions = providers.map(({ provider, models, operations, defaultModel }) => {
    const config = getProviderConfig(provider);
    const providerName = config?.name || provider.charAt(0).toUpperCase() + provider.slice(1);
    return `- **${providerName}**: Models: ${models.join(', ')} (default: ${defaultModel}). Operations: ${operations.join(', ')}`;
  });

  return descriptions.join('\n');
}

/**
 * Fetch models dynamically from the ModelRoutes API
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
 */
function filterImageGenModels(models, provider) {
  const normalizedProvider = provider.toLowerCase();

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
 */
export async function isValidImageModelDynamic(provider, model, userId = null, authToken = null) {
  const models = await getImageGenModels(provider, userId, authToken);
  return models.includes(model);
}

/**
 * Clear the model cache
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
