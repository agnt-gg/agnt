import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import { GoogleGenAI } from '@google/genai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import AuthManager from '../auth/AuthManager.js';
import CodexAuthManager from '../auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../auth/ClaudeCodeAuthManager.js';
import CustomOpenAIProviderService from './CustomOpenAIProviderService.js';
import { createCodexCliClient } from './CodexCliClient.js';
import CodexCliSessionManager from './CodexCliSessionManager.js';

const baseURLs = {
  cerebras: 'https://api.cerebras.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/',
  grokai: 'https://api.x.ai/v1/',
  groq: 'https://api.groq.com/openai/v1',
  local: 'http://127.0.0.1:1234/v1',
  openai: 'https://api.openai.com/v1',
  'openai-codex': 'https://api.openai.com/v1',
  'openai-codex-cli': 'codex-cli://local',
  openrouter: 'https://openrouter.ai/api/v1',
  togetherai: 'https://api.together.xyz/v1',
};

/**
 * Creates and initializes an LLM client for a given provider.
 * @param {string} provider The name of the AI provider (e.g., 'openai', 'anthropic').
 * @param {string} userId The ID of the user to fetch the API key for.
 * @returns {Promise<OpenAI|Anthropic>} An initialized SDK client instance.
 * @throws {Error} If the provider is unsupported or the access token is missing.
 */
export async function createLlmClient(provider, userId, options = {}) {
  const lowerCaseProvider = provider.toLowerCase();
  const { conversationId = null, cwd = process.cwd(), codexFullAuto = true, authToken = null } = options;

  // Check if this is a custom provider by querying the database
  const isCustom = await CustomOpenAIProviderService.isCustomProvider(provider);
  if (isCustom) {
    console.log(`[LlmService] Looking up custom provider: ${provider} for user: ${userId}`);

    if (!userId) {
      throw new Error(`Custom provider "${provider}" requires authentication. userId is missing.`);
    }

    const customProvider = await CustomOpenAIProviderService.getProviderCredentials(provider, userId);

    if (!customProvider) {
      // Get more details about why it failed
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
      apiKey: customProvider.api_key || 'not-needed', // Use dummy key if no API key
      baseURL: baseUrl,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    });

    if (Object.keys(compat).length > 0) {
      client.__agntCompat = compat;
    }

    return client;
  }

  // For 'local' provider, no API key is needed.
  if (lowerCaseProvider === 'local') {
    return new OpenAI({
      apiKey: 'dummy-key', // The key can be anything for local models
      baseURL: baseURLs.local,
      dangerouslyAllowBrowser: false,
      maxRetries: 0, // Disable retries for local server
      timeout: 60000, // 60 second timeout for local models
    });
  }

  // OpenAI Codex provider uses Codex CLI auth locally instead of the remote auth service.
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
      baseURL: baseURLs['openai-codex'],
    });
  }

  // Claude Code provider: uses Anthropic API with OAuth Bearer auth (not x-api-key).
  // Requires specific beta flags and user-agent to enable OAuth on the API.
  if (lowerCaseProvider === 'claude-code') {
    const oauthToken = ClaudeCodeAuthManager.getAccessToken();
    if (!oauthToken) {
      throw new Error('Claude Code is not connected. Use setup-token or paste a token to connect.');
    }
    return new Anthropic({
      apiKey: null,
      authToken: oauthToken,
      defaultHeaders: {
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31',
        'user-agent': 'claude-cli/2.1.2 (external, cli)',
        'x-app': 'cli',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
  }

  // Codex CLI-backed provider: no OpenAI Platform API call, runs `codex exec` locally.
  if (lowerCaseProvider === 'openai-codex-cli') {
    const codexToken = CodexAuthManager.getAccessToken();
    if (!codexToken) {
      throw new Error('OpenAI Codex CLI is not connected. Use device login to connect.');
    }

    const sessionKey = CodexCliSessionManager.getSessionKey({
      userId,
      conversationId,
      provider: lowerCaseProvider,
      scope: conversationId ? 'conversation' : 'user',
    });

    return createCodexCliClient({
      defaultModel: 'gpt-5-codex',
      cwd,
      sessionKey,
      userId,
      conversationId,
      provider: lowerCaseProvider,
      fullAuto: codexFullAuto,
      authToken,
    });
  }

  const accessToken = await AuthManager.getValidAccessToken(userId, lowerCaseProvider);
  if (!accessToken) {
    throw new Error(`Missing access token for provider: ${provider}`);
  }

  switch (lowerCaseProvider) {
    case 'anthropic':
      return new Anthropic({ apiKey: accessToken });

    case 'openai':
      return new OpenAI({ apiKey: accessToken });

    case 'deepseek':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.deepseek,
      });

    case 'gemini':
      return new GoogleGenAI({
        apiKey: accessToken,
      });

    case 'grokai':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.grokai,
      });

    case 'groq':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.groq,
      });

    case 'openrouter':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.openrouter,
        defaultHeaders: {
          'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3333',
          'X-Title': process.env.SITE_NAME || 'TaskTitan',
        },
      });

    case 'togetherai':
      return new OpenAI({
        apiKey: accessToken,
        baseURL: baseURLs.togetherai,
      });

    case 'cerebras':
      return new Cerebras({
        apiKey: accessToken,
        warmTCPConnection: false, // Disable TCP warming to avoid extra requests on construction
      });

    default:
      throw new Error(`Unsupported provider for LLM client factory: ${provider}`);
  }
}
