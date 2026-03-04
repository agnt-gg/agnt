import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import { GoogleGenAI } from '@google/genai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import AuthManager from '../auth/AuthManager.js';
import CodexAuthManager from '../auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../auth/ClaudeCodeAuthManager.js';
import CustomOpenAIProviderService from './CustomOpenAIProviderService.js';
import { getProviderConfig } from './providerConfigs.js';

/**
 * Creates and initializes an LLM client for a given provider.
 * Uses declarative config from providerConfigs.js instead of a per-provider switch statement.
 *
 * @param {string} provider The name of the AI provider (e.g., 'openai', 'anthropic').
 * @param {string} userId The ID of the user to fetch the API key for.
 * @param {Object} [options] Additional options.
 * @returns {Promise<OpenAI|Anthropic>} An initialized SDK client instance.
 * @throws {Error} If the provider is unsupported or the access token is missing.
 */
export async function createLlmClient(provider, userId, options = {}) {
  const { conversationId = null, cwd = process.cwd(), codexFullAuto = true, authToken = null } = options;

  // 1. Check if this is a custom DB-backed provider (unchanged)
  const isCustom = await CustomOpenAIProviderService.isCustomProvider(provider);
  if (isCustom) {
    return _createCustomProviderClient(provider, userId);
  }

  // Resolve provider key (handles display names like "Z-AI" → "zai")
  const config = getProviderConfig(provider);
  const lowerCaseProvider = config ? config.key : provider.toLowerCase();

  // 2. Check for special auth providers that don't use the standard AuthManager flow
  const specialClient = await _createSpecialAuthClient(lowerCaseProvider, options);
  if (specialClient) return specialClient;

  // 3. Config-driven client construction
  if (!config) {
    throw new Error(`Unsupported provider for LLM client factory: ${provider}`);
  }

  const accessToken = await AuthManager.getValidAccessToken(userId, lowerCaseProvider);
  if (!accessToken) {
    throw new Error(`Missing access token for provider: ${provider}`);
  }

  return _createClientFromConfig(config, accessToken);
}

/**
 * Creates an SDK client from a declarative provider config.
 * Handles the 4 SDK types: openai, anthropic, gemini, cerebras.
 */
function _createClientFromConfig(config, accessToken) {
  const sdkOpts = config.sdkOptions || {};

  switch (config.sdkType) {
    case 'anthropic':
      return new Anthropic({ apiKey: accessToken, ...sdkOpts });

    case 'gemini':
      return new GoogleGenAI({ apiKey: accessToken, ...sdkOpts });

    case 'cerebras':
      return new Cerebras({ apiKey: accessToken, ...sdkOpts });

    case 'openai':
    default: {
      const clientOpts = {
        apiKey: accessToken,
        ...sdkOpts,
      };
      // Only set baseURL if it's not the default OpenAI URL
      if (config.baseURL && config.baseURL !== 'https://api.openai.com/v1') {
        clientOpts.baseURL = config.baseURL;
      }
      return new OpenAI(clientOpts);
    }
  }
}

/**
 * Handles special-auth providers: local, openai-codex, openai-codex-cli, claude-code.
 * Returns null if the provider is not a special-auth provider.
 */
async function _createSpecialAuthClient(lowerCaseProvider, options) {
  // Local provider — no API key needed
  if (lowerCaseProvider === 'local') {
    return new OpenAI({
      apiKey: 'dummy-key',
      baseURL: 'http://127.0.0.1:1234/v1',
      dangerouslyAllowBrowser: false,
      maxRetries: 0,
      timeout: 60000,
    });
  }

  // OpenAI Codex — uses local Codex CLI auth
  if (lowerCaseProvider === 'openai-codex') {
    const codexStatus = await CodexAuthManager.checkApiUsable();
    if (!codexStatus.available) {
      throw new Error('OpenAI Codex is not connected. Use device login to connect.');
    }
    if (!codexStatus.apiUsable) {
      const detail = codexStatus.apiStatus ? ` (API status: ${codexStatus.apiStatus})` : '';
      throw new Error(`OpenAI Codex is connected but the OpenAI API is not usable${detail}.`);
    }
    const codexToken = CodexAuthManager.getAccessToken();
    if (!codexToken) {
      throw new Error('OpenAI Codex token not found after login.');
    }
    return new OpenAI({
      apiKey: codexToken,
      baseURL: 'https://api.openai.com/v1',
    });
  }

  // Claude Code — uses Anthropic API with OAuth Bearer auth
  if (lowerCaseProvider === 'claude-code') {
    const oauthToken = await ClaudeCodeAuthManager.getAccessToken();
    if (!oauthToken) {
      throw new Error('Claude Code is not connected. Use setup-token or paste a token to connect.');
    }
    const config = getProviderConfig('claude-code');
    return new Anthropic({
      apiKey: null,
      authToken: oauthToken,
      ...(config?.sdkOptions || {}),
    });
  }

  // OpenAI Codex CLI — uses Codex OAuth token with ChatGPT backend
  if (lowerCaseProvider === 'openai-codex-cli') {
    const oauthToken = CodexAuthManager.getOAuthToken();
    if (!oauthToken) {
      throw new Error(
        'OpenAI Codex CLI requires OAuth authentication for the Responses API. ' +
          'Use device login to connect. (API keys are not supported — use the openai-codex provider instead.)'
      );
    }
    const accountId = CodexAuthManager.getChatGptAccountId();
    const headers = {
      'OpenAI-Beta': 'responses=experimental',
    };
    if (accountId) {
      headers['chatgpt-account-id'] = accountId;
    }
    return new OpenAI({
      apiKey: oauthToken,
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultHeaders: headers,
    });
  }

  return null;
}

/**
 * Handles custom DB-backed providers (unchanged from original).
 */
async function _createCustomProviderClient(provider, userId) {
  console.log(`[LlmService] Looking up custom provider: ${provider} for user: ${userId}`);

  if (!userId) {
    throw new Error(`Custom provider "${provider}" requires authentication. userId is missing.`);
  }

  const customProvider = await CustomOpenAIProviderService.getProviderCredentials(provider, userId);

  if (!customProvider) {
    const providerExists = await CustomOpenAIProviderService.isCustomProvider(provider);
    console.error(`[LlmService] Custom provider lookup failed:`, {
      providerId: provider,
      userId: userId,
      providerExists: providerExists,
    });

    throw new Error(
      `Custom provider not found or not accessible. ` +
        `This could mean: (1) The provider belongs to a different user, ` +
        `(2) The provider was deleted, or (3) You're not authenticated. ` +
        `Provider ID: ${provider}`
    );
  }

  console.log(`[LlmService] Custom provider found: ${customProvider.provider_name} -> ${customProvider.base_url}`);

  const baseUrl = customProvider.base_url;
  const defaultHeaders = {};
  const compat = {};

  if (typeof baseUrl === 'string' && baseUrl.includes('api.kimi.com/coding')) {
    defaultHeaders['User-Agent'] = 'KimiCLI/0.77';
    compat.mapDeveloperRole = true;
  }

  const client = new OpenAI({
    apiKey: customProvider.api_key || 'not-needed',
    baseURL: baseUrl,
    defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
  });

  if (Object.keys(compat).length > 0) {
    client.__agntCompat = compat;
  }

  return client;
}
