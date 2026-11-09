/**
 * The legacy OpenRouter paths answer exactly like the generic provider paths.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';

const SECRET = 'test-signing-secret-for-legacy-model-routes';

vi.mock('../services/auth/AuthManager.js', () => ({
  default: {
    getValidAccessToken: async () => null,
    getConnectedApps: async () => [],
  },
}));

let server;
let baseUrl;
let prevSecret;
let prevTrustRemote;
const realFetch = globalThis.fetch;

const call = async (method, path, { token } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await realFetch(`${baseUrl}${path}`, { method, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body };
};

beforeAll(async () => {
  prevSecret = process.env.JWT_SECRET;
  prevTrustRemote = process.env.TRUST_REMOTE_AUTH;
  process.env.JWT_SECRET = SECRET;
  process.env.TRUST_REMOTE_AUTH = 'false';

  // Upstream catalogues are out of scope here: any outbound call fails at once.
  vi.stubGlobal('fetch', async () => {
    throw new Error('network disabled in this test');
  });

  const ModelRoutes = (await import('./ModelRoutes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/models', ModelRoutes);
  app.use('/api/openrouter', ModelRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (prevSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevSecret;
  if (prevTrustRemote === undefined) delete process.env.TRUST_REMOTE_AUTH;
  else process.env.TRUST_REMOTE_AUTH = prevTrustRemote;
});

const signedIn = () => jwt.sign({ id: 'legacy-route-user', email: 'user@example.test' }, SECRET);

describe('legacy OpenRouter model routes', () => {
  it.each(['/api/openrouter/models', '/api/models/models'])('GET %s answers like the generic route', async (legacyPath) => {
    const generic = await call('GET', '/api/models/openrouter/models', { token: signedIn() });
    const legacy = await call('GET', legacyPath, { token: signedIn() });

    expect(legacy.status).toBe(generic.status);
    expect(legacy.body?.success).toBe(generic.body?.success);
    expect(legacy.body?.error).toBe(generic.body?.error);
  });

  it.each(['/api/openrouter/models/refresh', '/api/models/models/refresh'])(
    'POST %s answers like the generic route',
    async (legacyPath) => {
      const generic = await call('POST', '/api/models/openrouter/models/refresh', { token: signedIn() });
      const legacy = await call('POST', legacyPath, { token: signedIn() });

      expect(legacy.status).toBe(generic.status);
      expect(legacy.body?.success).toBe(generic.body?.success);
      expect(legacy.body?.error).toBe(generic.body?.error);
    },
  );

  it('the server keeps answering after a legacy request', async () => {
    await call('GET', '/api/openrouter/models', { token: signedIn() });
    const after = await call('GET', '/api/models/schema-version');
    expect(after.status).toBe(200);
  });

  it.each([
    ['POST', '/api/models/openrouter/models/refresh'],
    ['POST', '/api/openrouter/models/refresh'],
  ])('%s %s needs a signed-in caller', async (method, path) => {
    const { status } = await call(method, path);
    expect(status).toBe(401);
  });
});
