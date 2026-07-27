import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setMediaCookie,
  clearMediaCookie,
  syncMediaCookieFromStorage,
  MEDIA_COOKIE_NAME,
  MEDIA_COOKIE_PATH,
} from './mediaAuth.js';

/**
 * jsdom's document.cookie does not honour `path`, so a real round-trip cannot
 * be asserted here. What matters — and what a regression would actually break —
 * is the exact attribute string we hand the browser: a wrong path or a stray
 * `Secure` on http://localhost means the cookie is silently never sent and
 * every rendered image 401s. So we capture the writes.
 */
let writes = [];
let cookieSpy;

beforeEach(() => {
  writes = [];
  cookieSpy = vi.spyOn(document, 'cookie', 'set').mockImplementation((v) => writes.push(v));
  localStorage.clear();
});
afterEach(() => {
  cookieSpy.mockRestore();
  vi.unstubAllGlobals();
});

const jwt = (payload) => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
};

describe('setMediaCookie', () => {
  it('writes the token scoped to the local-file path only', () => {
    setMediaCookie('abc123');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(`${MEDIA_COOKIE_NAME}=abc123`);
    expect(writes[0]).toContain(`path=${MEDIA_COOKIE_PATH}`);
    expect(writes[0]).toContain('SameSite=Strict');
  });

  it('does NOT set Secure on http, which would stop the cookie being stored at all', () => {
    expect(writes).toHaveLength(0);
    setMediaCookie('abc123');
    expect(writes[0]).not.toContain('Secure');
  });

  it('sets Secure on https', () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    setMediaCookie('abc123');
    expect(writes[0]).toContain('Secure');
  });

  it('derives max-age from the token expiry', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    setMediaCookie(jwt({ id: 'u', exp }));
    const maxAge = Number(/max-age=(\d+)/.exec(writes[0])[1]);
    expect(maxAge).toBeGreaterThan(3500);
    expect(maxAge).toBeLessThanOrEqual(3600);
  });

  it('falls back to a default lifetime when the token has no exp', () => {
    setMediaCookie(jwt({ id: 'u' }));
    expect(Number(/max-age=(\d+)/.exec(writes[0])[1])).toBe(7 * 24 * 60 * 60);
  });

  it('falls back to a default lifetime for an unparseable token', () => {
    setMediaCookie('not-a-jwt');
    expect(Number(/max-age=(\d+)/.exec(writes[0])[1])).toBe(7 * 24 * 60 * 60);
  });

  it('clears rather than writes an already-expired token', () => {
    setMediaCookie(jwt({ id: 'u', exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(writes[0]).toContain('max-age=0');
  });

  it.each([null, undefined, '', 'null', 'undefined'])('clears for the junk value %s', (v) => {
    expect(setMediaCookie(v)).toBe(false);
    expect(writes[0]).toContain('max-age=0');
  });

  it('url-encodes the value so a token can never break the cookie grammar', () => {
    setMediaCookie('a;b c');
    expect(writes[0]).toContain('a%3Bb%20c');
    expect(writes[0].split(';')[0]).not.toContain(' ');
  });
});

describe('clearMediaCookie', () => {
  it('expires the cookie on the exact same path (a mismatched path leaves it alive)', () => {
    clearMediaCookie();
    expect(writes[0]).toContain(`${MEDIA_COOKIE_NAME}=;`);
    expect(writes[0]).toContain(`path=${MEDIA_COOKIE_PATH}`);
    expect(writes[0]).toContain('max-age=0');
  });
});

describe('syncMediaCookieFromStorage', () => {
  it('writes the cookie when a token is already in localStorage', () => {
    localStorage.setItem('token', 'stored-token');
    expect(syncMediaCookieFromStorage()).toBe(true);
    expect(writes[0]).toContain('stored-token');
  });

  it('clears when no token is stored', () => {
    expect(syncMediaCookieFromStorage()).toBe(false);
    expect(writes[0]).toContain('max-age=0');
  });

  it('never throws when localStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => syncMediaCookieFromStorage()).not.toThrow();
    expect(syncMediaCookieFromStorage()).toBe(false);
    spy.mockRestore();
  });
});
