/**
 * The window learns of a background renewal — and only its own.
 *
 * After sessionRenewal replaces the held token, the window still holds the one
 * it signed in with, which dies on day 30. The auth middleware offers the
 * window the renewed token on its next response. It must never offer one
 * account's token to another account's window.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rememberSessionToken, __resetSessionTokenCacheForTests } from './sessionTokenCache.js';
import { offerRenewedToken, RENEWED_TOKEN_HEADER } from './renewedTokenHeader.js';

const jwtFor = (id, expIso) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id, exp: Math.floor(Date.parse(expIso) / 1000) })}.sig-${id}-${expIso}`;
};

/** Records headers the way an Express response would expose them. */
const fakeRes = () => {
  const headers = {};
  return {
    headers,
    setHeader(name, value) { headers[name] = value; },
    append(name, value) { headers[name] = headers[name] ? `${headers[name]}, ${value}` : value; },
  };
};

const OLD = jwtFor('user-1', '2026-11-07T23:17:40Z');
const RENEWED = jwtFor('user-1', '2026-12-01T12:00:00Z');

beforeEach(() => __resetSessionTokenCacheForTests());

describe('offering the renewed token', () => {
  it('a window presenting the old token is offered the renewed one', () => {
    rememberSessionToken(RENEWED, 'user-1');
    const res = fakeRes();
    offerRenewedToken(res, OLD, 'user-1');
    expect(res.headers[RENEWED_TOKEN_HEADER]).toBe(RENEWED);
    expect(res.headers['Access-Control-Expose-Headers']).toBe(RENEWED_TOKEN_HEADER);
  });

  it('an up-to-date window gets no header at all', () => {
    rememberSessionToken(RENEWED, 'user-1');
    const res = fakeRes();
    offerRenewedToken(res, RENEWED, 'user-1');
    expect(res.headers).toEqual({});
  });

  it('never offers a SHORTER-lived token as an "upgrade"', () => {
    rememberSessionToken(OLD, 'user-1');
    const res = fakeRes();
    offerRenewedToken(res, RENEWED, 'user-1');
    expect(res.headers).toEqual({});
  });

  it('NEVER offers one account\'s token to another account\'s window', () => {
    rememberSessionToken(RENEWED, 'user-1');
    const res = fakeRes();
    offerRenewedToken(res, jwtFor('user-2', '2026-11-02T00:00:00Z'), 'user-2');
    expect(res.headers).toEqual({});
  });

  it('tolerates a response object that cannot carry headers', () => {
    rememberSessionToken(RENEWED, 'user-1');
    expect(() => offerRenewedToken({}, OLD, 'user-1')).not.toThrow();
    expect(() => offerRenewedToken(undefined, OLD, 'user-1')).not.toThrow();
  });

  it('pins the header name the frontend reads (lower-cased by axios)', () => {
    expect(RENEWED_TOKEN_HEADER).toBe('X-AGNT-Session-Token');
    expect(RENEWED_TOKEN_HEADER.toLowerCase()).toBe('x-agnt-session-token');
  });
});
