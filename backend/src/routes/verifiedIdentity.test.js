/**
 * A FORGED TOKEN MUST NOT RESOLVE TO A USER.
 *
 * routeSecurity.test.js proves `jwt.decode` is absent from the source. That is
 * a scan, and a scan can be satisfied by a rename. This proves the BEHAVIOUR
 * over the wire: a token signed with the wrong key gets no identity, and the
 * credential lookup it used to reach is never performed.
 *
 * This is the test that would have caught the original defect. Before the fix,
 * every assertion below that expects a refusal would have seen the victim's
 * user id sail through, because a decoded token is just base64 — the caller
 * types whatever id they like.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';

const SECRET = 'test-signing-secret-for-verified-identity';
const VICTIM = 'victim-user-id-0123456789abcdef';

// The credential resolver these routes used to reach with an unverified id.
// Spied rather than stubbed away, so "was it called, and with whom" is the
// assertion.
const getValidAccessToken = vi.fn(async () => 'sk-a-real-secret-key');
const getConnectedApps = vi.fn(async () => []);

vi.mock('../services/auth/AuthManager.js', () => ({
  default: {
    getValidAccessToken: (...args) => getValidAccessToken(...args),
    getConnectedApps: (...args) => getConnectedApps(...args),
  },
}));

const checkAll = vi.fn(async () => ({}));
vi.mock('../services/ai/ProviderHealthCheck.js', () => ({
  default: {
    checkAll: (...args) => checkAll(...args),
    getSummary: () => ({ healthy: 0, total: 0 }),
    getStatus: () => ({}),
  },
}));

let server;
let baseUrl;
let prevSecret;
let prevTrustRemote;

const req = async (method, path, { token } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* some responses are empty */
  }
  return { status: res.status, body };
};

beforeAll(async () => {
  prevSecret = process.env.JWT_SECRET;
  prevTrustRemote = process.env.TRUST_REMOTE_AUTH;
  process.env.JWT_SECRET = SECRET;
  // TRUST_REMOTE_AUTH=true deliberately decodes without verifying. That mode is
  // for a deployment where a proxy has already validated the token; it is NOT
  // what a tenant runs, and leaving it on would make these assertions vacuous.
  process.env.TRUST_REMOTE_AUTH = 'false';

  const ModelRoutes = (await import('./ModelRoutes.js')).default;
  const AuthRoutes = (await import('./AuthRoutes.js')).default;

  const app = express();
  app.use(express.json());
  app.use('/api/models', ModelRoutes);
  app.use('/api/auth', AuthRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (prevSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevSecret;
  if (prevTrustRemote === undefined) delete process.env.TRUST_REMOTE_AUTH;
  else process.env.TRUST_REMOTE_AUTH = prevTrustRemote;
});

beforeEach(() => {
  getValidAccessToken.mockClear();
  getConnectedApps.mockClear();
  checkAll.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

/** A token an attacker can produce: correct shape, wrong signature. */
const forged = (id = VICTIM) => jwt.sign({ id, email: 'attacker@example.test' }, 'not-the-real-secret');

/** A token the issuer really produced. */
const genuine = (id = VICTIM) => jwt.sign({ id, email: 'real@example.test' }, SECRET);

describe('POST /provider-health/check — resolves every credential, so it is guarded', () => {
  it('refuses an anonymous caller', async () => {
    const { status } = await req('POST', '/api/models/provider-health/check');
    expect(status).toBe(401);
    expect(checkAll).not.toHaveBeenCalled();
  });

  it('refuses a forged token', async () => {
    const { status } = await req('POST', '/api/models/provider-health/check', { token: forged() });
    expect(status).toBe(401);
    // The whole point: no probe runs, so no credential is resolved and the
    // response cannot report which providers the victim has working keys on.
    expect(checkAll).not.toHaveBeenCalled();
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });

  it('admits a genuine token — anti-vacuity for the two refusals above', async () => {
    const { status } = await req('POST', '/api/models/provider-health/check', { token: genuine() });
    expect(status).toBe(200);
    expect(checkAll).toHaveBeenCalledTimes(1);
  });

  it('resolves credentials for the id in the VERIFIED token, not a claimed one', async () => {
    checkAll.mockImplementationOnce(async (resolve) => {
      await resolve('openai');
      return {};
    });
    await req('POST', '/api/models/provider-health/check', { token: genuine('the-real-owner') });
    expect(getValidAccessToken).toHaveBeenCalledWith('the-real-owner', 'openai');
  });
});

describe('GET /:provider/models — never looks up a key for an unverified id', () => {
  it('does not resolve a credential for a forged token', async () => {
    await req('GET', '/api/models/openai/models', { token: forged() });
    // Whatever the route decides to answer, it must not have gone to the
    // victim's stored key to decide it.
    const calledForVictim = getValidAccessToken.mock.calls.some(([userId]) => userId === VICTIM);
    expect(calledForVictim).toBe(false);
  });

  it('refuses a forged token on a provider that requires a key', async () => {
    const { status, body } = await req('GET', '/api/models/anthropic/models', { token: forged() });
    expect(status).toBe(401);
    expect(body?.error).toMatch(/Invalid authentication token/i);
  });
});

describe('POST /:provider/models/refresh — same rule on the write path', () => {
  it('refuses a forged token', async () => {
    const { status } = await req('POST', '/api/models/anthropic/models/refresh', { token: forged() });
    expect(status).toBe(401);
    const calledForVictim = getValidAccessToken.mock.calls.some(([userId]) => userId === VICTIM);
    expect(calledForVictim).toBe(false);
  });
});

describe('GET /auth/connected — soft, but still verified', () => {
  it('stays reachable anonymously, with no user id', async () => {
    // Deliberate: env-sourced providers are install-global, so an anonymous
    // caller still gets a useful answer. It just is not anybody's answer.
    const { status } = await req('GET', '/api/auth/connected');
    expect(status).toBe(200);
    expect(getConnectedApps).toHaveBeenCalledWith(null, null);
  });

  it('treats a forged token as anonymous rather than as its subject', async () => {
    const { status } = await req('GET', '/api/auth/connected', { token: forged() });
    expect(status).toBe(200);
    const [userId] = getConnectedApps.mock.calls[0];
    expect(userId, 'a forged token must not name a user').toBeNull();
  });

  it('still forwards the raw token so the remote API can judge it itself', async () => {
    const token = forged();
    await req('GET', '/api/auth/connected', { token });
    const [, forwarded] = getConnectedApps.mock.calls[0];
    expect(forwarded).toBe(token);
  });

  it('uses the subject of a genuine token — anti-vacuity', async () => {
    await req('GET', '/api/auth/connected', { token: genuine('genuine-owner') });
    expect(getConnectedApps).toHaveBeenCalledWith('genuine-owner', expect.any(String));
  });
});
