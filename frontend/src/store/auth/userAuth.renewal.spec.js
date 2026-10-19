/**
 * The window keeps the session the backend renewed — the same account's, and
 * only a longer-lived one.
 *
 * The backend renews the session before day 30 and offers the new token on a
 * response header. ADOPT_RENEWED_TOKEN is what the window does with it. It is
 * the same session continuing, so it must not reset the session state the way
 * SET_TOKEN (a new sign-in) does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

const { default: userAuth, SESSION } = await import('./userAuth.js');
const { expiryMsFromJwt } = await import('./jwt.js');

const DAY_S = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
const jwtFor = (id, expiresInDays) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id, userId: id, exp: nowS() + expiresInDays * DAY_S })}.sig-${id}-${expiresInDays}`;
};

function stateWith(token) {
  return { token, sessionState: SESSION.VALID, sessionGeneration: 7 };
}

const adopt = (state, token) => userAuth.mutations.ADOPT_RENEWED_TOKEN(state, token);

beforeEach(() => localStorage.clear());

describe('ADOPT_RENEWED_TOKEN', () => {
  it('takes a longer-lived token for the same account, and persists it for the next launch', () => {
    const old = jwtFor('user-1', 5);
    const renewed = jwtFor('user-1', 30);
    const state = stateWith(old);
    adopt(state, renewed);
    expect(state.token).toBe(renewed);
    expect(localStorage.getItem('token')).toBe(renewed);
  });

  it('is the same session continuing: state and generation are untouched', () => {
    const state = stateWith(jwtFor('user-1', 5));
    adopt(state, jwtFor('user-1', 30));
    expect(state.sessionState).toBe(SESSION.VALID);
    expect(state.sessionGeneration).toBe(7);
  });

  it('NEVER switches the window to another account', () => {
    const old = jwtFor('user-1', 5);
    const state = stateWith(old);
    adopt(state, jwtFor('user-2', 30));
    expect(state.token).toBe(old);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('never moves to a shorter-lived token', () => {
    const current = jwtFor('user-1', 30);
    const state = stateWith(current);
    adopt(state, jwtFor('user-1', 5));
    expect(state.token).toBe(current);
  });

  it('never signs a signed-out window in', () => {
    const state = stateWith(null);
    adopt(state, jwtFor('user-1', 30));
    expect(state.token).toBeNull();
  });

  it('ignores garbage', () => {
    const current = jwtFor('user-1', 5);
    const state = stateWith(current);
    for (const junk of [undefined, null, '', 'not-a-jwt', 42]) adopt(state, junk);
    expect(state.token).toBe(current);
  });
});

describe('expiryMsFromJwt', () => {
  it('reads exp in ms, and null for anything without one', () => {
    const token = jwtFor('user-1', 1);
    expect(expiryMsFromJwt(token)).toBe((nowS() + DAY_S) * 1000);
    expect(expiryMsFromJwt('a.b.c')).toBeNull();
    expect(expiryMsFromJwt(null)).toBeNull();
  });
});
