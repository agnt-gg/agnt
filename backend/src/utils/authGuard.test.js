import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { parseCookies, extractToken, verifyAuthToken, requireAuth, MEDIA_COOKIE_NAME } from './authGuard.js';

const SECRET = 'test-secret-for-authguard';
const USER = { id: 'user-abc', email: 'a@b.c' };

function req({ headers = {}, query = {}, session } = {}) {
  return { headers, query, session };
}
function res() {
  const r = { statusCode: null, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

let prevSecret, prevTrust;
beforeEach(() => {
  prevSecret = process.env.JWT_SECRET;
  prevTrust = process.env.TRUST_REMOTE_AUTH;
  process.env.JWT_SECRET = SECRET;
  delete process.env.TRUST_REMOTE_AUTH;
});
afterEach(() => {
  process.env.JWT_SECRET = prevSecret;
  if (prevTrust === undefined) delete process.env.TRUST_REMOTE_AUTH;
  else process.env.TRUST_REMOTE_AUTH = prevTrust;
});

const sign = (payload = USER, opts = { expiresIn: '1h' }) => jwt.sign(payload, SECRET, opts);

describe('parseCookies', () => {
  it('parses a normal cookie header', () => {
    expect(parseCookies('a=1; b=two')).toEqual({ a: '1', b: 'two' });
  });
  it('returns {} for missing/garbage input', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('novalue')).toEqual({});
  });
  it('url-decodes values and strips quoted-string wrapping', () => {
    expect(parseCookies('t=a%20b')).toEqual({ t: 'a b' });
    expect(parseCookies('t="quoted"')).toEqual({ t: 'quoted' });
  });
  it('does not choke on = inside the value (JWTs are base64url, but be safe)', () => {
    expect(parseCookies('t=aa.bb==')).toEqual({ t: 'aa.bb==' });
  });
});

describe('extractToken', () => {
  it('reads a Bearer header case-insensitively', () => {
    expect(extractToken(req({ headers: { authorization: 'Bearer xyz' } }))).toBe('xyz');
    expect(extractToken(req({ headers: { authorization: 'bearer xyz' } }))).toBe('xyz');
  });
  it('rejects the literal strings null/undefined that clients send', () => {
    expect(extractToken(req({ headers: { authorization: 'Bearer null' } }))).toBeNull();
    expect(extractToken(req({ headers: { authorization: 'Bearer undefined' } }))).toBeNull();
  });
  it('ignores query and cookie carriers unless explicitly allowed', () => {
    const r = req({ query: { token: 'q' }, headers: { cookie: `${MEDIA_COOKIE_NAME}=c` } });
    expect(extractToken(r)).toBeNull();
    expect(extractToken(r, { allowQuery: true })).toBe('q');
    expect(extractToken(r, { allowCookie: true })).toBe('c');
  });
  it('prefers header over query over cookie', () => {
    const r = req({
      headers: { authorization: 'Bearer h', cookie: `${MEDIA_COOKIE_NAME}=c` },
      query: { token: 'q' },
    });
    expect(extractToken(r, { allowQuery: true, allowCookie: true })).toBe('h');
  });
});

describe('verifyAuthToken', () => {
  it('accepts a valid token and normalises the subject', () => {
    const out = verifyAuthToken(sign());
    expect(out.ok).toBe(true);
    expect(out.user).toMatchObject({ isAuthenticated: true, id: 'user-abc', userId: 'user-abc' });
  });
  it.each([['sub'], ['userId'], ['user_id']])('accepts %s as the subject claim', (claim) => {
    const out = verifyAuthToken(jwt.sign({ [claim]: 'zz' }, SECRET));
    expect(out.ok).toBe(true);
    expect(out.user.id).toBe('zz');
  });
  it('rejects a token signed with the wrong secret', () => {
    expect(verifyAuthToken(jwt.sign(USER, 'other')).ok).toBe(false);
  });
  it('rejects an expired token and says so', () => {
    const out = verifyAuthToken(jwt.sign(USER, SECRET, { expiresIn: -10 }));
    expect(out).toMatchObject({ ok: false, reason: 'expired' });
  });
  it('rejects a token with no subject claim', () => {
    expect(verifyAuthToken(jwt.sign({ hello: 1 }, SECRET))).toMatchObject({ ok: false, reason: 'no-subject' });
  });
  it('rejects missing/garbage input', () => {
    expect(verifyAuthToken(null)).toMatchObject({ ok: false, reason: 'missing' });
    expect(verifyAuthToken('not-a-jwt')).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('under TRUST_REMOTE_AUTH accepts an unverifiable but well-formed remote token', () => {
    process.env.TRUST_REMOTE_AUTH = 'true';
    const out = verifyAuthToken(jwt.sign(USER, 'a-secret-this-server-does-not-have'));
    expect(out.ok).toBe(true);
    expect(out.user.auth_type).toBe('remote');
  });
  it('under TRUST_REMOTE_AUTH still rejects total garbage', () => {
    process.env.TRUST_REMOTE_AUTH = 'true';
    expect(verifyAuthToken('garbage').ok).toBe(false);
  });
});

describe('requireAuth', () => {
  it('401s with no token and does NOT call next', () => {
    const next = vi.fn();
    const r = res();
    requireAuth()(req(), r, next);
    expect(r.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on an invalid token — the defect authenticateToken has', () => {
    const next = vi.fn();
    const r = res();
    requireAuth()(req({ headers: { authorization: 'Bearer bad' } }), r, next);
    expect(r.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and populates req.user on a valid token', () => {
    const next = vi.fn();
    const rq = req({ headers: { authorization: `Bearer ${sign()}` } });
    requireAuth()(rq, res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(rq.user).toMatchObject({ isAuthenticated: true, id: 'user-abc' });
  });

  it('accepts the media cookie only when configured to', () => {
    const headers = { cookie: `${MEDIA_COOKIE_NAME}=${sign()}` };
    const strict = res();
    requireAuth()(req({ headers }), strict, vi.fn());
    expect(strict.statusCode).toBe(401);

    const next = vi.fn();
    requireAuth({ allowCookie: true })(req({ headers }), res(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('mirrors the session side-effect of authenticateToken', () => {
    const session = {};
    const token = sign();
    requireAuth()(req({ headers: { authorization: `Bearer ${token}` }, session }), res(), vi.fn());
    expect(session.userToken).toBe(token);
    expect(session.userData.id).toBe('user-abc');
  });
});
