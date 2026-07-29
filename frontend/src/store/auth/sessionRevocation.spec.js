/**
 * CONTRACT: a definitive server rejection never yields a signed-in user, and
 * never erases its own diagnostic.
 *
 * WHY THIS EXISTS
 * ---------------
 * PR #54 needed a paired phone to survive a page load when the remote auth
 * server was unreachable, and added a JWT-decoded local user as a fallback.
 * Reasonable. But it wired that fallback into BOTH exits of fetchUserData,
 * including the branch where the server answered and the answer was "no", and
 * the fallback also committed CLEAR_AUTH_FAILURE.
 *
 * Two things went wrong at once, and the second is the dangerous one:
 *
 *   1. 'unauthenticated_response' is listed in DEFINITIVE_AUTH_REJECTIONS, so
 *      the change routed a documented-definitive rejection down the transient
 *      path -- violating an invariant stated in the same file, four functions
 *      above the edit.
 *   2. Clearing the failure record destroyed the ONLY explanation for the
 *      degraded session. The user saw a signed-in UI in which every API call
 *      401s, with nothing in the store to say why. Silent wrongness, where the
 *      previous behaviour was a clean bounce.
 *
 * WHY IT IS WRITTEN THIS WAY
 * --------------------------
 * These assertions are phrased against the INVARIANT ("a definitive rejection
 * does not produce a session"), not against the bug ("expired tokens are
 * rejected"). A test written from the bug rots the moment the token format
 * changes and then passes while checking nothing. A test written from the
 * invariant survives that change.
 *
 * The expiry check is included because it was verified against a REAL token,
 * not assumed: AGNT session tokens carry `exp` (payload: id, userId, email,
 * auth_type, iat, exp -- 30-day lifetime). Without that evidence the check
 * would have been a guard for a field production never sends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios');
vi.mock('@/services/LicenseValidator.js', () => ({ default: { validate: vi.fn() } }));
vi.mock('@/services/mediaAuth.js', () => ({
  setMediaCookie: vi.fn(),
  clearMediaCookie: vi.fn(),
}));

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

const axios = (await import('axios')).default;
const userAuthModule = await import('./userAuth.js');
const { userFromJwt, isDefinitiveAuthRejection } = userAuthModule;
const userAuth = userAuthModule.default;

/** A structurally valid token. `exp` defaults to well in the future. */
function makeJwt(payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      id: 'u-1',
      userId: 'u-1',
      email: 'nathan@example.com',
      auth_type: 'magic_link',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 86400,
      ...payload,
    })
  ).toString('base64url');
  return `${header}.${body}.signature`;
}

/** Drive the real fetchUserData action with a recording commit. */
async function runFetchUserData({ token = makeJwt(), respond }) {
  const commits = [];
  const state = { token, user: null, lastAuthFailure: null, userEmail: null };
  const commit = vi.fn((type, payload) => {
    commits.push({ type, payload });
    if (type === 'SET_USER') state.user = payload;
    if (type === 'SET_AUTH_FAILURE') state.lastAuthFailure = payload;
    if (type === 'CLEAR_AUTH_FAILURE') state.lastAuthFailure = null;
  });
  const dispatch = vi.fn().mockResolvedValue(undefined);

  respond();
  // forceRefresh bypasses the withFreshness TTL so each case runs for real.
  await userAuth.actions.fetchUserData({ commit, state, dispatch }, { forceRefresh: true });

  return {
    commits,
    state,
    committed: (type) => commits.some((c) => c.type === type),
    payloadOf: (type) => commits.find((c) => c.type === type)?.payload,
  };
}

describe('session revocation semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('premise: unauthenticated_response is a DEFINITIVE rejection', () => {
    // If this ever flips, the assertions below are testing the wrong thing --
    // fail loudly here rather than silently asserting a stale rule.
    expect(isDefinitiveAuthRejection('unauthenticated_response')).toBe(true);
    expect(isDefinitiveAuthRejection('http_401')).toBe(true);
    expect(isDefinitiveAuthRejection('network_error')).toBe(false);
    expect(isDefinitiveAuthRejection('timeout')).toBe(false);
    expect(isDefinitiveAuthRejection('http_5xx')).toBe(false);
  });

  describe('the server answered "no" (definitive)', () => {
    it('does NOT produce a signed-in user, even with a perfectly valid local token', async () => {
      const r = await runFetchUserData({
        respond: () => axios.get.mockResolvedValue({ status: 200, data: { isAuthenticated: false } }),
      });
      expect(r.state.user).toBeNull();
    });

    it('records WHY, and never clears the record', async () => {
      const r = await runFetchUserData({
        respond: () => axios.get.mockResolvedValue({ status: 200, data: { isAuthenticated: false } }),
      });
      expect(r.payloadOf('SET_AUTH_FAILURE')).toMatchObject({ reason: 'unauthenticated_response' });
      expect(r.committed('CLEAR_AUTH_FAILURE')).toBe(false);
      expect(r.state.lastAuthFailure).not.toBeNull();
    });

    it('a 401 produces no user and keeps its diagnostic', async () => {
      const r = await runFetchUserData({
        respond: () =>
          axios.get.mockRejectedValue({ response: { status: 401, data: { error: 'bad token' } } }),
      });
      expect(r.state.user).toBeNull();
      expect(r.payloadOf('SET_AUTH_FAILURE')).toMatchObject({ reason: 'http_401' });
      expect(r.committed('CLEAR_AUTH_FAILURE')).toBe(false);
    });

    it('a 403 produces no user and keeps its diagnostic', async () => {
      const r = await runFetchUserData({
        respond: () => axios.get.mockRejectedValue({ response: { status: 403, data: {} } }),
      });
      expect(r.state.user).toBeNull();
      expect(r.payloadOf('SET_AUTH_FAILURE')).toMatchObject({ reason: 'http_403' });
    });
  });

  describe('the server could not be reached (transient)', () => {
    it('DOES restore a local user, so a paired phone survives a page load', async () => {
      const r = await runFetchUserData({
        respond: () => axios.get.mockRejectedValue({ message: 'Network Error' }),
      });
      expect(r.state.user).toMatchObject({ id: 'u-1', authMethod: 'jwt' });
    });

    it('still records the failure -- surviving is not the same as being fine', async () => {
      const r = await runFetchUserData({
        respond: () => axios.get.mockRejectedValue({ message: 'Network Error' }),
      });
      expect(r.payloadOf('SET_AUTH_FAILURE')).toMatchObject({ reason: 'network_error' });
      expect(r.committed('CLEAR_AUTH_FAILURE')).toBe(false);
      expect(r.state.lastAuthFailure).not.toBeNull();
    });

    it('a 5xx is transient too', async () => {
      const r = await runFetchUserData({
        respond: () => axios.get.mockRejectedValue({ response: { status: 503, data: {} } }),
      });
      expect(r.state.user).toMatchObject({ authMethod: 'jwt' });
      expect(r.payloadOf('SET_AUTH_FAILURE')).toMatchObject({ reason: 'http_5xx' });
    });

    it('an EXPIRED token yields no user even on a transient failure', async () => {
      const r = await runFetchUserData({
        token: makeJwt({ exp: Math.floor(Date.now() / 1000) - 3600 }),
        respond: () => axios.get.mockRejectedValue({ message: 'Network Error' }),
      });
      expect(r.state.user).toBeNull();
    });
  });

  describe('the happy path still works', () => {
    it('a recognized session sets the server user and clears the failure', async () => {
      const r = await runFetchUserData({
        respond: () =>
          axios.get.mockResolvedValue({
            status: 200,
            data: { isAuthenticated: true, user: { id: 'u-1', email: 'nathan@example.com' } },
          }),
      });
      expect(r.state.user).toMatchObject({ id: 'u-1' });
      // Clearing IS correct here: the server said yes, so there is no failure.
      expect(r.committed('CLEAR_AUTH_FAILURE')).toBe(true);
    });
  });

  describe('userFromJwt expiry (verified against a real token shape)', () => {
    it('rejects a token past its exp', () => {
      expect(userFromJwt(makeJwt({ exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
    });

    it('accepts a token still within its exp', () => {
      expect(userFromJwt(makeJwt({ exp: Math.floor(Date.now() / 1000) + 60 }))).toMatchObject({
        id: 'u-1',
      });
    });

    it('accepts a token with no exp at all (older shape, still decodable)', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ id: 'u-9', email: 'a@b.c' })).toString('base64url');
      expect(userFromJwt(`${header}.${body}.sig`)).toMatchObject({ id: 'u-9' });
    });

    it('ignores a non-numeric exp rather than throwing', () => {
      expect(userFromJwt(makeJwt({ exp: 'not-a-number' }))).toMatchObject({ id: 'u-1' });
    });
  });
});
