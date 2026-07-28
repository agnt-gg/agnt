import { describe, it, expect } from 'vitest';

// userAuth.js pulls tt.config → user.config which reads localStorage at import.
function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(String(k), String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
    },
    configurable: true,
  });
}
ensureLocalStorage();

const { userFromJwt } = await import('./userAuth.js');

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('userFromJwt', () => {
  it('returns null for empty/garbage tokens', () => {
    expect(userFromJwt(null)).toBeNull();
    expect(userFromJwt('')).toBeNull();
    expect(userFromJwt('not-a-jwt')).toBeNull();
  });

  it('decodes id and email from payload', () => {
    const token = makeJwt({ id: 'u-1', email: 'a@b.c', name: 'Ada' });
    expect(userFromJwt(token)).toEqual({
      id: 'u-1',
      email: 'a@b.c',
      name: 'Ada',
      authMethod: 'jwt',
    });
  });

  it('falls back to sub and email local-part for name', () => {
    const token = makeJwt({ sub: 'sub-9', email: 'bob@example.com' });
    expect(userFromJwt(token)).toMatchObject({
      id: 'sub-9',
      email: 'bob@example.com',
      name: 'bob',
    });
  });

  it('returns null when payload has neither id nor email', () => {
    const token = makeJwt({ role: 'none' });
    expect(userFromJwt(token)).toBeNull();
  });

  it('decodes unpadded base64url payloads (Safari/iOS atob)', () => {
    // base64url omits "="; Safari atob requires length % 4 === 0 (padded).
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ id: 'u', email: 'a@b.c', name: 'Ada!' }),
    ).toString('base64url');
    expect(body.includes('=')).toBe(false);
    expect(body.length % 4).not.toBe(0);
    expect(userFromJwt(`${header}.${body}.sig`)).toEqual({
      id: 'u',
      email: 'a@b.c',
      name: 'Ada!',
      authMethod: 'jwt',
    });
  });
});
