import ClaudeCodeAuthManager from './ClaudeCodeAuthManager.js';
import GeminiCliAuthManager from './GeminiCliAuthManager.js';
import AntigravityAuthManager from './AntigravityAuthManager.js';
import CodexAuthManager from './CodexAuthManager.js';

/**
 * Resolving a subscription provider's access token, in one place.
 *
 * Four providers authenticate through a local OAuth flow rather than a stored
 * API key: claude-code, gemini-cli, antigravity and openai-codex. Every caller
 * that needs one of their tokens was doing the same four things by hand —
 * check the manager is connected, return a 400 with provider-specific wording
 * if not, then fetch the token — and ModelRoutes carried that ladder TWICE, in
 * the list route and the refresh route.
 *
 * Two copies of an auth decision is the shape of a real security defect: the
 * refresh path could gain a check the list path never got, and nothing would
 * point it out. A table cannot disagree with itself.
 *
 * Codex is deliberately special-cased below rather than smoothed over, because
 * its difference is load-bearing and easy to reintroduce as a bug.
 */
const OAUTH_PROVIDERS = {
  'claude-code': {
    manager: ClaudeCodeAuthManager,
    notConnected: 'Claude Code is not connected. Use setup-token or paste a token to connect.',
  },
  'gemini-cli': {
    manager: GeminiCliAuthManager,
    notConnected: 'Gemini CLI is not connected. Use Google OAuth or paste an API key to connect.',
  },
  antigravity: {
    manager: AntigravityAuthManager,
    notConnected: 'Antigravity is not connected. Use Google OAuth to connect.',
  },
  'openai-codex': {
    manager: CodexAuthManager,
    notConnected: 'OpenAI Codex is not connected. Start device login from the provider setup.',
    /**
     * Codex needs the OAuth token SPECIFICALLY, not getAccessToken().
     *
     * Its requests go to chatgpt.com, which rejects `sk-` platform keys with a
     * 401 — and getAccessToken() returns one whenever OPENAI_API_KEY is set.
     * On any machine with a platform key that silently degraded every Codex
     * model list to the hardcoded fallback, with no error to explain it.
     */
    getToken: (m) => m.getOAuthToken(),
    /** Connected is not sufficient: the Codex service itself can be unusable. */
    extraCheck: (status) => (status.apiUsable === false
      ? `ChatGPT is connected but its Codex service is not usable${status.apiStatus ? ` (status: ${status.apiStatus})` : ''}.`
      : null),
  },
};

export function isOAuthProvider(providerKey) {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, String(providerKey || '').toLowerCase());
}

export function oauthProviderKeys() {
  return Object.keys(OAUTH_PROVIDERS);
}

/**
 * Resolve an OAuth provider's access token.
 *
 * @param {string} providerKey
 * @param {{forceRefresh?: boolean}} [options]
 * @returns {Promise<{ok: true, apiKey: string} | {ok: false, error: string}>}
 *   Never throws for a "not connected" provider: that is an expected state a
 *   caller must turn into a 400, not an exception.
 */
export async function resolveOAuthApiKey(providerKey, options = {}) {
  const entry = OAUTH_PROVIDERS[String(providerKey || '').toLowerCase()];
  if (!entry) return { ok: false, error: `Not an OAuth provider: ${providerKey}` };

  const status = await entry.manager.checkApiUsable(
    options.forceRefresh ? { forceRefresh: true } : undefined,
  );
  if (!status?.available) return { ok: false, error: entry.notConnected };

  const extra = entry.extraCheck?.(status);
  if (extra) return { ok: false, error: extra };

  const apiKey = entry.getToken
    ? await entry.getToken(entry.manager)
    : await entry.manager.getAccessToken();

  if (!apiKey) return { ok: false, error: entry.notConnected };
  return { ok: true, apiKey };
}

export default { isOAuthProvider, oauthProviderKeys, resolveOAuthApiKey };
