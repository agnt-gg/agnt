import { assertLocalProviderAccess } from '../auth/localProviderAccess.js';
import { getConnection } from './connectionRuntime.js';
const messageConnection = getConnection('claude-code');
const responseConnection = getConnection('openai-codex');
const projectConnection = getConnection('gemini-cli');
const catalogConnection = getConnection('antigravity');
import { currentTeamExecution } from '../authorization/TeamExecutionContext.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai/index.mjs';
import AuthManager from '../auth/AuthManager.js';
import GrokBuildAuthManager from '../auth/GrokBuildAuthManager.js';
import { createGrokBuildCliClient } from './GrokBuildCliClient.js';
import GrokBuildCliService from './GrokBuildCliService.js';
import CursorCliAuthManager from '../auth/CursorCliAuthManager.js';
import { createCursorCliClient } from './CursorCliClient.js';
import CursorCliService from './CursorCliService.js';
import CustomOpenAIProviderService from './CustomOpenAIProviderService.js';
import { getProviderConfig } from './providerConfigs.js';
import { createConnectionFetch, createGatewayClient, buildRequestHeaders } from './connectionRuntime.js';
import { getClientIdentity, getClientVersion } from './clientVersions.js';
import ChutesE2EEFetchTransport from './chutes/ChutesE2EEFetchTransport.js';

// The Gemini and Cerebras SDKs are loaded when a client for them is first
// created, not at boot (see backend/boot.importBudget.test.js). import() caches,
// so every later client pays nothing.
const loadGoogleGenAI = async () => (await import('@google/genai')).GoogleGenAI;
const loadCerebras = async () => (await import('@cerebras/cerebras_cloud_sdk')).default;

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
  const teamExecution=currentTeamExecution();
  if(teamExecution){if(String(provider).toLowerCase()!==teamExecution.provider)throw new Error('Provider is not granted to this team run');return teamExecution.broker.sdk();}
  if(String(userId).startsWith('scope:'))throw new Error('Shared execution requires its approved principal');
  if(process.env.AGNT_TENANT_SLUG && userId!==process.env.AGNT_TENANT_OWNER)throw new Error('Hosted members must use approved team model connections');
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
  await assertLocalProviderAccess(userId, lowerCaseProvider);
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

    case 'gemini': {
      const GoogleGenAI = await loadGoogleGenAI();
      client = new GoogleGenAI({ apiKey: accessToken, ...sdkOpts });
      break;
    }

    case 'cerebras': {
      const Cerebras = await loadCerebras();
      client = new Cerebras({ apiKey: accessToken, ...sdkOpts });
      break;
    }

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
  // Local provider — no API key needed. Each request is routed to whichever
  // local server has its model (LM Studio, Ollama, AGNT's own llama-server…),
  // see services/localModels/localServers.js.
  if (lowerCaseProvider === 'local') {
    const { localClientOptions } = await import('../localModels/index.js');
    return new OpenAI({
      apiKey: 'dummy-key',
      ...localClientOptions(),
      dangerouslyAllowBrowser: false,
      maxRetries: 0,
      timeout: 60000,
    });
  }

  // Claude Code — uses Anthropic API with OAuth Bearer auth.
  // The custom fetch does two things on every outgoing request:
  //   1. Apply the request signature hash to the outgoing body.
  //   2. Re-read the current OAuth token from messageConnection and
  //      overwrite the Authorization header. The SDK bakes `authToken` into
  //      the client at construction, so without this a mid-session refresh
  //      would leave a long tool loop sending the old Bearer token and 401.
  if (lowerCaseProvider === 'claude-code') {
    const initialToken = await messageConnection.getAccessToken();
    if (!initialToken) {
      throw new Error('Claude Code is not connected. Use setup-token or paste a token to connect.');
    }
    const config = getProviderConfig('claude-code');
    const sdkOptions = await _resolveDynamicSdkOptions('claude-code', config?.sdkOptions);
    const connectionFetch = await createConnectionFetch('claude-code');
    return new Anthropic({
      apiKey: null,
      authToken: initialToken,
      ...sdkOptions,
      fetch: connectionFetch,
    });
  }

  // OpenAI Codex — uses Codex OAuth token with ChatGPT backend
  if (lowerCaseProvider === 'openai-codex') {
    // Auto-refresh expired tokens before creating the client
    const oauthToken = await responseConnection.ensureValidToken();
    if (!oauthToken || oauthToken.startsWith('sk-')) {
      // ensureValidToken returns API keys too — but Codex Responses API needs OAuth
      const rawOAuth = responseConnection.getOAuthToken();
      if (!rawOAuth) {
        throw new Error(
          'OpenAI Codex requires OAuth authentication. Use device login to connect.'
        );
      }
    }
    const effectiveToken = responseConnection.getOAuthToken() || oauthToken;
    const accountId = responseConnection.getChatGptAccountId();
    const headers = buildRequestHeaders('openai-codex', { accountId });
    const connectionFetch = await createConnectionFetch('openai-codex');
    return new OpenAI({
      apiKey: effectiveToken,
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultHeaders: headers,
      fetch: connectionFetch,
    });
  }

  // Grok Build — borrow the CLI's OAuth session, talk HTTP.
  //
  // The local `grok` CLI authenticates against cli-chat-proxy.grok.com, which
  // is a real OpenAI-compatible endpoint: /chat/completions accepts `tools`
  // and returns tool_calls, and it reports prompt_tokens_details.cached_tokens
  // (verified live 2026-07-27). Spawning the CLI instead would flatten the
  // conversation into one text prompt and drop every tool schema — the model
  // would narrate tool calls it cannot make. So this mirrors the
  // openai-codex / claude-code pattern: the CLI owns the credential, AGNT
  // owns the request. The CLI is still spawned for the `grok_exec` tool,
  // where an autonomous coding agent in a workdir is the point.
  if (lowerCaseProvider === 'grok-build') {
    const status = await GrokBuildAuthManager.checkApiUsable();
    if (!status.apiUsable) {
      throw new Error(
        'Grok Build CLI is not authenticated. Run: grok login --oauth (or connect via Settings).'
      );
    }

    // Escape hatch: force the subprocess transport (no tools) for debugging.
    if (process.env.AGNT_GROK_FORCE_CLI === '1') {
      return createGrokBuildCliClient({
        defaultModel: process.env.AGNT_GROK_DEFAULT_MODEL || GrokBuildCliService.getDefaultModel(),
        cwd: options.cwd || GrokBuildCliService.getDefaultWorkdir(),
        userId: options.userId,
        conversationId: options.conversationId,
        authToken: options.authToken,
        alwaysApprove: true,
      });
    }

    const grokToken = await GrokBuildAuthManager.ensureValidToken();
    if (!grokToken) {
      throw new Error('Grok Build token unavailable after refresh. Run: grok login --oauth');
    }
    // The proxy rejects requests without a client version (426 Upgrade
    // Required), so send the version of the CLI actually installed here.
    const grokCliVersion = await GrokBuildAuthManager.getCliVersion();
    const grokConfig = getProviderConfig('grok-build');
    return new OpenAI({
      apiKey: grokToken,
      baseURL: grokConfig?.baseURL || 'https://cli-chat-proxy.grok.com/v1',
      defaultHeaders: {
        'x-grok-client-version': grokCliVersion,
        'x-grok-client-identifier': 'xai-grok-cli',
        'x-grok-client-surface': 'grok-build',
      },
    });
  }

  // Cursor Agent CLI — always spawn local `cursor-agent` binary (subscription login)
  if (lowerCaseProvider === 'cursor-cli') {
    const status = await CursorCliAuthManager.checkApiUsable();
    if (!status.apiUsable) {
      throw new Error('Cursor CLI is not authenticated. Run: cursor-agent login (or connect via Settings).');
    }
    return createCursorCliClient({
      defaultModel: process.env.AGNT_CURSOR_DEFAULT_MODEL || CursorCliService.getDefaultModel(),
      cwd: options.cwd || CursorCliService.getDefaultWorkdir(),
      userId: options.userId,
      conversationId: options.conversationId,
    });
  }

  // Gemini CLI — uses Google OAuth or locally stored API key
  if (lowerCaseProvider === 'gemini-cli') {
    const token = await projectConnection.getAccessToken();
    if (!token) {
      throw new Error('Gemini CLI is not connected. Use Google OAuth or paste an API key to connect.');
    }
    const config = getProviderConfig('gemini');
    const sdkOpts = { ...(config?.sdkOptions || {}) };

    if (projectConnection.isUsingApiKey()) {
      // API key → passed as apiKey (sent as ?key= query param)
      const GoogleGenAI = await loadGoogleGenAI();
      return new GoogleGenAI({ apiKey: token, ...sdkOpts });
    }

    // OAuth → use GeminiOAuthProxy with the Code Assist endpoint,
    // matching the real Gemini CLI (cloud-platform scope).
    const oauth2Client = projectConnection.getOAuth2Client();
    if (!oauth2Client) {
      throw new Error('Gemini CLI OAuth credentials not found.');
    }
    // Ensure user is onboarded and get the Code Assist project ID
    const projectId = await projectConnection.ensureOnboarded(oauth2Client);
    return createGatewayClient('gemini-cli', oauth2Client, projectId);
  }

  // Antigravity — Google's unified gateway (OAuth only, multi-vendor models).
  // Same cloudcode-pa endpoint as gemini-cli OAuth, but Antigravity client
  // identity + extra scopes unlock Gemini 3.x + Claude 4.6 + GPT-OSS.
  if (lowerCaseProvider === 'antigravity') {
    if (catalogConnection.isCoolingDown()) {
      throw Object.assign(
        new Error('Antigravity is cooling down to protect your Google account. Use an API-key provider.'),
        { code: 'ANTIGRAVITY_COOLDOWN', retryAfterMs: catalogConnection.cooldownMsLeft() },
      );
    }
    const token = await catalogConnection.getAccessToken();
    if (!token) {
      throw new Error('Antigravity is not connected. Use Google OAuth to connect.');
    }
    const oauth2Client = catalogConnection.getOAuth2Client();
    if (!oauth2Client) {
      throw new Error('Antigravity OAuth credentials not found.');
    }
    const projectId = await catalogConnection.ensureOnboarded(oauth2Client);
    return createGatewayClient('antigravity', oauth2Client, projectId);
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
