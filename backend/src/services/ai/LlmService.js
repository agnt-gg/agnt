import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import { GoogleGenAI } from '@google/genai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import AuthManager from '../auth/AuthManager.js';
import CodexAuthManager from '../auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../auth/ClaudeCodeAuthManager.js';
import GeminiCliAuthManager from '../auth/GeminiCliAuthManager.js';
import CustomOpenAIProviderService from './CustomOpenAIProviderService.js';
import { getProviderConfig } from './providerConfigs.js';

// ── Gemini OAuth Proxy ──────────────────────────────────────────────
// Lightweight wrapper that mimics the GoogleGenAI SDK's client interface
// but uses google-auth-library OAuth2Client for authentication.
// The Gemini CLI's OAuth credentials (cloud-platform scope) only work
// with the Code Assist endpoint, not the consumer generativelanguage API.

const GEMINI_OAUTH_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';

class GeminiOAuthProxy {
  constructor(oauth2Client, projectId) {
    this._auth = oauth2Client;
    this._project = projectId;
    this.models = {
      generateContent: (params) => this._generateContent(params),
      generateContentStream: (params) => this._generateContentStream(params),
    };
  }

  _buildRequest(params) {
    // Code Assist endpoint wrapper format (matches Gemini CLI's converter.ts):
    // { model, project, user_prompt_id, request: { contents, systemInstruction, ... } }
    const inner = { contents: params.contents };
    if (params.config) {
      if (params.config.systemInstruction) inner.systemInstruction = params.config.systemInstruction;
      if (params.config.temperature != null) inner.generationConfig = { ...inner.generationConfig, temperature: params.config.temperature };
      if (params.config.maxOutputTokens != null) inner.generationConfig = { ...inner.generationConfig, maxOutputTokens: params.config.maxOutputTokens };
      if (params.config.topP != null) inner.generationConfig = { ...inner.generationConfig, topP: params.config.topP };
      if (params.config.topK != null) inner.generationConfig = { ...inner.generationConfig, topK: params.config.topK };
      if (params.config.thinkingConfig) inner.generationConfig = { ...inner.generationConfig, thinkingConfig: params.config.thinkingConfig };
      if (params.config.responseMimeType) inner.generationConfig = { ...inner.generationConfig, responseMimeType: params.config.responseMimeType };
      if (params.config.tools) inner.tools = params.config.tools;
      if (params.config.toolConfig) inner.toolConfig = params.config.toolConfig;
    }
    // Model name WITHOUT 'models/' prefix for Code Assist endpoint
    const model = params.model.replace(/^models\//, '');
    return { model, project: this._project, request: inner };
  }

  _extractResponse(data) {
    // Code Assist wraps response in a 'response' field
    const resp = data?.response || data;
    resp.text = resp.candidates?.[0]?.content?.parts
      ?.filter(p => p.text != null)
      .map(p => p.text)
      .join('') || '';
    resp.functionCalls = resp.candidates?.[0]?.content?.parts
      ?.filter(p => p.functionCall)
      .map(p => p.functionCall) || undefined;
    return resp;
  }

  async _generateContent(params) {
    const url = `${GEMINI_OAUTH_BASE}:generateContent`;
    const body = this._buildRequest(params);

    const res = await this._auth.request({ url, method: 'POST', data: body });
    return this._extractResponse(res.data);
  }

  async _generateContentStream(params) {
    const url = `${GEMINI_OAUTH_BASE}:streamGenerateContent?alt=sse`;
    const body = this._buildRequest(params);

    const res = await this._auth.request({
      url, method: 'POST', data: body, responseType: 'stream',
    });

    return this._parseSSEStream(res.data);
  }

  async *_parseSSEStream(stream) {
    // Matches the real Gemini CLI's SSE parsing (server.ts):
    // Buffer data: lines until a blank line, then parse the accumulated JSON.
    const decoder = new TextDecoder();
    let rawBuffer = '';
    let dataBuffer = '';

    for await (const rawChunk of stream) {
      rawBuffer += decoder.decode(rawChunk instanceof Buffer ? rawChunk : new Uint8Array(rawChunk), { stream: true });
      const lines = rawBuffer.split('\n');
      rawBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '');

        if (trimmed.startsWith('data: ')) {
          dataBuffer += trimmed.slice(6);
        } else if (trimmed === '' && dataBuffer) {
          // Blank line = end of SSE event, parse accumulated data
          const jsonStr = dataBuffer.trim();
          dataBuffer = '';
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            const resp = data?.response || data;
            resp.text = resp.candidates?.[0]?.content?.parts
              ?.filter(p => p.text != null)
              .map(p => p.text)
              .join('') || '';
            resp.functionCalls = resp.candidates?.[0]?.content?.parts
              ?.filter(p => p.functionCall)
              .map(p => p.functionCall) || undefined;
            if (resp.functionCalls?.length === 0) resp.functionCalls = undefined;
            yield resp;
          } catch (e) {
            console.warn('[GeminiOAuthProxy] SSE parse error, skipping chunk:', e.message);
          }
        }
      }
    }

    // Flush any remaining buffered data (stream ended without trailing blank line)
    if (dataBuffer.trim()) {
      try {
        const data = JSON.parse(dataBuffer.trim());
        const resp = data?.response || data;
        resp.text = resp.candidates?.[0]?.content?.parts
          ?.filter(p => p.text != null)
          .map(p => p.text)
          .join('') || '';
        resp.functionCalls = resp.candidates?.[0]?.content?.parts
          ?.filter(p => p.functionCall)
          .map(p => p.functionCall) || undefined;
        if (resp.functionCalls?.length === 0) resp.functionCalls = undefined;
        yield resp;
      } catch (e) {
        console.warn('[GeminiOAuthProxy] SSE flush parse error:', e.message);
      }
    }
  }
}

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
 * Handles special-auth providers: local, openai-codex, claude-code.
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

  // OpenAI Codex — uses Codex OAuth token with ChatGPT backend
  if (lowerCaseProvider === 'openai-codex') {
    const oauthToken = CodexAuthManager.getOAuthToken();
    if (!oauthToken) {
      throw new Error(
        'OpenAI Codex requires OAuth authentication. Use device login to connect.'
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

  // Gemini CLI — uses Google OAuth or locally stored API key
  if (lowerCaseProvider === 'gemini-cli') {
    const token = await GeminiCliAuthManager.getAccessToken();
    if (!token) {
      throw new Error('Gemini CLI is not connected. Use Google OAuth or paste an API key to connect.');
    }
    const config = getProviderConfig('gemini');
    const sdkOpts = { ...(config?.sdkOptions || {}) };

    if (GeminiCliAuthManager.isUsingApiKey()) {
      // API key → passed as apiKey (sent as ?key= query param)
      return new GoogleGenAI({ apiKey: token, ...sdkOpts });
    }

    // OAuth → use GeminiOAuthProxy with the Code Assist endpoint,
    // matching the real Gemini CLI (cloud-platform scope).
    const oauth2Client = GeminiCliAuthManager.getOAuth2Client();
    if (!oauth2Client) {
      throw new Error('Gemini CLI OAuth credentials not found.');
    }
    // Ensure user is onboarded and get the Code Assist project ID
    const projectId = await GeminiCliAuthManager.ensureOnboarded(oauth2Client);
    return new GeminiOAuthProxy(oauth2Client, projectId);
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
