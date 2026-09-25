import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

// The callback persists through AuthManager; an in-memory stand-in keeps this
// test off the real database while exercising the real route and flow.
const memory = vi.hoisted(() => ({ keys: new Map(), tokens: new Map() }));
vi.mock('../services/auth/AuthManager.js', () => ({
  default: {
    _getApiKey: async (u, p) => memory.keys.get(u + '|' + p) ?? null,
    _saveApiKey: async (u, p, v) => void memory.keys.set(u + '|' + p, v),
    _getTokens: async (u, p) => memory.tokens.get(u + '|' + p) ?? null,
    _saveTokens: async (u, p, t) => void memory.tokens.set(u + '|' + p, t),
  },
}));

const { default: router } = await import('./ProviderAuthRoutes.js');
const { bindPluginSource, getPluginAuthProvider } = await import('../plugins/pluginAuth.js');
const { startPluginOAuth, _resetPluginOAuthSessions } = await import('../plugins/pluginOAuth.js');
const { default: AuthManager } = await import('../services/auth/AuthManager.js');

const oauth = (id) => ({ id, name: `<b>${id}</b>`, type: 'oauth2', authorizationUrl: 'https://auth.example/a', tokenUrl: 'https://auth.example/t' });

let server;
let port;
function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body, csp: res.headers['content-security-policy'] }));
    }).on('error', reject);
  });
}

beforeAll(async () => {
  const app = express();
  app.use('/api/providers', router);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});
afterAll(() => server?.close());
afterEach(() => {
  bindPluginSource(() => []);
  _resetPluginOAuthSessions();
  vi.unstubAllGlobals();
  memory.keys.clear();
  memory.tokens.clear();
});

describe('plugin OAuth callback route', () => {
  it('is reachable without an AGNT credential but refuses a forged state', async () => {
    bindPluginSource(() => [{ manifest: { name: 'p', auth: [oauth('ga4')] } }]);
    const res = await get('/api/providers/ga4/auth/plugin-oauth/callback?state=forged&code=x');
    expect(res.status).toBe(400);
    expect(res.body).toContain('expired');
    expect(res.csp).toContain("default-src 'none'");
  });

  it('404s for an id no plugin declares', async () => {
    const res = await get('/api/providers/nothing/auth/plugin-oauth/callback?state=x');
    expect(res.status).toBe(404);
  });

  it('will not redeem a state issued for a different provider', async () => {
    bindPluginSource(() => [{ manifest: { name: 'p', auth: [oauth('ga4'), oauth('xero')] } }]);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { sessionId } = await startPluginOAuth({ provider: getPluginAuthProvider('ga4'), userId: 'u1', redirectUri: 'http://localhost/cb', client: { clientId: 'c' }, store: AuthManager });
    const res = await get(`/api/providers/xero/auth/plugin-oauth/callback?state=${sessionId}&code=x`);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(memory.tokens.size).toBe(0);
  });

  it('stores tokens on success and escapes provider-controlled text in the page', async () => {
    bindPluginSource(() => [{ manifest: { name: 'p', auth: [oauth('ga4')] } }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: '<script>x</script>' }) })));
    const { sessionId } = await startPluginOAuth({ provider: getPluginAuthProvider('ga4'), userId: 'u1', redirectUri: 'http://localhost/cb', client: { clientId: 'c' }, store: AuthManager });
    const failed = await get(`/api/providers/ga4/auth/plugin-oauth/callback?state=${sessionId}&code=x`);
    expect(failed.body).not.toContain('<script>');
    expect(failed.body).not.toContain('<b>ga4</b>');

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 60 }) })));
    const second = await startPluginOAuth({ provider: getPluginAuthProvider('ga4'), userId: 'u1', redirectUri: 'http://localhost/cb', store: AuthManager });
    const ok = await get(`/api/providers/ga4/auth/plugin-oauth/callback?state=${second.sessionId}&code=x`);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('Connected');
    expect(memory.tokens.get('u1|ga4')).toMatchObject({ access_token: 'at', refresh_token: null });
  });
});
