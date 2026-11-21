// disconnectProviderAndRemoveApiKey disconnects on the remote server and in this install.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ order: [], remote: { status: 200, data: { success: true } }, sql: [] }));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(async (url, _body, options = {}) => {
      h.order.push('remote');
      h.remoteCall = { url, auth: options.headers?.Authorization };
      return h.remote;
    }),
    get: vi.fn(async () => ({ data: [] })),
  },
}));
vi.mock('../../models/database/index.js', () => ({
  default: { run: (sql, params, cb) => { h.order.push('local'); h.sql.push({ sql, params }); cb && cb(null); }, get: (_s, _p, cb) => cb(null), all: (_s, _p, cb) => cb(null, []) },
}));
vi.mock('../../models/database/connectionGate.js', () => ({ withTransaction: async (_db, fn) => fn() }));
vi.mock('../../models/UserModel.js', () => ({ default: { getPreferences: async () => ({ global: {} }) } }));
vi.mock('./sessionDiscovery.js', () => ({ discoverSessions: () => ({ sessions: [], connected: [], adoptable: [] }) }));
vi.mock('../../routes/Middleware.js', () => ({ getUserTokenFromSession: () => null }));
vi.mock('./localProviderAccess.js', () => ({ isLocalProviderDisconnected: async () => false }));

let AuthManager;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('REMOTE_URL', 'https://api.example');
  h.order = []; h.sql = []; h.remoteCall = null; h.remote = { status: 200, data: { success: true } };
  AuthManager = (await import('./AuthManager.js')).default;
});

describe('disconnectProviderAndRemoveApiKey', () => {
  it('disconnects on the remote server, then in this install', async () => {
    await AuthManager.disconnectProviderAndRemoveApiKey('viggle', 'user-1', 'session-1');
    expect(h.remoteCall).toEqual({ url: 'https://api.example/auth/disconnect/viggle', auth: 'Bearer session-1' });
    expect(h.order).toEqual(['remote', 'local', 'local']);
    expect(h.sql.map((s) => s.params[1])).toEqual(['viggle', 'viggle']);
  });

  it('changes nothing and reports it when the remote server does not disconnect', async () => {
    h.remote = { status: 502, data: {} };
    await expect(AuthManager.disconnectProviderAndRemoveApiKey('viggle', 'user-1', 'session-1')).rejects.toThrow(/Nothing was disconnected/);
    expect(h.order).toEqual(['remote']);
  });

  it('treats a refusal in the body as a failure too', async () => {
    h.remote = { status: 200, data: { success: false } };
    await expect(AuthManager.disconnectProviderAndRemoveApiKey('viggle', 'user-1', 'session-1')).rejects.toThrow();
    expect(h.order).toEqual(['remote']);
  });

  it('without a session it disconnects in this install only', async () => {
    await AuthManager.disconnectProviderAndRemoveApiKey('viggle', 'user-1');
    expect(h.order).toEqual(['local', 'local']);
  });
});
