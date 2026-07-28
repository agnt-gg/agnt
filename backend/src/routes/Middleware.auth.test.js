/**
 * `authenticateToken` must actually authenticate.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 * It used to set `req.user = { isAuthenticated: false }` and call `next()` on a
 * missing OR invalid token. 252 routes used it as a guard; exactly one
 * (ToolsRoutes.js) re-checked the flag. The other 251 ran with
 * `req.user.id === undefined`, and whether that was safe depended entirely on
 * what the handler's query happened to do with `undefined`.
 *
 * Measured against a running backend with NO credentials, from the LAN:
 *   GET    /api/filesystem/raw   -> read any workspace file
 *   POST   /api/filesystem/file  -> write any workspace file
 *   DELETE /api/filesystem/file  -> delete any workspace file
 *   GET    /api/users/settings   -> provider, model, custom instructions
 *   GET    /api/users/security-audit -> the security event log
 *
 * The name promised a guarantee the implementation never made — the same defect
 * class the Tier 0 pass fixed for 21 routes and then stopped.
 *
 * These tests pin the contract at the source, so no future route can inherit
 * the permissive behaviour by accident. Opting into anonymous access is still
 * possible, but it now has a different function name and an allow-list entry in
 * routeSecurity.test.js.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticateToken, authenticateTokenOptional } from './Middleware.js';

const SECRET = 'middleware-auth-test-secret';
let prevSecret;
let prevTrustRemote;

/** Minimal express double: records what the middleware did. */
const makeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

const run = async (middleware, headers = {}) => {
  const req = { headers, session: {} };
  const res = makeRes();
  const next = vi.fn();
  await middleware(req, res, next);
  return { req, res, next };
};

beforeEach(() => {
  prevSecret = process.env.JWT_SECRET;
  prevTrustRemote = process.env.TRUST_REMOTE_AUTH;
  process.env.JWT_SECRET = SECRET;
  process.env.TRUST_REMOTE_AUTH = 'false';
});

afterEach(() => {
  if (prevSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevSecret;
  if (prevTrustRemote === undefined) delete process.env.TRUST_REMOTE_AUTH;
  else process.env.TRUST_REMOTE_AUTH = prevTrustRemote;
});

describe('authenticateToken rejects unauthenticated callers', () => {
  it('401s when no Authorization header is present', async () => {
    const { res, next } = await run(authenticateToken);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ success: false, reason: 'missing' });
  });

  // The frontend sends the literal strings "null"/"undefined" when its token
  // store is empty — a stringified absent value, not a credential.
  it.each(['Bearer null', 'Bearer undefined', 'Bearer '])('401s for a placeholder header (%s)', async (h) => {
    const { res, next } = await run(authenticateToken, { authorization: h });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('401s for a malformed token, and says so distinctly', async () => {
    // "invalid" is a stronger signal than "missing": something is wrong rather
    // than absent, so the client can tell "log in" from "log in again".
    const { res, next } = await run(authenticateToken, { authorization: 'Bearer not-a-jwt' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.reason).toBe('invalid');
  });

  it('401s for a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ id: 'attacker' }, 'a-different-secret');
    const { res, next } = await run(authenticateToken, { authorization: `Bearer ${forged}` });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('401s for an expired token', async () => {
    const stale = jwt.sign({ id: 'u1' }, SECRET, { expiresIn: -60 });
    const { res, next } = await run(authenticateToken, { authorization: `Bearer ${stale}` });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('clears session state when a presented token is invalid', async () => {
    const req = { headers: { authorization: 'Bearer bad' }, session: { userToken: 'x', userData: { id: 'u1' } } };
    const res = makeRes();
    await authenticateToken(req, res, vi.fn());
    expect(req.session.userToken).toBeUndefined();
    expect(req.session.userData).toBeUndefined();
  });
});

describe('authenticateToken still admits legitimate callers', () => {
  // Without these, "reject everything" would satisfy the suite above perfectly
  // while breaking the entire product.
  it('passes a validly signed token through and populates req.user', async () => {
    const token = jwt.sign({ id: 'u1', email: 'a@b.c' }, SECRET, { expiresIn: '1h' });
    const { req, res, next } = await run(authenticateToken, { authorization: `Bearer ${token}` });
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
    expect(req.user).toMatchObject({ isAuthenticated: true, id: 'u1', userId: 'u1', email: 'a@b.c' });
  });

  it('stores the token on the session for downstream backend calls', async () => {
    const token = jwt.sign({ id: 'u1' }, SECRET, { expiresIn: '1h' });
    const { req } = await run(authenticateToken, { authorization: `Bearer ${token}` });
    expect(req.session.userToken).toBe(token);
    expect(req.session.userData.id).toBe('u1');
  });

  it('accepts the alternate id claims a remote issuer may use', async () => {
    // extractUserId supports id | userId | user_id | sub. A token carrying only
    // `sub` is still a real credential and must not be rejected.
    const token = jwt.sign({ sub: 'u9' }, SECRET, { expiresIn: '1h' });
    const { req, next } = await run(authenticateToken, { authorization: `Bearer ${token}` });
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('u9');
  });
});

describe('authenticateTokenOptional is the deliberate opt-in', () => {
  it('lets an anonymous caller through instead of rejecting', async () => {
    const { req, res, next } = await run(authenticateTokenOptional);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
    expect(req.user).toEqual({ isAuthenticated: false });
  });

  it('lets an invalid token through as anonymous', async () => {
    const { req, next } = await run(authenticateTokenOptional, { authorization: 'Bearer nonsense' });
    expect(next).toHaveBeenCalled();
    expect(req.user.isAuthenticated).toBe(false);
  });

  it('still authenticates a valid token', async () => {
    const token = jwt.sign({ id: 'u2' }, SECRET, { expiresIn: '1h' });
    const { req, next } = await run(authenticateTokenOptional, { authorization: `Bearer ${token}` });
    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ isAuthenticated: true, id: 'u2' });
  });

  it('marks the request so the permissive path is explicit, never inferred', async () => {
    const { req } = await run(authenticateTokenOptional);
    expect(req.allowAnonymous).toBe(true);

    // And the strict guard must NOT set it — otherwise a shared req object or a
    // future refactor could silently re-open every route.
    const strict = await run(authenticateToken);
    expect(strict.req.allowAnonymous).toBeUndefined();
  });
});
