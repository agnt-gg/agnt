/**
 * Members of a hosted team instance get AI keys: their own (from their own
 * vault, with their own session), then the team's when the owner pays. Before
 * this, every non-owner was refused every provider, so a member on a Business
 * instance had no working model at all (measured on genii, 2026-10-27: zero
 * model calls ever made by either member).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ENV_KEY_MAP from './envKeyMap.js';

const OWNER = 'owner-1';
const MEMBER = 'member-2';
const h = vi.hoisted(() => ({ vault: {}, connected: {}, sessions: {}, calls: [], subscriptions: {} }));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url, options = {}) => {
      const token = String(options.headers?.Authorization || '').replace(/^Bearer /, '');
      h.calls.push({ url, token });
      const who = Object.keys(h.sessions).find((id) => h.sessions[id] === token);
      if (url.endsWith('/auth/valid-token')) {
        const key = who && h.vault[who]?.[options.params?.providerId];
        if (!key) throw Object.assign(new Error('not found'), { response: { status: 404 } });
        return { data: { access_token: key } };
      }
      if (url.endsWith('/auth/connected')) return { data: (who && h.connected[who]) || [] };
      throw new Error('unexpected ' + url);
    }),
  },
}));
vi.mock('../../models/UserModel.js', () => ({ default: { getPreferences: async () => ({ global: {} }) } }));
vi.mock('../../models/database/index.js', () => ({
  default: { all: (_sql, _params, cb) => cb(null, []), get: (_sql, _params, cb) => cb(null, undefined), run: (_sql, _params, cb) => cb && cb(null) },
}));
vi.mock('./sessionDiscovery.js', () => ({ discoverSessions: () => ({ sessions: [], connected: [], adoptable: [] }) }));
vi.mock('../../routes/Middleware.js', () => ({ getUserTokenFromSession: () => null }));
vi.mock('./sessionTokenCache.js', () => ({
  getSessionToken: (id) => h.sessions[id] || null,
  authHeader: (id) => (h.sessions[id] ? { Authorization: `Bearer ${h.sessions[id]}` } : {}),
}));
vi.mock('./localProviderAccess.js', () => ({ isLocalProviderDisconnected: async () => false }));
vi.mock('../ai/memberConnections.js', () => ({
  subscriptionConnectionFor: async (userId, providerId) => h.subscriptions[`${userId}/${providerId}`] || null,
}));

let AuthManager;
let billing;
let shared;

beforeEach(async () => {
  vi.resetModules();
  for (const name of Object.values(ENV_KEY_MAP)) vi.stubEnv(name, '');
  vi.stubEnv('REMOTE_URL', 'https://api.example');
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', OWNER);
  vi.stubEnv('OPENAI_API_KEY', 'owner-openai');
  vi.stubEnv('GROQ_API_KEY', 'owner-groq');
  h.vault = {}; h.connected = {}; h.calls = []; h.subscriptions = {};
  shared = [];
  h.sessions = { [OWNER]: 'owner-session', [MEMBER]: 'member-session' };
  billing = 'team';
  const memberAi = await import('./memberAi.js');
  memberAi.useSettingsStore({ read: () => ({ billing, sharedSubscriptions: shared }), write: (value) => { billing = value.billing; shared = value.sharedSubscriptions || []; } });
  AuthManager = (await import('./AuthManager.js')).default;
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('a member of a hosted instance', () => {
  it("uses their own key first, fetched from their vault with their own session", async () => {
    h.vault[MEMBER] = { openai: 'member-openai' };
    expect(await AuthManager.getValidAccessToken(MEMBER, 'openai')).toBe('member-openai');
    expect(h.calls.at(-1)).toEqual({ url: 'https://api.example/auth/valid-token', token: 'member-session' });
  });

  it("falls back to the team's key when the owner pays", async () => {
    expect(await AuthManager.getValidAccessToken(MEMBER, 'openai')).toBe('owner-openai');
  });

  it("gets no team key when each member pays", async () => {
    billing = 'member';
    expect(await AuthManager.getValidAccessToken(MEMBER, 'openai')).toBeNull();
    h.vault[MEMBER] = { openai: 'member-openai' };
    expect(await AuthManager.getValidAccessToken(MEMBER, 'openai')).toBe('member-openai');
  });

  it("never gets the owner's connected apps", async () => {
    await expect(AuthManager.getValidAccessToken(MEMBER, 'gmail')).rejects.toThrow(/approved team connections/);
  });

  it("borrows the owner's subscription only when the owner shares it, and prefers their own", async () => {
    vi.spyOn(AuthManager, '_getApiKey').mockImplementation(async (user, provider) => (user === OWNER && provider === 'kimi-code' ? 'owner-kimi-code' : null));
    expect(await AuthManager.getValidAccessToken(MEMBER, 'kimi-code')).toBeNull();
    shared = ['kimi-code'];
    billing = 'member'; // sharing a subscription is its own choice, separate from who pays for keys
    expect(await AuthManager.getValidAccessToken(MEMBER, 'kimi-code')).toBe('owner-kimi-code');
    h.vault[MEMBER] = { 'kimi-code': 'member-kimi-code' };
    expect(await AuthManager.getValidAccessToken(MEMBER, 'kimi-code')).toBe('member-kimi-code');
  });

  it('gets Claude Code from their own sign-in (or the shared one), never from a key lookup', async () => {
    expect(await AuthManager.getValidAccessToken(MEMBER, 'claude-code')).toBeNull();
    h.subscriptions[`${MEMBER}/claude-code`] = { getAccessToken: async () => 'member-claude-token' };
    expect(await AuthManager.getValidAccessToken(MEMBER, 'claude-code')).toBe('member-claude-token');
    expect(h.calls.filter((call) => call.url.endsWith('/auth/valid-token'))).toEqual([]);
  });

  it("lists a subscription the owner shares even when each member pays for keys", async () => {
    billing = 'member';
    shared = ['kimi-code'];
    h.connected[OWNER] = ['kimi-code', 'groq'];
    const ids = (await AuthManager.getConnectedApps(MEMBER, 'member-session')).map((entry) => entry.providerId);
    expect(ids).toEqual(['kimi-code']);
  });

  it("runs AGNT Models on the owner's account when the team pays, their own otherwise", async () => {
    expect(await AuthManager.getValidAccessToken(MEMBER, 'agnt')).toBe('owner-session');
    billing = 'member';
    expect(await AuthManager.getValidAccessToken(MEMBER, 'agnt')).toBe('member-session');
  });

  it('sees their own AI connections plus the lendable team ones, never apps or the instance CLI', async () => {
    h.connected[MEMBER] = ['anthropic', 'gmail'];
    h.connected[OWNER] = ['kimi-code', 'github'];
    const ids = (await AuthManager.getConnectedApps(MEMBER, 'member-session')).map((entry) => entry.providerId).sort();
    expect(ids).toEqual(['anthropic', 'groq', 'openai']);
  });

  it('sees only their own when each member pays', async () => {
    billing = 'member';
    h.connected[MEMBER] = ['anthropic'];
    const ids = (await AuthManager.getConnectedApps(MEMBER, 'member-session')).map((entry) => entry.providerId);
    expect(ids).toEqual(['anthropic']);
  });
});

describe('unchanged for everyone else', () => {
  it("the owner keeps the instance's keys", async () => {
    expect(await AuthManager.getValidAccessToken(OWNER, 'openai')).toBe('owner-openai');
  });
  it('a desktop install is not a hosted instance', async () => {
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    expect(await AuthManager.getValidAccessToken('anyone', 'openai')).toBe('owner-openai');
  });
  it('an anonymous connected-apps ask is not sent to the vault at all', async () => {
    await AuthManager.getConnectedApps(OWNER, null);
    expect(h.calls.filter((call) => call.url.endsWith('/auth/connected'))).toEqual([]);
  });
});
