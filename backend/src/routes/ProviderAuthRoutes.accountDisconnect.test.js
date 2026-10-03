import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
const fixtures = vi.hoisted(() => ({ preferences: new Map(), logout: vi.fn(), check: vi.fn(async () => ({ available: true, apiUsable: true })) }));
vi.mock('../models/UserModel.js', () => ({ default: {
  getPreferences: async id => ({ global: fixtures.preferences.get(id) || {} }),
  updatePreferences: async (id, patch) => fixtures.preferences.set(id, { ...(fixtures.preferences.get(id) || {}), ...patch.global }),
} }));
vi.mock('./Middleware.js', () => ({ authenticateToken: (req, res, next) => {
  const id = req.headers.authorization?.replace('Bearer ', '');
  if (!id) return res.status(401).json({ error: 'Authentication required' });
  req.user = { id, userId: id }; next();
} }));
vi.mock('../utils/authGuard.js', () => ({ requireAuthHeader: (req, res, next) => {
  const id = req.headers.authorization?.replace('Bearer ', '');
  if (!id) return res.status(401).json({ error: 'Authentication required' });
  req.user = { id, userId: id }; next();
} }));
vi.mock('../services/auth/AuthDispatcher.js', () => ({
  getAuthEntry: () => ({ local: true, manager: { logout: fixtures.logout, checkApiUsable: fixtures.check }, config: { authScheme: 'codex' }, caps: [] }),
  getCapabilities: () => ({}), isLocalProvider: () => true,
}));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('../services/ai/CodexCliService.js', () => ({ default: { getDefaultWorkdir: () => '', getToolRunnerPath: () => '' } }));
vi.mock('../services/auth/sessionDiscovery.js', () => ({ discoverSessions: () => ({ connected: [{ providerId: 'openai-codex' }], disconnected: [] }) }));
import router from './ProviderAuthRoutes.js';
let server, base;
beforeAll(async () => { const app = express(); app.use(express.json()); app.use(router); server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
describe('local disconnect HTTP contract', () => {
  it('disconnect does not invoke global logout; status and discovery remain connected for the second user', async () => {
    const disconnect = await fetch(`${base}/openai-codex/auth/disconnect`, { method: 'POST', headers: { Authorization: 'Bearer alice' } });
    expect(disconnect.status).toBe(200);
    expect((await disconnect.json()).success).toBe(true);
    expect(fixtures.logout).not.toHaveBeenCalled();
    const status = async user => (await fetch(`${base}/openai-codex/auth/status`, { headers: { Authorization: `Bearer ${user}` } })).json();
    expect(await status('alice')).toMatchObject({ available: false, disconnected: true });
    expect(await status('bob')).toMatchObject({ available: true });
    const discovery = async user => (await fetch(`${base}/auth/discover`, { headers: { Authorization: `Bearer ${user}` } })).json();
    expect((await discovery('alice')).connected).toEqual([]);
    expect((await discovery('bob')).connected).toHaveLength(1);
  });
  it('refuses unauthenticated disconnect', async () => {
    expect((await fetch(`${base}/openai-codex/auth/disconnect`, { method: 'POST' })).status).toBe(401);
    expect(fixtures.logout).not.toHaveBeenCalled();
  });
});
