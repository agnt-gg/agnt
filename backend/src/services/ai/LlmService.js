import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import { GoogleGenAI } from '@google/genai';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import AuthManager from '../auth/AuthManager.js';
import CodexAuthManager from '../auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../auth/ClaudeCodeAuthManager.js';
import GeminiCliAuthManager from '../auth/GeminiCliAuthManager.js';
import AntigravityAuthManager from '../auth/AntigravityAuthManager.js';
import CustomOpenAIProviderService from './CustomOpenAIProviderService.js';
import { getProviderConfig } from './providerConfigs.js';
import { createCchFetch } from './claudeBillingHeader.js';
import { getClientIdentity, getClientVersion } from './clientVersions.js';
import ChutesE2EEFetchTransport from './chutes/ChutesE2EEFetchTransport.js';

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

// ── Antigravity OAuth Proxy ─────────────────────────────────────────
// Same cloudcode-pa gateway as GeminiOAuthProxy, but adds the Antigravity
// client identity: `antigravity` User-Agent + X-Goog-Api-Client headers, and
// the top-level `requestType: 'agent'` / `userAgent: 'antigravity'` fields the
// gateway keys off to route to the Antigravity quota pool and multi-vendor
// model set (Gemini 3.x + Claude 4.6 + GPT-OSS). See PRD-107.// generateContent / streamGenerateContent carry the full Antigravity browser UA.
// The version is resolved LIVE from the GitHub releases API via clientVersions.js
// (same pattern as Claude Code / Codex). Auth-path calls (loadCodeAssist/onboardUser
// in AntigravityAuthManager) deliberately use the google-api-nodejs-client UA,
// which has no version to gate.
const ANTIGRAVITY_META_PLATFORM = process.platform === 'win32' ? 'WINDOWS' : 'MACOS';
const ANTIGRAVITY_STATIC_META = JSON.stringify({ ideType: 'ANTIGRAVITY', platform: ANTIGRAVITY_META_PLATFORM, pluginType: 'GEMINI' });
async function getAntigravityClientHeaders() {
  const ver = await getClientVersion('antigravity');
  return {
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ver} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': ANTIGRAVITY_STATIC_META,
  };
}class AntigravityOAuthProxy extends GeminiOAuthProxy {
  _buildRequest(params) {
    const base = super._buildRequest(params);
    // Antigravity gateway expects two extra top-level fields alongside
    // { model, project, request }.
    return { ...base, requestType: 'agent', userAgent: 'antigravity' };
  }

  // Turn Google's structured error into ONE human sentence so the raw JSON
  // envelope never gets serialized into chat. Returns null for unrecognized
  // shapes (caller then rethrows the original error).
  _formatAntigravityError(e) {
    const status = e.response?.status;
    const gerr = e.response?.data?.error || e.response?.data?.[0]?.error;
    const reason = gerr?.status || gerr?.details?.find?.((d) => d.reason)?.reason;
    const model = gerr?.details?.find?.((d) => d.metadata?.model)?.metadata?.model;

    if (status === 429 || reason === 'QUOTA_EXHAUSTED' || reason === 'RESOURCE_EXHAUSTED') {
      const delay = gerr?.details?.find?.((d) => d.metadata?.quotaResetDelay)?.metadata?.quotaResetDelay
        || gerr?.details?.find?.((d) => d.retryDelay)?.retryDelay;
      let when = '';
      if (delay) {
        // Google sends two formats: compound ("150h8m40.6s") on quotaResetDelay,
        // or plain seconds ("540520.6s") on retryDelay. Parse both to total secs.
        const str = String(delay);
        let secs = 0;
        const compound = str.match(/(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/);
        if (compound && (compound[1] || compound[2] || compound[3]) && /[hm]/.test(str)) {
          secs = (parseInt(compound[1] || 0, 10) * 3600) + (parseInt(compound[2] || 0, 10) * 60) + Math.floor(parseFloat(compound[3] || 0));
        } else {
          secs = Math.round(parseFloat(str.replace(/s$/, '')));
        }
        if (Number.isFinite(secs) && secs > 0) {
          const h = Math.floor(secs / 3600);
          const m = Math.floor((secs % 3600) / 60);
          const d = Math.floor(h / 24);
          when = d > 0 ? ` Resets in ${d}d ${h % 24}h.` : h > 0 ? ` Resets in ${h}h ${m}m.` : ` Resets in ${m}m.`;
        }
      }
      const which = model ? ` for ${model}` : '';
      return `Antigravity quota reached${which}.${when} Try another model or your API-key provider meanwhile.`;
    }
    if (status === 403 || reason === 'PERMISSION_DENIED') {
      return 'Antigravity access was denied. Your Google account may not have access, or usage was restricted.';
    }
    if (status === 401) {
      return 'Antigravity authentication expired. Please reconnect your Google account.';
    }
    if (status === 400) {
      return `Antigravity rejected the request (400). This model may not be available on your plan.`;
    }
    if (gerr?.message) return `Antigravity: ${gerr.message}`;
    return null;
  }

  async _generateContent(params) {
    const url = `${GEMINI_OAUTH_BASE}:generateContent`;
    const body = this._buildRequest(params);
    const headers = await getAntigravityClientHeaders();
    try {
      const res = await this._auth.request({
        url, method: 'POST', data: body, headers,
      });
      return this._extractResponse(res.data);
    } catch (e) {
      const s = e.response?.status; // PRD-109: trip cooldown, never retry-storm
      if (s === 403 || s === 429) AntigravityAuthManager.tripCooldown(`generateContent HTTP ${s}`);
      const clean = this._formatAntigravityError(e);
      if (clean) throw new Error(clean);
      throw e;
    }
  }

  async _generateContentStream(params) {
    const url = `${GEMINI_OAUTH_BASE}:streamGenerateContent?alt=sse`;
    const body = this._buildRequest(params);
    const headers = await getAntigravityClientHeaders();
    try {
      const res = await this._auth.request({
        url, method: 'POST', data: body, responseType: 'stream', headers,
      });
      return this._parseSSEStream(res.data);
    } catch (e) {
      const s = e.response?.status; // PRD-109: trip cooldown, never retry-storm
      if (s === 403 || s === 429) AntigravityAuthManager.tripCooldown(`streamGenerateContent HTTP ${s}`);
      const clean = this._formatAntigravityError(e);
      if (clean) throw new Error(clean);
      throw e;
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
 * Overrides the User-Agent in a provider's sdkOptions.defaultHeaders with a
 * dynamically-resolved version from clientVersions.js. Falls through to the
 * config's hardcoded value if the resolver can't produce one. Only providers
 * that spoof an upstream CLI (currently claude-code and kimi-code) need this.
 */
async function _resolveDynamicSdkOptions(providerKey, baseSdkOptions) {
  const base = baseSdkOptions || {};
  // Map provider key → the header name that needs its UA rewritten.
  // Claude Code uses lowercase `user-agent` to exactly mimic the real CLI;
  // Kimi Code uses `User-Agent`. Keep these casings in sync with providerConfigs.
  const headerByProvider = {
    'claude-code': 'user-agent',
    'kimi-code': 'User-Agent',
  };
  const headerName = headerByProvider[providerKey];
  if (!headerName) return base;
  try {
    const identity = await getClientIdentity(providerKey);
    return {
      ...base,
      defaultHeaders: {
        ...(base.defaultHeaders || {}),
        [headerName]: identity,
      },
    };
  } catch (err) {
    console.warn(`[LlmService] dynamic UA resolution failed for ${providerKey}: ${err.message}`);
    return base;
  }
}

/**
 * Creates an SDK client from a declarative provider config.
 * Handles the 4 SDK types: openai, anthropic, gemini, cerebras.
 */
async function _createClientFromConfig(config, accessToken) {
  const sdkOpts = await _resolveDynamicSdkOptions(config.key, config.sdkOptions);
  let client;

  switch (config.sdkType) {
    case 'anthropic':
      client = new Anthropic({ apiKey: accessToken, ...sdkOpts });
      break;

    case 'gemini':
      client = new GoogleGenAI({ apiKey: accessToken, ...sdkOpts });
      break;

    case 'cerebras':
      client = new Cerebras({ apiKey: accessToken, ...sdkOpts });
      break;

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
      // Chutes requires a custom fetch transport that encrypts/decrypts E2EE payloads.
      if (config.key === 'chutes' && config.e2ee === true) {
        const transport = new ChutesE2EEFetchTransport({ apiKey: accessToken });
        clientOpts.fetch = transport.fetch();
      }
      client = new OpenAI(clientOpts);
    }
  }

  // Propagate declarative compat flags (e.g. mapDeveloperRole) to the adapter,
  // matching the convention used by _createCustomProviderClient.
  if (config.compat && Object.keys(config.compat).length > 0) {
    client.__agntCompat = { ...config.compat };
  }

  return client;
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

  // Claude Code — uses Anthropic API with OAuth Bearer auth.
  // The custom fetch does two things on every outgoing request:
  //   1. Replace the cch=00000 placeholder with the real xxHash64 hash.
  //   2. Re-read the current OAuth token from ClaudeCodeAuthManager and
  //      overwrite the Authorization header. The SDK bakes `authToken` into
  //      the client at construction, so without this a mid-session refresh
  //      would leave a long tool loop sending the old Bearer token and 401.
  if (lowerCaseProvider === 'claude-code') {
    const initialToken = await ClaudeCodeAuthManager.getAccessToken();
    if (!initialToken) {
      throw new Error('Claude Code is not connected. Use setup-token or paste a token to connect.');
    }
    const config = getProviderConfig('claude-code');
    const sdkOptions = await _resolveDynamicSdkOptions('claude-code', config?.sdkOptions);
    const cchFetch = createCchFetch();
    const claudeCodeFetch = async (url, init) => {
      const token = await ClaudeCodeAuthManager.getAccessToken();
      if (token) {
        const headers = new Headers(init?.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        init = { ...init, headers };
      }
      return cchFetch(url, init);
    };
    return new Anthropic({
      apiKey: null,
      authToken: initialToken,
      ...sdkOptions,
      fetch: claudeCodeFetch,
    });
  }

  // OpenAI Codex — uses Codex OAuth token with ChatGPT backend
  if (lowerCaseProvider === 'openai-codex') {
    // Auto-refresh expired tokens before creating the client
    const oauthToken = await CodexAuthManager.ensureValidToken();
    if (!oauthToken || oauthToken.startsWith('sk-')) {
      // ensureValidToken returns API keys too — but Codex Responses API needs OAuth
      const rawOAuth = CodexAuthManager.getOAuthToken();
      if (!rawOAuth) {
        throw new Error(
          'OpenAI Codex requires OAuth authentication. Use device login to connect.'
        );
      }
    }
    const effectiveToken = CodexAuthManager.getOAuthToken() || oauthToken;
    const accountId = CodexAuthManager.getChatGptAccountId();
    const codexVersion = await getClientVersion('openai-codex');
    const headers = {
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'codex_cli_rs',
    };
    if (accountId) {
      headers['chatgpt-account-id'] = accountId;
    }
    // Append ?client_version=X to every outgoing request so the ChatGPT backend
    // returns the newer-model list on chat calls too, not just /models.
    const codexFetch = (url, init) => {
      const u = new URL(url);
      if (!u.searchParams.has('client_version')) {
        u.searchParams.set('client_version', codexVersion);
      }
      return fetch(u.toString(), init);
    };
    return new OpenAI({
      apiKey: effectiveToken,
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultHeaders: headers,
      fetch: codexFetch,
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

  // Antigravity — Google's unified gateway (OAuth only, multi-vendor models).
  // Same cloudcode-pa endpoint as gemini-cli OAuth, but Antigravity client
  // identity + extra scopes unlock Gemini 3.x + Claude 4.6 + GPT-OSS.
  if (lowerCaseProvider === 'antigravity') {
    if (AntigravityAuthManager.isCoolingDown()) {
      throw Object.assign(
        new Error('Antigravity is cooling down to protect your Google account. Use an API-key provider.'),
        { code: 'ANTIGRAVITY_COOLDOWN', retryAfterMs: AntigravityAuthManager.cooldownMsLeft() },
      );
    }
    const token = await AntigravityAuthManager.getAccessToken();
    if (!token) {
      throw new Error('Antigravity is not connected. Use Google OAuth to connect.');
    }
    const oauth2Client = AntigravityAuthManager.getOAuth2Client();
    if (!oauth2Client) {
      throw new Error('Antigravity OAuth credentials not found.');
    }
    const projectId = await AntigravityAuthManager.ensureOnboarded(oauth2Client);
    return new AntigravityOAuthProxy(oauth2Client, projectId);
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
    // Legacy fallback for users who added Kimi Code via "Add Custom Provider"
    // before the native provider existed. Native users go through providerConfigs.js.
    // UA resolved dynamically via clientVersions — falls back to hardcoded on failure.
    defaultHeaders['User-Agent'] = await getClientIdentity('kimi-code');
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
