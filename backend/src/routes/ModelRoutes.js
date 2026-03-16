import express from 'express';
import GenericProviderService from '../services/ai/providers/GenericProviderService.js';
import { getAllProviderConfigs, getProviderConfig, getModelMetadata, getModelCost, isReasoningModel, getAllModelMetadata, registerDynamicPricingFromModels } from '../services/ai/providerConfigs.js';
import providerHealthCheck from '../services/ai/ProviderHealthCheck.js';
import AuthManager from '../services/auth/AuthManager.js';
import CodexAuthManager from '../services/auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../services/auth/ClaudeCodeAuthManager.js';
import GeminiCliAuthManager from '../services/auth/GeminiCliAuthManager.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// ─────────────────────────── AUTO-INSTANTIATE PROVIDER SERVICES ───────────────────────────
// Instead of importing 14 individual provider singletons, we auto-create services from config.

// ─────────────────────────── CODEX MODEL FETCHER ───────────────────────────
// Fetches models from chatgpt.com/backend-api/codex/models using the Codex OAuth token.
// This is a separate endpoint from api.openai.com/v1/models (which requires api.model.read scope).

let codexModelsCache = null;
let codexModelsCacheTime = 0;
const CODEX_MODELS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchCodexModels(token) {
  const now = Date.now();
  if (codexModelsCache && now - codexModelsCacheTime < CODEX_MODELS_CACHE_TTL) {
    return codexModelsCache;
  }

  const config = getProviderConfig('openai-codex');
  const fallback = (config?.fallbackModels || []).map((id) => ({
    id, name: id, description: '', createdAt: null, ownedBy: 'openai-codex',
  }));

  try {
    const accountId = CodexAuthManager.getChatGptAccountId();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'originator': 'codex_cli_rs',
    };
    if (accountId) headers['ChatGPT-Account-ID'] = accountId;

    const url = 'https://chatgpt.com/backend-api/codex/models?client_version=0.112.0';
    console.log(`[ModelRoutes] Fetching Codex models from ${url} (account: ${accountId || 'none'})`);

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[ModelRoutes] Codex models endpoint returned ${res.status}: ${body.slice(0, 200)}`);
      return fallback;
    }

    const data = await res.json();
    // Response format: { "models": [ { slug, display_name, description, context_window, priority, visibility, ... } ] }
    const models = data.models;
    if (!Array.isArray(models) || models.length === 0) {
      console.warn('[ModelRoutes] Codex models response had no models array, raw keys:', Object.keys(data));
      return fallback;
    }

    const mapped = models
      .filter((m) => m.slug && m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((m) => ({
        id: m.slug,
        name: m.display_name || m.slug,
        description: m.description || '',
        createdAt: null,
        ownedBy: 'openai-codex',
        contextWindow: m.context_window || null,
      }));

    console.log(`[ModelRoutes] Fetched ${mapped.length} Codex models: ${mapped.map((m) => m.id).join(', ')}`);

    codexModelsCache = mapped;
    codexModelsCacheTime = now;
    return mapped;
  } catch (error) {
    console.warn(`[ModelRoutes] Failed to fetch Codex models: ${error.message}`);
    return fallback;
  }
}

const providerServices = {};
for (const config of getAllProviderConfigs()) {
  const recommended = config.recommendedModels || config.fallbackModels.slice(0, 3);
  if (config.codexModelFetch) {
    // Codex: dynamic fetch from chatgpt.com/backend-api/codex/models (handled in route)
    providerServices[config.key] = {
      fetchModels: async (token) => fetchCodexModels(token),
      getModelNames: async (token) => (await fetchCodexModels(token)).map((m) => m.id),
      isCacheValid: () => codexModelsCache && Date.now() - codexModelsCacheTime < CODEX_MODELS_CACHE_TTL,
      clearCache: () => { codexModelsCache = null; codexModelsCacheTime = 0; },
    };
  } else if (config.staticModels) {
    // Static model list — no API call needed
    const recSet = new Set(recommended);
    const orderedModels = [
      ...recommended.filter((id) => config.fallbackModels.includes(id)),
      ...config.fallbackModels.filter((id) => !recSet.has(id)),
    ];
    providerServices[config.key] = {
      fetchModels: async () =>
        orderedModels.map((id) => ({
          id,
          name: id,
          description: '',
          createdAt: null,
          ownedBy: config.key,
        })),
      getModelNames: async () => orderedModels,
      isCacheValid: () => true,
      clearCache: () => {},
    };
  } else {
    providerServices[config.key] = new GenericProviderService({
      name: config.name,
      baseURL: config.modelsBaseURL || config.baseURL,
      fallbackModels: config.fallbackModels,
      recommendedModels: recommended,
      fallbackModelObjects: config.fallbackModelObjects || null,
      headers: config.fetchHeaders || {},
      authScheme:
        config.authScheme === 'api-key'
          ? 'api-key'
          : config.authScheme === 'query-param'
            ? 'query-param'
            : config.authScheme === 'claude-code'
              ? 'claude-code'
              : 'bearer',
      modelsPath: config.modelsPath || '/models',
      responseDataPath: config.responseDataPath || 'data',
      transformModel: config.modelTransform || undefined,
      filterModel: config.modelFilter || undefined,
      supportsPagination: config.pagination?.enabled || false,
      paginationConfig: config.pagination || {},
    });
  }
}

// Aliases
providerServices['grok'] = providerServices['grokai'];

// Providers that have hardcoded models and don't require API key for model listing
const providersWithHardcodedModels = getAllProviderConfigs()
  .filter((c) => c.staticModels)
  .map((c) => c.key);

// ─────────────────────────── ROUTES ───────────────────────────

// Generic endpoint for fetching models from any provider
router.get('/:provider/models', async (req, res) => {
  try {
    const { provider } = req.params;
    // Resolve display names (e.g., "Z-AI" → "zai", "Grok AI" → "grokai")
    const resolved = getProviderConfig(provider);
    const providerLower = resolved ? resolved.key : provider.toLowerCase();

    // Get the service for this provider
    const service = providerServices[providerLower];
    if (!service) {
      return res.status(400).json({
        success: false,
        error: `Unknown provider: ${provider}`,
        availableProviders: Object.keys(providerServices),
      });
    }

    // Check if this provider has hardcoded models (doesn't need API key for listing)
    const hasHardcodedModels = providersWithHardcodedModels.includes(providerLower);

    let apiKey = null;

    // Only require authentication and API key for providers that need it
    if (!hasHardcodedModels) {
      // OpenAI Codex: fetch models from api.openai.com using Codex OAuth token
      if (providerLower === 'openai-codex') {
        apiKey = await CodexAuthManager.ensureValidToken();
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: 'OpenAI Codex is not connected. Start device login from the provider setup.',
          });
        }
      }
      // Claude Code: use local Claude Code OAuth auth.
      else if (providerLower === 'claude-code') {
        const ccStatus = await ClaudeCodeAuthManager.checkApiUsable();
        if (!ccStatus.available) {
          return res.status(400).json({
            success: false,
            error: 'Claude Code is not connected. Use setup-token or paste a token to connect.',
          });
        }
        apiKey = await ClaudeCodeAuthManager.getAccessToken();
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: 'Claude Code token not found.',
          });
        }
      }
      // Gemini CLI: uses GeminiCliAuthManager (OAuth or manual API key)
      // Only triggered for 'gemini-cli' — regular 'gemini' uses standard API key flow below
      else if (providerLower === 'gemini-cli') {
        const gcStatus = await GeminiCliAuthManager.checkApiUsable();
        if (!gcStatus.available) {
          return res.status(400).json({
            success: false,
            error: 'Gemini CLI is not connected. Use Google OAuth or paste an API key to connect.',
          });
        }
        apiKey = await GeminiCliAuthManager.getAccessToken();
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: 'Gemini CLI token not found.',
          });
        }

        if (GeminiCliAuthManager.isUsingApiKey()) {
          // API key → fetch models dynamically via the standard gemini provider service
          const geminiService = providerServices['gemini'];
          if (geminiService) {
            const { category, useCache = 'true', format = 'names' } = req.query;
            const options = { category, useCache: useCache === 'true' };
            let models;
            if (format === 'full') {
              models = await geminiService.fetchModels(apiKey, options);
            } else {
              models = await geminiService.getModelNames(apiKey, options);
            }
            return res.json({ success: true, models, cached: geminiService.isCacheValid(), count: models.length });
          }
        } else {
          // OAuth → Code Assist endpoint has no /models listing, use curated list
          // Ensure onboarding has run so tier info is populated (no-ops if already done)
          await GeminiCliAuthManager.ensureOnboarded();

          const { getProviderConfig } = await import('../services/ai/providerConfigs.js');
          const cfg = getProviderConfig('gemini-cli');
          const models = [...(cfg?.fallbackModels || [])];

          // gemini-3.1-pro-preview is only available to paid/standard tier users
          if (GeminiCliAuthManager.hasPaidTier() && !models.includes('gemini-3.1-pro-preview')) {
            const idx = models.indexOf('gemini-3-pro-preview');
            models.splice(idx >= 0 ? idx + 1 : 1, 0, 'gemini-3.1-pro-preview');
          }

          return res.json({ success: true, models, cached: false, count: models.length });
        }
      } else {
        // Standard providers: extract user ID from auth token
        const authToken = req.headers.authorization;
        if (!authToken || !authToken.startsWith('Bearer ')) {
          return res.status(401).json({
            success: false,
            error: `Authentication required to fetch ${provider} models`,
          });
        }

        let userId = null;
        try {
          const token = authToken.split(' ')[1];
          const payload = jwt.decode(token);
          userId = payload?.id || payload?.userId || payload?.user_id || payload?.sub;
        } catch (e) {
          return res.status(401).json({
            success: false,
            error: 'Invalid authentication token',
          });
        }

        if (!userId) {
          return res.status(401).json({
            success: false,
            error: 'Could not extract user ID from token',
          });
        }

        // Get API key for the user
        apiKey = await AuthManager.getValidAccessToken(userId, providerLower);
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: `${provider} API key not found. Please configure your ${provider} API key in settings.`,
          });
        }
      }
    }

    // Parse query parameters
    const { category, useCache = 'true', format = 'names' } = req.query;
    const options = {
      category,
      useCache: useCache === 'true',
    };

    // Fetch models (apiKey may be null for hardcoded providers, which is fine)
    let models;
    if (format === 'full') {
      models = await service.fetchModels(apiKey, options);
      // Register dynamic pricing from models that include it (e.g., OpenRouter)
      registerDynamicPricingFromModels(providerLower, models);
    } else {
      models = await service.getModelNames(apiKey, options);
      // Also register pricing from the cached full model objects
      if (service.modelsCache) {
        registerDynamicPricingFromModels(providerLower, service.modelsCache);
      }
    }

    res.json({
      success: true,
      models,
      cached: service.isCacheValid(),
      count: models.length,
    });
  } catch (error) {
    console.error(`Error fetching ${req.params.provider} models:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to fetch ${req.params.provider} models`,
      details: error.message,
    });
  }
});

// Generic endpoint for refreshing models cache
router.post('/:provider/models/refresh', async (req, res) => {
  try {
    const { provider } = req.params;
    const resolved = getProviderConfig(provider);
    const providerLower = resolved ? resolved.key : provider.toLowerCase();

    // Get the service for this provider
    const service = providerServices[providerLower];
    if (!service) {
      return res.status(400).json({
        success: false,
        error: `Unknown provider: ${provider}`,
      });
    }

    // Extract user ID from auth token
    const authToken = req.headers.authorization;
    let apiKey = null;
    const hasHardcodedModels = providersWithHardcodedModels.includes(providerLower);

    if (providerLower === 'claude-code') {
      const ccStatus = await ClaudeCodeAuthManager.checkApiUsable({ forceRefresh: true });
      if (!ccStatus.available) {
        return res.status(400).json({
          success: false,
          error: 'Claude Code is not connected. Use setup-token or paste a token to connect.',
        });
      }
      apiKey = await ClaudeCodeAuthManager.getAccessToken();
    } else if (providerLower === 'gemini-cli') {
      const gcStatus = await GeminiCliAuthManager.checkApiUsable({ forceRefresh: true });
      if (!gcStatus.available) {
        return res.status(400).json({
          success: false,
          error: 'Gemini CLI is not connected. Use Google OAuth or paste an API key to connect.',
        });
      }
      apiKey = await GeminiCliAuthManager.getAccessToken();
    } else if (providerLower === 'openai-codex') {
      const codexStatus = await CodexAuthManager.checkApiUsable({ forceRefresh: true });
      if (!codexStatus.available) {
        return res.status(400).json({
          success: false,
          error: 'OpenAI Codex is not connected. Start device login from the provider setup.',
        });
      }
      if (!codexStatus.apiUsable) {
        const detail = codexStatus.apiStatus ? ` (API status: ${codexStatus.apiStatus})` : '';
        return res.status(400).json({
          success: false,
          error: `OpenAI Codex is connected but the OpenAI API is not usable${detail}.`,
        });
      }
      apiKey = CodexAuthManager.getAccessToken();
    } else if (!hasHardcodedModels) {
      if (!authToken || !authToken.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      let userId = null;
      try {
        const token = authToken.split(' ')[1];
        const payload = jwt.decode(token);
        userId = payload?.id || payload?.userId || payload?.user_id || payload?.sub;
      } catch (e) {
        return res.status(401).json({
          success: false,
          error: 'Invalid authentication token',
        });
      }

      // Get API key for the user
      apiKey = await AuthManager.getValidAccessToken(userId, providerLower);
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: `${provider} API key not found`,
        });
      }
    }

    // Clear cache and fetch fresh models
    service.clearCache();
    const models = await service.getModelNames(apiKey, { useCache: false });

    // Register dynamic pricing from cached full model objects
    if (service.modelsCache) {
      registerDynamicPricingFromModels(providerLower, service.modelsCache);
    }

    res.json({
      success: true,
      models,
      count: models.length,
      message: `${provider} models cache refreshed successfully`,
    });
  } catch (error) {
    console.error(`Error refreshing ${req.params.provider} models:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to refresh ${req.params.provider} models`,
      details: error.message,
    });
  }
});

// Legacy endpoint for OpenRouter (backward compatibility)
router.get('/models', async (req, res) => {
  req.params.provider = 'openrouter';
  return router.handle(req, res);
});

router.post('/models/refresh', async (req, res) => {
  req.params.provider = 'openrouter';
  return router.handle(req, res);
});

router.get('/models/categories', async (req, res) => {
  try {
    const categories = [
      { id: 'all', name: 'All Models', description: 'All available models' },
      { id: 'programming', name: 'Programming', description: 'Models optimized for code generation and programming tasks' },
      { id: 'creative', name: 'Creative', description: 'Models optimized for creative writing and content generation' },
      { id: 'reasoning', name: 'Reasoning', description: 'Models optimized for logical reasoning and problem solving' },
    ];

    res.json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error('Error fetching model categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch model categories',
      details: error.message,
    });
  }
});

// ─────────────────────────── MODEL METADATA ───────────────────────────

// Get metadata for all models of a provider
router.get('/:provider/metadata', (req, res) => {
  const { provider } = req.params;
  const metadata = getAllModelMetadata(provider.toLowerCase());
  res.json({ success: true, provider: provider.toLowerCase(), metadata });
});

// Get metadata for a specific model
router.get('/:provider/metadata/:modelId', (req, res) => {
  const { provider, modelId } = req.params;
  const metadata = getModelMetadata(provider.toLowerCase(), modelId);
  if (!metadata) {
    return res.json({ success: true, provider: provider.toLowerCase(), model: modelId, metadata: null });
  }

  // Include cost estimate if query params provided
  const { inputTokens, outputTokens } = req.query;
  let cost = null;
  if (inputTokens && outputTokens) {
    cost = getModelCost(provider.toLowerCase(), modelId, parseInt(inputTokens, 10), parseInt(outputTokens, 10));
  }

  res.json({
    success: true,
    provider: provider.toLowerCase(),
    model: modelId,
    metadata,
    reasoning: isReasoningModel(provider.toLowerCase(), modelId),
    ...(cost && { cost }),
  });
});

// ─────────────────────────── PROVIDER HEALTH ───────────────────────────

router.get('/provider-health', async (req, res) => {
  try {
    const status = providerHealthCheck.getStatus();
    const summary = providerHealthCheck.getSummary();

    res.json({
      success: true,
      ...summary,
      providers: status,
    });
  } catch (error) {
    console.error('Error fetching provider health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch provider health',
      details: error.message,
    });
  }
});

router.post('/provider-health/check', async (req, res) => {
  try {
    const authToken = req.headers.authorization;
    let userId = null;

    if (authToken && authToken.startsWith('Bearer ')) {
      try {
        const token = authToken.split(' ')[1];
        const payload = jwt.decode(token);
        userId = payload?.id || payload?.userId || payload?.user_id || payload?.sub;
      } catch (e) {
        // Ignore
      }
    }

    const results = await providerHealthCheck.checkAll(async (providerKey) => {
      if (!userId) return null;
      return AuthManager.getValidAccessToken(userId, providerKey);
    });

    const summary = providerHealthCheck.getSummary();

    res.json({
      success: true,
      ...summary,
      providers: results,
    });
  } catch (error) {
    console.error('Error running provider health check:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run provider health check',
      details: error.message,
    });
  }
});

export default router;
