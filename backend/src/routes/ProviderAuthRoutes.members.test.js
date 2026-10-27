/**
 * On a hosted team instance a member's Claude Code / Codex sign-in goes to
 * their own connection, and a member can never change the instance's own
 * sign-ins (before this, a member's "connect" wrote over the owner's).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';

const h = vi.hoisted(() => {
  const connection = (label) => ({
    label,
    saveManualToken: vi.fn(async () => ({ success: true })),
    checkApiUsable: vi.fn(async () => ({ available: true, apiUsable: true, who: label })),
    logout: vi.fn(async () => ({ success: true })),
    describeCredential: vi.fn(() => ({ connected: false })),
    flushVault: vi.fn(async () => {}),
  });
  return { owner: connection('owner'), member: connection('member'), gemini: connection('gemini'), preferences: new Map() };
});

vi.mock('../models/UserModel.js', () => ({ default: {
  getPreferences: async (id) => ({ global: h.preferences.get(id) || {} }),
  updatePreferences: async (id, patch) => h.preferences.set(id, { ...(h.preferences.get(id) || {}), ...patch.global }),
} }));
const asUser = (req, res, next) => {
  const id = req.headers.authorization?.replace('Bearer ', '');
  if (!id) return res.status(401).json({ error: 'Authentication required' });
  req.user = { id, userId: id }; next();
};
vi.mock('./Middleware.js', () => ({ authenticateToken: asUser }));
vi.mock('../utils/authGuard.js', () => ({ requireAuthHeader: asUser }));
vi.mock('../services/auth/AuthDispatcher.js', () => ({
  getAuthEntry: (id) => ({
    'claude-code': { local: true, manager: h.owner, config: { authScheme: 'claude-code' }, caps: ['oauth-pkce'] },
    'gemini-cli': { local: true, manager: h.gemini, config: { authScheme: 'gemini-cli' }, caps: [] },
  })[id] || null,
  getCapabilities: () => ({}), isLocalProvider: () => true,
}));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('../services/ai/CodexCliService.js', () => ({ default: { getDefaultWorkdir: () => '', getToolRunnerPath: () => '' } }));
vi.mock('../services/ai/memberConnections.js', () => ({ memberConnection: vi.fn(async () => h.member) }));

const { useSettingsStore } = await import('../services/auth/memberAi.js');
const { default: router } = await import('./ProviderAuthRoutes.js');

let server, base, settings;
beforeAll(async () => {
  process.env.AGNT_TENANT_SLUG = 'bravo';
  process.env.AGNT_TENANT_OWNER = 'owner-1';
  const app = express(); app.use(express.json()); app.use(router);
  server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  delete process.env.AGNT_TENANT_SLUG; delete process.env.AGNT_TENANT_OWNER;
  useSettingsStore(null);
  server.closeAllConnections(); await new Promise((r) => server.close(r));
});
beforeEach(() => {
  vi.clearAllMocks();
  h.member.describeCredential.mockReturnValue({ connected: false });
  settings = {};
  useSettingsStore({ read: () => settings, write: (value) => { settings = value; } });
});

const call = (user, method, url, body) => fetch(base + url, {
  method, headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});

describe("a member's subscription sign-in on a hosted instance", () => {
  it("saves a member's Claude Code token to their own connection, never the owner's", async () => {
    const response = await call('member-2', 'POST', '/claude-code/auth/connect', { token: 'sk-ant-api03-member' });
    expect(response.status).toBe(200);
    expect(h.member.saveManualToken).toHaveBeenCalledWith('sk-ant-api03-member');
    expect(h.member.flushVault).toHaveBeenCalled();
    expect(h.owner.saveManualToken).not.toHaveBeenCalled();
  });

  it("the owner still signs in to the instance's own", async () => {
    await call('owner-1', 'POST', '/claude-code/auth/connect', { token: 'sk-ant-api03-owner' });
    expect(h.owner.saveManualToken).toHaveBeenCalledWith('sk-ant-api03-owner');
    expect(h.member.saveManualToken).not.toHaveBeenCalled();
  });

  it("a member cannot change any other instance sign-in", async () => {
    const response = await call('member-2', 'POST', '/gemini-cli/auth/connect', { apiKey: 'x' });
    expect(response.status).toBe(403);
    expect(h.gemini.saveManualToken).not.toHaveBeenCalled();
  });

  it("a member not signed in sees the owner's sign-in only when it is shared", async () => {
    const hidden = await (await call('member-2', 'GET', '/gemini-cli/auth/status')).json();
    expect(hidden).toMatchObject({ available: false });
    expect(h.gemini.checkApiUsable).not.toHaveBeenCalled();

    settings = { sharedSubscriptions: ['claude-code'] };
    const shared = await (await call('member-2', 'GET', '/claude-code/auth/status')).json();
    expect(shared).toMatchObject({ available: true, who: 'owner', sharedByOwner: true });
  });

  it("a member signed in sees their own, even when the owner shares", async () => {
    settings = { sharedSubscriptions: ['claude-code'] };
    h.member.describeCredential.mockReturnValue({ connected: true });
    const own = await (await call('member-2', 'GET', '/claude-code/auth/status')).json();
    expect(own).toMatchObject({ who: 'member', ownSignIn: true });
  });

  it("a member's sign-out clears their own, and leaves the owner's alone", async () => {
    const response = await call('member-2', 'POST', '/claude-code/auth/disconnect');
    expect(response.status).toBe(200);
    expect(h.member.logout).toHaveBeenCalled();
    expect(h.owner.logout).not.toHaveBeenCalled();
  });
});
