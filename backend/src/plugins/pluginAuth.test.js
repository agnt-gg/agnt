import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { bindPluginSource, listPluginAuthProviders, getPluginAuthProvider, normalizeAuthDeclaration, publicProviderView } from './pluginAuth.js';
import { startPluginOAuth, completePluginOAuth, getPluginOAuthStatus, getPluginOAuthAccessToken, clientRowId, _resetPluginOAuthSessions } from './pluginOAuth.js';
import { getAuthEntry, getCapabilities } from '../services/auth/AuthDispatcher.js';

const APIKEY = { id: 'pipedrive', name: 'Pipedrive', type: 'apikey', keyLabel: 'API token', instructions: 'Personal preferences → API' };
const OAUTH = {
  id: 'ga4',
  name: 'Google Analytics',
  type: 'oauth2',
  authorizationUrl: 'https://accounts.example.com/o/oauth2/auth',
  tokenUrl: 'https://oauth2.example.com/token',
  scopes: ['analytics.readonly', 'openid'],
  authorizationParams: { access_type: 'offline', client_id: 'smuggled', redirect_uri: 'https://evil.example' },
};
const plugins = (...manifests) => manifests.map((manifest) => ({ manifest }));

function memoryStore() {
  const keys = new Map();
  const tokens = new Map();
  return {
    keys,
    tokens,
    _getApiKey: async (u, p) => keys.get(u + '|' + p) ?? null,
    _saveApiKey: async (u, p, v) => void keys.set(u + '|' + p, v),
    _getTokens: async (u, p) => tokens.get(u + '|' + p) ?? null,
    _saveTokens: async (u, p, t) => void tokens.set(u + '|' + p, { ...t }),
  };
}

function tokenEndpoint(reply) {
  const calls = [];
  const fetcher = vi.fn(async (url, init) => {
    calls.push({ url, form: Object.fromEntries(init.body) });
    const { status = 200, body } = reply(calls.at(-1));
    return { ok: status < 400, status, json: async () => body };
  });
  return { fetcher, calls };
}

afterEach(() => {
  bindPluginSource(() => []);
  _resetPluginOAuthSessions();
});

describe('plugin auth declarations', () => {
  it('lists valid declarations from every loaded plugin and reports the rest', () => {
    bindPluginSource(() =>
      plugins(
        { name: 'crm', auth: [APIKEY, { id: 'Bad Id!', type: 'apikey' }] },
        { name: 'analytics', auth: [OAUTH, { id: 'insecure', type: 'oauth2', authorizationUrl: 'http://x.example', tokenUrl: 'https://y.example' }] },
        { name: 'dupe', auth: [{ ...APIKEY, name: 'Other' }] },
        { name: 'broken', auth: 'nope' },
        { name: 'none' }
      )
    );
    const { providers, problems } = listPluginAuthProviders();
    expect(providers.map((p) => [p.id, p.plugin])).toEqual([['pipedrive', 'crm'], ['ga4', 'analytics']]);
    expect(problems).toEqual([
      expect.stringContaining('crm: auth id "Bad Id!"'),
      expect.stringContaining('analytics: auth "insecure": oauth2 needs https'),
      'dupe: auth "pipedrive" already declared by crm',
      'broken: manifest.auth must be an array',
    ]);
  });

  it('reflects install and uninstall immediately: nothing is cached', () => {
    let loaded = plugins({ name: 'crm', auth: [APIKEY] });
    bindPluginSource(() => loaded);
    expect(getPluginAuthProvider('PIPEDRIVE')?.name).toBe('Pipedrive');
    loaded = [];
    expect(getPluginAuthProvider('pipedrive')).toBeNull();
  });

  it('never lets a manifest override the parameters the OAuth flow owns', () => {
    const { provider } = normalizeAuthDeclaration(OAUTH, 'analytics');
    expect(provider.oauth.authorizationParams).toEqual({ access_type: 'offline' });
  });

  it('exposes nothing flow-internal to the UI', () => {
    const view = publicProviderView(normalizeAuthDeclaration(OAUTH, 'analytics').provider);
    expect(view).toMatchObject({ id: 'ga4', connectionType: 'oauth', pluginProvided: true, needsClientCredentials: true });
    expect(view).not.toHaveProperty('oauth');
  });
});

describe('dispatcher fallback', () => {
  it('routes an undeclared id nowhere, a declared one to local storage', () => {
    expect(getAuthEntry('pipedrive')).toBeNull();
    bindPluginSource(() => plugins({ name: 'crm', auth: [APIKEY, OAUTH] }));
    expect(getAuthEntry('pipedrive')).toMatchObject({ plugin: true, local: false, manager: null });
    expect(getCapabilities('pipedrive')).toMatchObject({ plugin: true, capabilities: ['status', 'connect-apikey', 'disconnect'] });
    expect(getCapabilities('ga4').capabilities).toContain('oauth-plugin');
  });

  it('never lets a plugin redefine a built-in provider', () => {
    bindPluginSource(() => plugins({ name: 'impostor', auth: [{ id: 'openai', type: 'apikey' }] }));
    expect(getAuthEntry('openai')?.plugin).toBeFalsy();
  });
});

describe('plugin OAuth flow', () => {
  const provider = normalizeAuthDeclaration(OAUTH, 'analytics').provider;
  const redirectUri = 'http://localhost:3333/api/providers/ga4/auth/plugin-oauth/callback';
  let store;
  beforeEach(() => {
    store = memoryStore();
  });

  it('refuses to start without client credentials and names what is missing', async () => {
    await expect(startPluginOAuth({ provider, userId: 'u1', redirectUri, store })).rejects.toMatchObject({ code: 'CLIENT_CREDENTIALS_REQUIRED' });
  });

  it('completes code + PKCE, stores tokens, and the session is single use', async () => {
    const { authUrl, sessionId } = await startPluginOAuth({ provider, userId: 'u1', redirectUri, client: { clientId: 'cid', clientSecret: 'sec' }, store });
    expect(JSON.parse(store.keys.get('u1|' + clientRowId('ga4')))).toEqual({ clientId: 'cid', clientSecret: 'sec' });
    const url = new URL(authUrl);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: redirectUri,
      state: sessionId,
      scope: 'analytics.readonly openid',
      code_challenge_method: 'S256',
      access_type: 'offline',
    });

    const { fetcher, calls } = tokenEndpoint(() => ({ body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } }));
    const outcome = await completePluginOAuth({ state: sessionId, code: 'the-code', resolveProvider: () => provider, store, fetcher });
    expect(outcome.ok).toBe(true);
    // The verifier sent to the token endpoint must hash to the challenge sent to the browser.
    const verifier = calls[0].form.code_verifier;
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(url.searchParams.get('code_challenge'));
    expect(calls[0].form).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', client_id: 'cid', client_secret: 'sec', redirect_uri: redirectUri });
    expect(store.tokens.get('u1|ga4')).toMatchObject({ access_token: 'at-1', refresh_token: 'rt-1' });
    expect(getPluginOAuthStatus(sessionId).status).toBe('success');

    await completePluginOAuth({ state: sessionId, code: 'replayed', resolveProvider: () => provider, store, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown state and reports a denied consent without calling the token endpoint', async () => {
    const { fetcher } = tokenEndpoint(() => ({ body: {} }));
    expect((await completePluginOAuth({ state: 'forged', code: 'x', resolveProvider: () => provider, store, fetcher })).ok).toBe(false);
    const { sessionId } = await startPluginOAuth({ provider, userId: 'u1', redirectUri, client: { clientId: 'cid' }, store });
    const denied = await completePluginOAuth({ state: sessionId, error: 'access_denied', resolveProvider: () => provider, store, fetcher });
    expect(denied).toMatchObject({ ok: false, error: expect.stringContaining('access_denied') });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not echo the token endpoint body into the error', async () => {
    const { sessionId } = await startPluginOAuth({ provider, userId: 'u1', redirectUri, client: { clientId: 'cid' }, store });
    const { fetcher } = tokenEndpoint(() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'secret-ish detail' } }));
    const outcome = await completePluginOAuth({ state: sessionId, code: 'c', resolveProvider: () => provider, store, fetcher });
    expect(outcome.error).toContain('invalid_grant');
    expect(outcome.error).not.toContain('secret-ish');
  });

  it('returns a live token as is and refreshes one about to expire, keeping the old refresh token', async () => {
    await store._saveApiKey('u1', clientRowId('ga4'), JSON.stringify({ clientId: 'cid' }));
    await store._saveTokens('u1', 'ga4', { access_token: 'live', refresh_token: 'rt', expires_at: Date.now() + 3600e3 });
    const { fetcher } = tokenEndpoint(() => ({ body: { access_token: 'fresh', expires_in: 3600 } }));
    expect(await getPluginOAuthAccessToken({ provider, userId: 'u1', store, fetcher })).toBe('live');
    expect(fetcher).not.toHaveBeenCalled();

    await store._saveTokens('u1', 'ga4', { access_token: 'stale', refresh_token: 'rt', expires_at: Date.now() + 5e3 });
    expect(await getPluginOAuthAccessToken({ provider, userId: 'u1', store, fetcher })).toBe('fresh');
    expect(store.tokens.get('u1|ga4')).toMatchObject({ access_token: 'fresh', refresh_token: 'rt' });
  });

  it('answers null, not a stale token, when an expired token cannot be refreshed', async () => {
    await store._saveTokens('u1', 'ga4', { access_token: 'stale', refresh_token: null, expires_at: Date.now() - 1 });
    expect(await getPluginOAuthAccessToken({ provider, userId: 'u1', store })).toBeNull();
  });
});
