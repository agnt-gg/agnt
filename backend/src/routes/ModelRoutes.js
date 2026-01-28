import express from 'express';
import openRouterService from '../services/ai/providers/OpenRouter.js';
import anthropicService from '../services/ai/providers/Anthropic.js';
import openAIService from '../services/ai/providers/OpenAI.js';
import openAICodexCliService from '../services/ai/providers/OpenAICodexCli.js';
import kimiCodeService from '../services/ai/providers/KimiCode.js';
import geminiService from '../services/ai/providers/Gemini.js';
import grokAIService from '../services/ai/providers/GrokAI.js';
import groqService from '../services/ai/providers/Groq.js';
import togetherAIService from '../services/ai/providers/TogetherAI.js';
import cerebrasService from '../services/ai/providers/Cerebras.js';
import deepSeekService from '../services/ai/providers/DeepSeek.js';
import AuthManager from '../services/auth/AuthManager.js';
import CodexAuthManager from '../services/auth/CodexAuthManager.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Map provider names to their services
const providerServices = {
  openrouter: openRouterService,
  anthropic: anthropicService,
  openai: openAIService,
  gemini: geminiService,
  grokai: grokAIService,
  grok: grokAIService, // Alias for grokai
  groq: groqService,
  'openai-codex': openAIService,
  'openai-codex-cli': openAICodexCliService,
  'kimi-code': kimiCodeService,
  togetherai: togetherAIService,
  cerebras: cerebrasService,
  deepseek: deepSeekService,
};

// Providers that have hardcoded models and don't require API key for model listing
const providersWithHardcodedModels = ['cerebras', 'deepseek', 'openai-codex-cli', 'kimi-code'];

// Generic endpoint for fetching models from any provider
router.get('/:provider/models', async (req, res) => {
  try {
    const { provider } = req.params;
    const providerLower = provider.toLowerCase();

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

    // Codex CLI provider does not use the OpenAI API, but still requires local Codex login.
    if (providerLower === 'openai-codex-cli') {
      const codexToken = CodexAuthManager.getAccessToken();
      if (!codexToken) {
        return res.status(400).json({
          success: false,
          error: 'OpenAI Codex CLI is not connected. Start device login from the provider setup.',
        });
      }
    }

    // Only require authentication and API key for providers that need it
    if (!hasHardcodedModels) {
      // OpenAI Codex: use local Codex CLI auth and allow unauthenticated access to this local route.
      if (providerLower === 'openai-codex') {
        const codexStatus = await CodexAuthManager.checkApiUsable();
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
        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: 'OpenAI Codex token not found after login.',
          });
        }
      } else {
        // Extract user ID from auth token
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
          userId = payload?.id || payload?.userId || payload?.sub;
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
    } else {
      models = await service.getModelNames(apiKey, options);
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
    const providerLower = provider.toLowerCase();

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

    if (providerLower === 'openai-codex') {
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
    } else if (providerLower === 'openai-codex-cli') {
      const codexToken = CodexAuthManager.getAccessToken();
      if (!codexToken) {
        return res.status(400).json({
          success: false,
          error: 'OpenAI Codex CLI is not connected. Start device login from the provider setup.',
        });
      }
      // No API key needed; models are static.
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
        userId = payload?.id || payload?.userId || payload?.sub;
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
    // For now, return predefined categories
    // In the future, this could be fetched from OpenRouter API
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

export default router;
