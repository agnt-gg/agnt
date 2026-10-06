import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Regression: /build-generated is the Plugin Forge install path (its Install button and the chat's install_plugin).
// Like every other install route, it must tell the installing account's open clients that a plugin arrived.
const { broadcastToUser } = vi.hoisted(() => ({ broadcastToUser: vi.fn() }));
vi.mock('../utils/realtimeSync.js', async (importOriginal) => ({ ...(await importOriginal()), broadcastToUser }));
vi.mock('./Middleware.js', () => ({ authenticateToken: (req, res, next) => { const user = req.headers['x-test-user']; if (!user) return res.status(401).json({ error: 'auth' }); req.user = { id: user, userId: user }; next(); } }));
vi.mock('../utils/authGuard.js', () => ({ requireAuthHeader: (req, res, next) => (req.user?.userId ? next() : res.status(401).json({ error: 'auth' })) }));
vi.mock('../plugins/PluginInstaller.js', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const root = path.join(os.tmpdir(), 'agnt-build-generated-' + randomUUID());
  return { default: { tempDir: path.join(root, 'tmp'), pluginsDir: path.join(root, 'plugins'), installFromFile: vi.fn(async () => ({ success: true })), getInstalledPlugins: vi.fn(async () => []), getAvailablePlugins: vi.fn(async () => ({ success: true, plugins: [] })), getStats: () => ({}) } };
});
vi.mock('../plugins/PluginManager.js', () => ({ default: { getStats: () => ({}), getPlugin: vi.fn(), getAllPluginSchemas: () => [] } }));
vi.mock('../plugins/reloadAllPlugins.js', () => ({ default: async () => ({ success: true }) }));
import { dbReady } from '../models/database/index.js';
import PluginAccounts from '../plugins/PluginAccountStore.js';
import PluginInstaller from '../plugins/PluginInstaller.js';
import { RealtimeEvents } from '../utils/realtimeSync.js';
import routes from './PluginRoutes.js';

let server, base;
const owner = 'owner-' + randomUUID();
beforeAll(async () => {
  await dbReady;
  await PluginAccounts.ready();
  await PluginAccounts.run('INSERT INTO users(id,email) VALUES(?,?)', [owner, owner + '@test']);
  const app = express();
  app.use(express.json());
  app.use('/plugins', routes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/plugins';
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(path.dirname(PluginInstaller.tempDir), { recursive: true, force: true });
});

const buildGenerated = async (name) => {
  const response = await fetch(base + '/build-generated', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': owner, Authorization: 'Bearer fixture' },
    body: JSON.stringify({ manifest: { name, version: '1.0.0', tools: [] }, toolCode: { 'tool.js': 'export default {};' } }),
  });
  return { status: response.status, body: await response.json() };
};

describe('POST /plugins/build-generated', () => {
  it('broadcasts plugin:installed to the installing account after a successful install', async () => {
    broadcastToUser.mockClear();
    const name = 'generated-' + randomUUID().slice(0, 8);
    const { status, body } = await buildGenerated(name);
    expect(status).toBe(200);
    expect(body.installed).toBe(true);
    expect(RealtimeEvents.PLUGIN_INSTALLED).toBe('plugin:installed');
    expect(broadcastToUser).toHaveBeenCalledTimes(1);
    expect(broadcastToUser).toHaveBeenCalledWith(owner, 'plugin:installed', expect.objectContaining({ name, version: '1.0.0', source: 'generated' }));
  });

  it('does not broadcast when the install fails', async () => {
    broadcastToUser.mockClear();
    PluginInstaller.installFromFile.mockResolvedValueOnce({ success: false, error: 'fixture failure' });
    const { status, body } = await buildGenerated('generated-' + randomUUID().slice(0, 8));
    expect(status).toBe(200);
    expect(body.installed).toBe(false);
    expect(broadcastToUser).not.toHaveBeenCalled();
  });
});
