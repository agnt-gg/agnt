/**
 * The token exchange.
 *
 * The load-bearing test in this file is the last one: a minted token must be
 * accepted by ALL THREE verification sites. That is the entire premise of the
 * design — if it held for only one of them, a hosted tenant would sign in
 * successfully and then have dead sockets and broken media, which is worse than
 * an honest refusal because it looks like it worked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

import { isExchangeEnabled, mintLocalToken } from './localTokenIssuer.js';

const OWN_SECRET = 'this-installs-own-private-secret';
const CLOUD_SECRET = 'the-published-cloud-secret';
const USER = 'user-abc';

const prev = {};

beforeEach(() => {
  prev.mode = process.env.AGNT_AUTH_MODE;
  prev.secret = process.env.JWT_SECRET;
  prev.trust = process.env.TRUST_REMOTE_AUTH;
  process.env.AGNT_AUTH_MODE = 'verify-remote';
  process.env.JWT_SECRET = OWN_SECRET;
  delete process.env.TRUST_REMOTE_AUTH;
});

afterEach(() => {
  for (const [k, v] of [['AGNT_AUTH_MODE', prev.mode], ['JWT_SECRET', prev.secret], ['TRUST_REMOTE_AUTH', prev.trust]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

/** A token as api.agnt.gg would issue it — signed with a key we do NOT hold. */
const cloudToken = (overrides = {}) =>
  jwt.sign({ id: USER, email: 'n@a.gg', ...overrides }, CLOUD_SECRET, { expiresIn: '30d' });

describe('the gate — desktop must never mint', () => {
  it('is disabled unless the install opted into issuer delegation', () => {
    delete process.env.AGNT_AUTH_MODE;
    expect(isExchangeEnabled()).toBe(false);
    // Minting on a desktop would be a new, unnecessary credential path on an
    // install that can already verify the real one.
    expect(mintLocalToken({ userId: USER })).toBeNull();
  });

  it('is disabled without a secret to sign with', () => {
    delete process.env.JWT_SECRET;
    expect(isExchangeEnabled()).toBe(false);
    expect(mintLocalToken({ userId: USER })).toBeNull();
  });

  it('refuses to mint without an identity', () => {
    // The caller passes the id the ISSUER confirmed. No id means nothing was
    // confirmed, and a token for `undefined` is a token for anyone.
    expect(mintLocalToken({ userId: null })).toBeNull();
    expect(mintLocalToken({})).toBeNull();
  });
});

describe('minting', () => {
  it('signs with THIS install\u2019s secret, not the cloud\u2019s', () => {
    const { token } = mintLocalToken({ userId: USER, email: 'n@a.gg' });

    expect(() => jwt.verify(token, OWN_SECRET)).not.toThrow();
    // The whole point: the published key is not on this box and must not be
    // able to produce or validate a session here.
    expect(() => jwt.verify(token, CLOUD_SECRET)).toThrow();
  });

  it('carries the identity in every spelling the readers accept', () => {
    const { token } = mintLocalToken({ userId: USER, email: 'n@a.gg' });
    const claims = jwt.verify(token, OWN_SECRET);

    // extractUserId in Middleware.js and socketIdentity.js disagree about
    // which field they prefer, so both are present.
    expect(claims.id).toBe(USER);
    expect(claims.userId).toBe(USER);
    expect(claims.email).toBe('n@a.gg');
    expect(claims.auth_type).toBe('exchanged');
  });

  it('NEVER outlives the credential it was derived from', () => {
    const now = Math.floor(Date.now() / 1000);
    // A cloud token with an hour left must not yield a seven-day local one:
    // that would silently upgrade a credential's lifetime, which an exchange is
    // not allowed to do.
    const shortLived = jwt.sign({ id: USER, exp: now + 3600 }, CLOUD_SECRET);

    const { expiresAt } = mintLocalToken({ userId: USER, cloudToken: shortLived });

    expect(Math.floor(expiresAt / 1000)).toBe(now + 3600);
  });

  it('caps its own life even when the cloud token runs for a year', () => {
    const now = Math.floor(Date.now() / 1000);
    const longLived = jwt.sign({ id: USER, exp: now + 365 * 86400 }, CLOUD_SECRET);

    const { expiresAt } = mintLocalToken({ userId: USER, cloudToken: longLived });
    const days = (expiresAt / 1000 - now) / 86400;

    expect(days).toBeCloseTo(7, 1);
  });

  it('refuses to mint from an already-expired cloud token', () => {
    const expired = jwt.sign({ id: USER }, CLOUD_SECRET, { expiresIn: -60 });
    // Minting here would hand back a token every route rejects, which reads to
    // the user as a successful login followed by instant logout.
    expect(mintLocalToken({ userId: USER, cloudToken: expired })).toBeNull();
  });

  it('still mints when the cloud token cannot be decoded', () => {
    // It already satisfied the issuer, so an unparseable local read is not
    // grounds to refuse — fall back to the ceiling.
    const result = mintLocalToken({ userId: USER, cloudToken: 'not-a-jwt' });
    expect(result?.token).toBeTruthy();
  });
});

describe('THE PREMISE: one minted token satisfies all three verification sites', () => {
  it('is accepted by Middleware, authGuard and socketIdentity alike', async () => {
    const { token } = mintLocalToken({ userId: USER, email: 'n@a.gg', cloudToken: cloudToken() });

    // ── 1. utils/authGuard.js — media, files, images, pairing, SSE (SYNC) ──
    const { verifyAuthToken } = await import('../../utils/authGuard.js');
    const guard = verifyAuthToken(token);
    expect(guard.ok, 'authGuard rejected it — media and file URLs would 401').toBe(true);
    expect(guard.user.id).toBe(USER);

    // ── 2. utils/socketIdentity.js — the websocket handshake (SYNC) ────────
    const { resolveSocketIdentity } = await import('../../utils/socketIdentity.js');
    const socket = resolveSocketIdentity(
      { token },
      // The strictest realistic setting: a tenant runs NODE_ENV=production,
      // which turns on strict socket auth.
      { JWT_SECRET: OWN_SECRET, NODE_ENV: 'production' }
    );
    // `{ ok, reason }` — NOT `{ error }`. The internal verifyToken returns
    // `{ error }` and the exported function maps it; asserting the inner shape
    // here passes vacuously against a rejection, which is what the first draft
    // of this test did.
    expect(socket.ok, `socket rejected it (${socket.reason}) — no streaming chat or tool events`).toBe(true);
    expect(socket.userId).toBe(USER);
    expect(socket.verified).toBe(true);

    // ── 3. routes/Middleware.js — every REST route (async) ─────────────────
    const { authenticateToken } = await import('../../routes/Middleware.js');
    const req = { headers: { authorization: `Bearer ${token}` }, session: {} };
    const res = {
      statusCode: null,
      status(c) { this.statusCode = c; return this; },
      json() { return this; },
    };
    const next = vi.fn();
    await authenticateToken(req, res, next);

    expect(next, 'Middleware rejected it — every REST route would 401').toHaveBeenCalled();
    expect(req.user).toMatchObject({ isAuthenticated: true, id: USER });
  });

  it('ANTI-VACUITY: the cloud token these replace fails all three', async () => {
    // Without this, the test above would pass even if the exchange were doing
    // nothing, because a working cloud token would satisfy the same assertions.
    // This is the failure the exchange exists to prevent.
    const cloud = cloudToken();

    const { verifyAuthToken } = await import('../../utils/authGuard.js');
    expect(verifyAuthToken(cloud).ok).toBe(false);

    const { resolveSocketIdentity } = await import('../../utils/socketIdentity.js');
    const socket = resolveSocketIdentity({ token: cloud }, { JWT_SECRET: OWN_SECRET, NODE_ENV: 'production' });
    expect(socket.ok).toBe(false);
    expect(socket.reason).toBe('invalid_token');
  });
});
