import express from 'express';
import crypto from 'crypto';
import GenericProviderService from '../services/ai/providers/GenericProviderService.js';
import {
  getAllProviderConfigs,
  getProviderConfig,
  getModelMetadata,
  getModelCost,
  isReasoningModel,
  getAllModelMetadataForClient,
  getModelMetadataForClient,
  registerDynamicPricing,
  registerDynamicPricingFromModels,
} from '../services/ai/providerConfigs.js';
import providerHealthCheck from '../services/ai/ProviderHealthCheck.js';
import AuthManager from '../services/auth/AuthManager.js';
import CodexAuthManager from '../services/auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../services/auth/ClaudeCodeAuthManager.js';
import GeminiCliAuthManager from '../services/auth/GeminiCliAuthManager.js';
import AntigravityAuthManager from '../services/auth/AntigravityAuthManager.js';
import { getClientVersion } from '../services/ai/clientVersions.js';
import { persistLastModels, getLastSuccessfulModels } from '../services/ai/lastModelsCache.js';
import jwt from 'jsonwebtoken';

// ───────────────────────── PERSISTENT LAST-SUCCESSFUL MODEL CACHE ──────────────────────
// Whenever an upstream fetch succeeds we persist the model list to disk so a
// later degraded state (upstream 5xx, network out, auth blip) can still show
// the currently-shipping models instead of collapsing to the hardcoded
// fallback list in providerConfigs.js. Small (~2 KB per provider) JSON file,
// no TTL — always superseded by a fresh live fetch, only read when live fails.
// Helpers now live in services/ai/lastModelsCache.js — shared with
// GenericProviderService so EVERY provider (not just Codex) persists its
// last-successful fetch and survives upstream outages with real data.

const router = express.Router();

// ─────────────────────────── AUTO-INSTANTIATE PROVIDER SERVICES ───────────────────────────
// Instead of importing 14 individual provider singletons, we auto-create services from config.

// ─────────────────────────── CODEX MODEL FETCHER ───────────────────────────
// Fetches models from chatgpt.com/backend-api/codex/models using the Codex OAuth token.
// This is a separate endpoint from api.openai.com/v1/models (which requires api.model.read scope).

let codexModelsCache = null;
let codexModelsCacheTime = 0;
// 5 min: model lists are cheap to fetch and rarely change, but new models
// launch often enough that a 1-hour TTL hides them from users on release day.
const CODEX_MODELS_CACHE_TTL = 5 * 60 * 1000;
// Half-life: past this age we serve cached AND kick off background refresh.
const CODEX_MODELS_SWR_MS = Math.floor(CODEX_MODELS_CACHE_TTL / 2);
let codexBackgroundInflight = false;

async function fetchCodexModels(token, options = {}) {
  const { force = false } = options;
  const now = Date.now();

  if (!force && codexModelsCache && now - codexModelsCacheTime < CODEX_MODELS_CACHE_TTL) {
    // Stale-while-revalidate: past half-life, kick off background refresh.
    const age = now - codexModelsCacheTime;
    if (age > CODEX_MODELS_SWR_MS && !codexBackgroundInflight) {
      codexBackgroundInflight = true;
      _fetchCodexModelsFromUpstream(token)
        .catch((err) => console.warn(`[ModelRoutes] Codex background revalidate failed: ${err.message}`))
        .finally(() => { codexBackgroundInflight = false; });
    }
    return codexModelsCache;
  }

  return _fetchCodexModelsFromUpstream(token);
}

async function _fetchCodexModelsFromUpstream(token) {
  const now = Date.now();
  const config = getProviderConfig('openai-codex');

  // Fallback resolution: persisted last-successful first, then hardcoded.
  const persisted = getLastSuccessfulModels('openai-codex');
  const fallback = persisted && persisted.length > 0
    ? persisted
    : (config?.fallbackModels || []).map((id) => ({
        id, name: id, description: '', createdAt: null, ownedBy: 'openai-codex',
      }));

  try {
    const accountId = CodexAuthManager.getChatGptAccountId();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'originator': 'codex_cli_rs',
    };
    if (accountId) headers['ChatGPT-Account-ID'] = accountId;

    const clientVersion = await getClientVersion('openai-codex');
    const url = `https://chatgpt.com/backend-api/codex/models?client_version=${clientVersion}`;
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

    // Register contextWindow for compression. The ChatGPT Codex backend exposes
    // a per-model context_window that doesn't match the underlying OpenAI model
    // metadata (gpt-5.5 in particular has a smaller per-request input cap than
    // 128k). Without this, manageContext() falls back to DEFAULT_TOKEN_LIMIT
    // and the API rejects long inputs before compression triggers.
    for (const m of mapped) {
      if (m.contextWindow) {
        registerDynamicPricing('openai-codex', m.id, { contextWindow: m.contextWindow });
      }
    }

    codexModelsCache = mapped;
    codexModelsCacheTime = now;
    // Persist last-successful so a later degraded state doesn't collapse
    // to the stale hardcoded fallback list.
    persistLastModels('openai-codex', mapped);
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
      fetchModels: async (token, opts = {}) => fetchCodexModels(token, opts),
      getModelNames: async (token, opts = {}) => (await fetchCodexModels(token, opts)).map((m) => m.id),
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

// Providers whose model listing works WITHOUT a stored key: we still try the
// dynamic fetch first (it fails fast upstream without auth), and the service's
// fallback ladder (persisted last-successful → hardcoded) keeps the dropdown
// populated. This preserves browse-before-connect UX for providers that were
// previously staticModels (zai, minimax, kimi-code).
const providersWithKeyOptionalListing = getAllProviderConfigs()
  .filter((c) => c.modelListingKeyOptional)
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
      // OpenAI Codex: model fetching hits chatgpt.com/backend-api/codex/models
      // which ONLY accepts a ChatGPT OAuth token (the chatgpt-account-id header is
      // derived from the OAuth JWT). Do not use ensureValidToken here — it honors
      // the env-level OPENAI_API_KEY override and would send a sk-* key to an
      // endpoint that rejects it, collapsing the model list to the fallback.
      if (providerLower === 'openai-codex') {
        apiKey = CodexAuthManager.getOAuthToken();
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: 'OpenAI Codex is not connected. Start device login from the provider setup.',
          });
        }
        // Refresh if the OAuth token is expiring soon (ensureValidToken does this
        // but also pulls in the API-key path we just rejected; re-do the refresh
        // step inline so we keep the OAuth-only guarantee).
        if (CodexAuthManager.isTokenExpiringSoon()) {
          const refresh = await CodexAuthManager.refreshAccessToken();
          if (refresh?.success) {
            apiKey = CodexAuthManager.getOAuthToken() || apiKey;
          }
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
          // Google discontinued Gemini CLI consumer OAuth on June 18, 2026 (PRD-107).
          // Surface a clear diagnostic instead of a cryptic downstream 403.
          if (gcStatus.deprecated) {
            return res.status(400).json({ success: false, error: gcStatus.hint, deprecated: true });
          }
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
      }
      // Antigravity: OAuth-only gateway (Gemini 3.x + Claude 4.6 + GPT-OSS).
      // Tries the live fetchAvailableModels endpoint, falls back to curated list.
      else if (providerLower === 'antigravity') {
        const agStatus = await AntigravityAuthManager.checkApiUsable();
        if (!agStatus.available) {
          return res.status(400).json({
            success: false,
            error: 'Antigravity is not connected. Use Google OAuth to connect.',
          });
        }
        // PRD-109: while cooling down after a 403/429, don't hit Google for models.
        if (agStatus.coolingDown) {
          return res.status(429).json({
            success: false, coolingDown: true, retryAfterMs: agStatus.retryAfterMs,
            error: agStatus.hint,
          });
        }
        apiKey = await AntigravityAuthManager.getAccessToken();
        if (!apiKey) {
          return res.status(400).json({ success: false, error: 'Antigravity token not found.' });
        }

        // Try dynamic model listing via fetchAvailableModels
        try {
          const oauth2Client = AntigravityAuthManager.getOAuth2Client();
          if (oauth2Client) {
            const dynamicModels = await AntigravityAuthManager.fetchAvailableModels(oauth2Client);
            if (dynamicModels.length > 0) {
              const modelNames = dynamicModels.map((m) => m.id);
              return res.json({ success: true, models: modelNames, cached: false, count: modelNames.length, dynamic: true });
            }
          }
        } catch (e) {
          console.warn('[ModelRoutes] Antigravity dynamic model fetch failed, using fallback:', e.message);
        }

        // Fallback to the static curated list
        const { getProviderConfig } = await import('../services/ai/providerConfigs.js');
        const cfg = getProviderConfig('antigravity');
        const models = [...(cfg?.fallbackModels || [])];
        return res.json({ success: true, models, cached: false, count: models.length });
      }
      // Grok Build CLI — local subscription; list via `grok models` or static fallback
      else if (providerLower === 'grok-build') {
        const { default: GrokBuildAuthManager } = await import('../services/auth/GrokBuildAuthManager.js');
        const status = await GrokBuildAuthManager.checkApiUsable();
        if (!status.available && !status.apiUsable) {
          return res.status(400).json({
            success: false,
            error: 'Grok Build CLI is not authenticated. Run: grok login --oauth',
          });
        }
        let models = Array.isArray(status.models) && status.models.length > 0 ? [...status.models] : [];
        if (models.length === 0) {
          const { getProviderConfig } = await import('../services/ai/providerConfigs.js');
          const cfg = getProviderConfig('grok-build');
          models = [...(cfg?.fallbackModels || ['grok-4.5'])];
        }
        return res.json({ success: true, models, cached: false, count: models.length });
      } else {
        // Standard providers: extract user ID from auth token.
        // keyOptional providers tolerate missing auth/key — the dynamic fetch
        // proceeds with a null key, fails fast upstream, and the service's
        // fallback ladder (persisted → hardcoded) serves the list instead.
        const keyOptional = providersWithKeyOptionalListing.includes(providerLower);
        const authToken = req.headers.authorization;
        if (!authToken || !authToken.startsWith('Bearer ')) {
          if (!keyOptional) {
            return res.status(401).json({
              success: false,
              error: `Authentication required to fetch ${provider} models`,
            });
          }
        } else {
          let userId = null;
          try {
            const token = authToken.split(' ')[1];
            const payload = jwt.decode(token);
            userId = payload?.id || payload?.userId || payload?.user_id || payload?.sub;
          } catch (e) {
            if (!keyOptional) {
              return res.status(401).json({
                success: false,
                error: 'Invalid authentication token',
              });
            }
          }

          if (!userId && !keyOptional) {
            return res.status(401).json({
              success: false,
              error: 'Could not extract user ID from token',
            });
          }

          // Get API key for the user
          if (userId) {
            apiKey = await AuthManager.getValidAccessToken(userId, providerLower);
          }
          if (!apiKey && !keyOptional) {
            return res.status(400).json({
              success: false,
              error: `${provider} API key not found. Please configure your ${provider} API key in settings.`,
            });
          }
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
    } else if (providerLower === 'antigravity') {
      const agStatus = await AntigravityAuthManager.checkApiUsable({ forceRefresh: true });
      if (!agStatus.available) {
        return res.status(400).json({
          success: false,
          error: 'Antigravity is not connected. Use Google OAuth to connect.',
        });
      }
      apiKey = await AntigravityAuthManager.getAccessToken();
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
      // keyOptional providers tolerate missing auth/key on refresh too — the
      // forced fetch fails fast upstream and the fallback ladder answers.
      const keyOptional = providersWithKeyOptionalListing.includes(providerLower);
      if (!authToken || !authToken.startsWith('Bearer ')) {
        if (!keyOptional) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
        }
      } else {
        let userId = null;
        try {
          const token = authToken.split(' ')[1];
          const payload = jwt.decode(token);
          userId = payload?.id || payload?.userId || payload?.user_id || payload?.sub;
        } catch (e) {
          if (!keyOptional) {
            return res.status(401).json({
              success: false,
              error: 'Invalid authentication token',
            });
          }
        }

        // Get API key for the user
        if (userId) {
          apiKey = await AuthManager.getValidAccessToken(userId, providerLower);
        }
        if (!apiKey && !keyOptional) {
          return res.status(400).json({
            success: false,
            error: `${provider} API key not found`,
          });
        }
      }
    }

    // Clear cache and fetch fresh models. Pass force:true so the Codex path
    // (which has its own module-level cache separate from GenericProviderService.modelsCache)
    // bypasses SWR half-life logic and hits upstream unconditionally.
    if (typeof service.clearCache === 'function') service.clearCache();
    const models = await service.getModelNames(apiKey, { useCache: false, force: true });

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

// ───────────────────────── SCHEMA VERSION ────────────────────────
// Hash of the provider config surface the frontend depends on. Frontend
// compares this against its stored version on boot; a mismatch auto-invalidates
// all localStorage model caches. Kills the need for the manual
// MODEL_CACHE_VERSION bump in aiProvider.js — any change to metadata shape or
// recommended-model order auto-invalidates client caches on next fetch.
let _cachedSchemaHash = null;
function computeSchemaHash() {
  if (_cachedSchemaHash) return _cachedSchemaHash;
  const configs = getAllProviderConfigs().map((c) => ({
    key: c.key,
    name: c.name,
    recommended: c.recommendedModels || [],
    fallback: c.fallbackModels || [],
    metadataKeys: Object.keys(c.modelMetadata || {}).sort(),
    metadataShapes: Object.entries(c.modelMetadata || {}).map(([id, meta]) => [id, Object.keys(meta).sort().join(',')]),
  }));
  _cachedSchemaHash = crypto.createHash('sha1').update(JSON.stringify(configs)).digest('hex').slice(0, 16);
  return _cachedSchemaHash;
}

router.get('/schema-version', (req, res) => {
  res.json({ success: true, version: computeSchemaHash() });
});

// ───────────────────────── CODEX BOOT PREWARM ────────────────────────
// Called from server.js after warmupClientVersions() so the first user who
// opens the Codex model dropdown gets a fresh list instantly instead of
// waiting for the initial network roundtrip. Best-effort — silent if the
// user isn't signed in or the network is unavailable.
export async function prewarmCodexModels() {
  try {
    const token = CodexAuthManager.getOAuthToken?.();
    if (!token) {
      console.log('[ModelRoutes] Skipping Codex prewarm — not connected');
      return;
    }
    console.log('[ModelRoutes] Prewarming Codex model list on boot...');
    await fetchCodexModels(token, { force: true });
  } catch (err) {
    console.warn(`[ModelRoutes] Codex prewarm failed (non-fatal): ${err.message}`);
  }
}

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
  const metadata = getAllModelMetadataForClient(provider.toLowerCase());
  res.json({ success: true, provider: provider.toLowerCase(), metadata });
});

// Get metadata for a specific model
router.get('/:provider/metadata/:modelId', (req, res) => {
  const { provider, modelId } = req.params;
  const metadata = getModelMetadataForClient(provider.toLowerCase(), modelId);
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
