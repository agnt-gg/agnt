import { describe, it, expect, beforeEach } from 'vitest';
import { startPluginOAuth, completePluginOAuth, getPluginOAuthStatus, _resetPluginOAuthSessions } from './pluginOAuth.js';

const provider = {
  id: 'acme',
  name: 'Acme',
  oauth: { clientId: 'cid', authorizationUrl: 'https://acme.test/auth', tokenUrl: 'https://acme.test/token', scopes: [], scopeSeparator: ' ', pkce: true, authorizationParams: {} },
};
const store = () => ({ saved: [], _saveApiKey: async () => {}, _getApiKey: async () => null, async _saveTokens(userId, id, tokens) { this.saved.push({ userId, id, tokens }); } });

describe('plugin OAuth redemption', () => {
  beforeEach(() => _resetPluginOAuthSessions());

  it('redeems a state once even when two callbacks race', async () => {
    const s = store();
    const { sessionId } = await startPluginOAuth({ provider, userId: 'u1', redirectUri: 'http://localhost/cb', store: s });
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const fetcher = async () => {
      calls++;
      await gate;
      return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    };
    const args = { state: sessionId, code: 'c', resolveProvider: () => provider, store: s, fetcher };
    const first = completePluginOAuth(args);
    const second = completePluginOAuth(args);
    // While the exchange is in flight the poller still sees the flow as pending.
    expect(getPluginOAuthStatus(sessionId).status).toBe('pending');
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(s.saved).toHaveLength(1);
    expect(s.saved[0]).toMatchObject({ userId: 'u1', id: 'acme' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(getPluginOAuthStatus(sessionId).status).toBe('success');
  });

  it('refuses an unknown state before any exchange', async () => {
    let calls = 0;
    const outcome = await completePluginOAuth({ state: 'forged', code: 'c', resolveProvider: () => provider, store: store(), fetcher: async () => (calls++, {}) });
    expect(outcome.ok).toBe(false);
    expect(calls).toBe(0);
  });
});
