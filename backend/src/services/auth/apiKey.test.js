/**
 * An AGNT API key authenticates on a DESKTOP install, not only on a tenant.
 *
 * Integrations (a chat bot reaching this backend over the network) used to be
 * handed the 30-day sign-in token, which nothing refreshes, so they died a
 * month in. A key lives until its owner replaces or revokes it; only
 * api.agnt.gg holds key hashes, so a key always goes through the issuer.
 *
 * Pinned here: both REST entry points (Middleware and requireAuth) admit a key
 * through the issuer with no verify-remote mode; a refused key is a 401; a
 * token that is NOT a key still never reaches the network on a desktop; and a
 * key never displaces a live sign-in token as the background credential.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

import { isApiKey } from './apiKey.js';
import { __resetVerifierForTests } from './remoteTokenVerifier.js';
import {
  __resetSessionTokenCacheForTests,
  getSessionToken,
  rememberSessionToken,
} from './sessionTokenCache.js';
import { authenticateToken } from '../../routes/Middleware.js';
import { requireAuth } from '../../utils/authGuard.js';

const SECRET = 'api-key-client-test-secret';
const KEY = 'agnt_sk_' + 'ab12'.repeat(16);
const USER = { id: 'u-key', userId: 'u-key', email: 'bot-owner@agnt.test' };

const issuerConfirms = () => ({ ok: true, status: 200, json: async () => ({ isAuthenticated: true, user: USER }) });
const issuerRefuses = () => ({ ok: false, status: 200, json: async () => ({ isAuthenticated: false, user: null }) });

const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
};
const run = async (mw, token) => {
  const req = { headers: { authorization: `Bearer ${token}` }, session: {} };
  const res = makeRes();
  const next = vi.fn();
  await mw(req, res, next);
  return { req, res, next };
};

const saved = {};
beforeEach(() => {
  for (const k of ['JWT_SECRET', 'AGNT_AUTH_MODE', 'TRUST_REMOTE_AUTH', 'AGNT_TENANT_SLUG']) saved[k] = process.env[k];
  process.env.JWT_SECRET = SECRET;
  process.env.TRUST_REMOTE_AUTH = 'false';
  delete process.env.AGNT_AUTH_MODE; // a desktop install
  delete process.env.AGNT_TENANT_SLUG;
  __resetVerifierForTests();
  __resetSessionTokenCacheForTests();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  vi.restoreAllMocks();
});

describe('isApiKey', () => {
  it('recognises only the exact agnt_sk_ shape', () => {
    expect(isApiKey(KEY)).toBe(true);
    for (const bad of ['agnt_sk_short', 'agnt_sk_' + 'Z'.repeat(64), KEY + '0', jwt.sign({ id: 'x' }, SECRET), '', null]) {
      expect(isApiKey(bad)).toBe(false);
    }
  });
});

describe('a key authenticates on a desktop install', () => {
  it('Middleware admits it through the issuer, sending the key as the bearer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());
    const { req, res, next } = await run(authenticateToken, KEY);
    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ isAuthenticated: true, id: 'u-key' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/users\/auth\/status$/);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('requireAuth admits it through the issuer too', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());
    const { req, res, next } = await run(requireAuth(), KEY);
    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('u-key');
  });

  it('a key the issuer does not recognise is a 401 at both entry points', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerRefuses());
    const soft = await run(authenticateToken, KEY);
    expect(soft.res.statusCode).toBe(401);
    expect(soft.next).not.toHaveBeenCalled();
    __resetVerifierForTests();
    const hard = await run(requireAuth(), KEY);
    expect(hard.res.statusCode).toBe(401);
  });

  it('ANTI-VACUITY: a token that is not a key still never reaches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());
    for (const token of ['agnt_sk_short', jwt.sign({ id: 'u1' }, 'foreign-secret'), jwt.sign({ id: 'u1' }, SECRET, { expiresIn: -60 })]) {
      const { res } = await run(authenticateToken, token);
      expect(res.statusCode).toBe(401);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the background credential slot', () => {
  const liveToken = () => jwt.sign({ id: 'u-key' }, SECRET, { expiresIn: '30d' });

  it('a key fills an empty slot, so a headless install still has a credential', () => {
    rememberSessionToken(KEY, 'u-key');
    expect(getSessionToken()).toBe(KEY);
  });

  it('a key never displaces a live sign-in token', () => {
    const token = liveToken();
    rememberSessionToken(token, 'u-key');
    rememberSessionToken(KEY, 'u-key');
    expect(getSessionToken()).toBe(token);
  });

  it('a sign-in token takes the slot back from a key', () => {
    rememberSessionToken(KEY, 'u-key');
    const token = liveToken();
    rememberSessionToken(token, 'u-key');
    expect(getSessionToken()).toBe(token);
  });

  it('alternating callers do not churn the slot', () => {
    const token = liveToken();
    for (let i = 0; i < 5; i++) {
      rememberSessionToken(token, 'u-key');
      rememberSessionToken(KEY, 'u-key');
    }
    expect(getSessionToken()).toBe(token);
  });

  it('a new key replaces the old key', () => {
    const rotated = 'agnt_sk_' + 'cd34'.repeat(16);
    rememberSessionToken(KEY, 'u-key');
    rememberSessionToken(rotated, 'u-key');
    expect(getSessionToken()).toBe(rotated);
  });
});
