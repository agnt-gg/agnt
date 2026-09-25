/**
 * OAuth 2.0 authorization-code flow (RFC 6749 §4.1 + PKCE, RFC 7636) for
 * providers a plugin declares with `type: "oauth2"` (see pluginAuth.js).
 *
 * The browser is sent to the provider; the provider redirects back to this
 * backend's loopback callback; the callback redeems the code and stores the
 * tokens locally. The UI polls status by session id, like the CLI loopback
 * providers already do.
 *
 * Storage is injected (AuthManager passes itself) so this module never imports
 * AuthManager and no import cycle can form. Client credentials the user
 * supplies are stored as an encrypted api_keys row under `<id>:oauth-client`;
 * they are configuration for this provider, never sent to the UI again.
 */
import crypto from 'crypto';

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 50;
const REFRESH_SKEW_MS = 60 * 1000;
const sessions = new Map(); // state -> session

// A row in api_keys that is configuration, not a connection: listers skip it.
export const CLIENT_ROW_SUFFIX = ':oauth-client';
export const clientRowId = (providerId) => `${providerId}${CLIENT_ROW_SUFFIX}`;

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pruneSessions(now = Date.now()) {
  for (const [state, session] of sessions) if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(state);
  // Bounded even under a flood of abandoned starts: drop the oldest.
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}

async function readClient(provider, userId, store) {
  if (provider.oauth.clientId) return { clientId: provider.oauth.clientId };
  const raw = await store._getApiKey(userId, clientRowId(provider.id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.clientId ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Begin a sign-in. `client` is only needed when the manifest has no public
 * clientId; it is stored before the redirect so the callback can use it.
 */
export async function startPluginOAuth({ provider, userId, redirectUri, client, store }) {
  if (!provider?.oauth) throw new Error('Provider does not use OAuth');
  if (!provider.oauth.clientId) {
    if (client?.clientId) {
      const clean = { clientId: String(client.clientId).trim(), clientSecret: client.clientSecret ? String(client.clientSecret).trim() : undefined };
      await store._saveApiKey(userId, clientRowId(provider.id), JSON.stringify(clean));
    }
    if (!(await readClient(provider, userId, store))) {
      const error = new Error(`${provider.name} needs an OAuth client ID from your ${provider.name} developer settings.`);
      error.code = 'CLIENT_CREDENTIALS_REQUIRED';
      throw error;
    }
  }
  const { clientId } = await readClient(provider, userId, store);

  pruneSessions();
  const state = base64url(crypto.randomBytes(24));
  const verifier = base64url(crypto.randomBytes(48));
  const session = { state, providerId: provider.id, userId, redirectUri, verifier, status: 'pending', createdAt: Date.now() };
  sessions.set(state, session);

  const url = new URL(provider.oauth.authorizationUrl);
  const params = {
    ...provider.oauth.authorizationParams,
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  };
  if (provider.oauth.scopes.length) params.scope = provider.oauth.scopes.join(provider.oauth.scopeSeparator);
  if (provider.oauth.pkce) {
    params.code_challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    params.code_challenge_method = 'S256';
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { authUrl: url.href, sessionId: state };
}

async function tokenRequest(provider, client, form, fetcher) {
  const body = new URLSearchParams({ ...form, client_id: client.clientId });
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const response = await fetcher(provider.oauth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    // The provider's error code is safe to surface; the body may echo secrets, so nothing else is.
    throw new Error(`${provider.name} token endpoint refused the request${data.error ? ` (${String(data.error).slice(0, 60)})` : ` (HTTP ${response.status})`}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: Number.isFinite(Number(data.expires_in)) ? Date.now() + Number(data.expires_in) * 1000 : null,
  };
}

/** Redeem the provider's redirect. Only the unguessable `state` identifies the session. */
export async function completePluginOAuth({ state, code, error, resolveProvider, store, fetcher = fetch }) {
  const session = sessions.get(String(state || ''));
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) return { ok: false, error: 'This sign-in link has expired. Start again from AGNT.' };
  if (session.status !== 'pending') return { ok: session.status === 'success', error: session.error };
  const finish = (status, message) => {
    session.status = status;
    session.error = message;
    return { ok: status === 'success', error: message, providerName: session.providerName };
  };
  const provider = resolveProvider(session.providerId);
  if (!provider) return finish('error', 'The plugin that declared this connection is no longer installed.');
  session.providerName = provider.name;
  if (error) return finish('error', `${provider.name} did not grant access (${String(error).slice(0, 60)}).`);
  if (!code) return finish('error', 'No authorization code was returned.');
  try {
    const client = await readClient(provider, session.userId, store);
    if (!client) return finish('error', 'OAuth client credentials are missing.');
    const form = { grant_type: 'authorization_code', code: String(code), redirect_uri: session.redirectUri };
    if (provider.oauth.pkce) form.code_verifier = session.verifier;
    const tokens = await tokenRequest(provider, client, form, fetcher);
    await store._saveTokens(session.userId, provider.id, tokens);
    return finish('success');
  } catch (err) {
    return finish('error', err.message);
  }
}

export function getPluginOAuthStatus(sessionId) {
  const session = sessions.get(String(sessionId || ''));
  if (!session) return { status: 'error', error: 'Unknown or expired sign-in session.' };
  return { status: session.status, error: session.error };
}

/**
 * The access token for a plugin OAuth provider, refreshed when it is about to
 * expire. Returns null when there is nothing usable, which callers already
 * present as "not connected".
 */
export async function getPluginOAuthAccessToken({ provider, userId, store, fetcher = fetch }) {
  const tokens = await store._getTokens(userId, provider.id);
  if (!tokens?.access_token) return null;
  const expiresAt = tokens.expires_at ? Number(tokens.expires_at) : null;
  if (!expiresAt || expiresAt - REFRESH_SKEW_MS > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  const client = await readClient(provider, userId, store);
  if (!client) return null;
  try {
    const next = await tokenRequest(provider, client, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, fetcher);
    // Providers may omit a new refresh token; the old one then stays valid.
    await store._saveTokens(userId, provider.id, { ...next, refresh_token: next.refresh_token || tokens.refresh_token });
    return next.access_token;
  } catch (err) {
    console.warn(`[pluginOAuth] ${provider.id}: refresh failed: ${err.message}`);
    return null;
  }
}

/** Test seam: sessions are module state. */
export function _resetPluginOAuthSessions() {
  sessions.clear();
}
