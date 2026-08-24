/**
 * A GUARD MUST NOT SAY "YOUR SESSION IS DEAD" WHEN IT MEANS "I DID NOT ASK".
 *
 * ---------------------------------------------------------------------------
 * THE BUG THESE TESTS EXIST FOR
 * ---------------------------------------------------------------------------
 * Hosted tenants logged their users out mid-session, on no fixed schedule, and
 * nothing in the UI explained it. The chain, measured on the live fleet:
 *
 *   1. A tenant runs AGNT_AUTH_MODE=verify-remote and holds NO copy of the
 *      issuer's signing key, so `jwt.verify` on a genuine cloud token always
 *      throws. That failure carries no information about the token.
 *   2. The only local evidence left is the verifier cache. Its positive entries
 *      live 5 minutes (POSITIVE_TTL_MS) and ONLY the async `verifyViaIssuer`
 *      can write one — the synchronous readers cannot refill it.
 *   3. On a miss, `requireAuth` answered 401 `{reason:'invalid'}`.
 *   4. The frontend logs out on exactly one string: 'invalid'.
 *
 * So every ~5 minutes there was a window in which any of the ~40 routes behind
 * this guard would destroy a working session. The six provider status polls
 * fire on one tick, which made hitting the window near-certain. Captured in the
 * proxy log: six 401s carrying a token, then 0.7s later the same six endpoints
 * going out bare — the token had been deleted in between.
 *
 * The asymmetry that proves it is a bug and not a policy: `authenticateToken`
 * AWAITS the issuer and admitted the very same token, in the same millisecond,
 * on the same connection.
 *
 * These tests pin the two halves of the fix — ask when you do not know, and
 * never call silence a denial — and the two properties that must NOT change:
 * a desktop install stays offline and synchronous, and a real refusal from the
 * issuer still ends the session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

import { __resetVerifierForTests, verifyViaIssuer } from '../services/auth/remoteTokenVerifier.js';
import { requireAuth, UNVERIFIED, verifyAuthToken } from './authGuard.js';

const OWN_SECRET = 'this-tenants-own-private-secret';
const CLOUD_SECRET = 'the-published-cloud-secret-a-tenant-does-not-have';
const USER = { id: 'user-abc', userId: 'user-abc', email: 'nathan@bizop.io' };

/** A token as api.agnt.gg issues it — signed with a key this install lacks. */
const cloudToken = () => jwt.sign({ id: USER.id, email: USER.email }, CLOUD_SECRET, { expiresIn: '30d' });

const issuerConfirms = () => ({ ok: true, json: async () => ({ isAuthenticated: true, user: USER }) });
const issuerRefuses = () => ({ ok: false, status: 401, json: async () => ({ isAuthenticated: false }) });
const issuerBroken = () => ({ ok: false, status: 503, json: async () => ({}) });

const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

const res = () => {
  const r = { statusCode: 0, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

/** Run the guard to completion whether it resolved synchronously or not. */
const run = async (token, opts = {}) => {
  const r = res();
  const next = vi.fn();
  await requireAuth(opts)(req(token), r, next);
  return { r, next };
};

const prev = {};

beforeEach(() => {
  __resetVerifierForTests();
  prev.mode = process.env.AGNT_AUTH_MODE;
  prev.secret = process.env.JWT_SECRET;
  prev.trust = process.env.TRUST_REMOTE_AUTH;
  prev.owner = process.env.AGNT_TENANT_OWNER;
  prev.slug = process.env.AGNT_TENANT_SLUG;
  process.env.AGNT_AUTH_MODE = 'verify-remote';
  process.env.JWT_SECRET = OWN_SECRET;
  delete process.env.TRUST_REMOTE_AUTH;
  delete process.env.AGNT_TENANT_OWNER;
  delete process.env.AGNT_TENANT_SLUG;
});

afterEach(() => {
  for (const [k, v] of [
    ['AGNT_AUTH_MODE', prev.mode],
    ['JWT_SECRET', prev.secret],
    ['TRUST_REMOTE_AUTH', prev.trust],
    ['AGNT_TENANT_OWNER', prev.owner],
    ['AGNT_TENANT_SLUG', prev.slug],
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetVerifierForTests();
  vi.restoreAllMocks();
});

describe('the cold-cache window that logged people out', () => {
  it('ADMITS a genuine cloud token when the cache is empty, by asking the issuer', async () => {
    // THE REGRESSION TEST. Before the fix this returned 401 {reason:'invalid'}
    // and the client deleted the session. Nothing about the token changed
    // between the two outcomes — only whether the guard bothered to ask.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());

    const { r, next } = await run(cloudToken());

    expect(next, `refused a valid session with ${r.body?.reason}`).toHaveBeenCalled();
    expect(r.statusCode).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never answers "invalid" for a token it merely has not confirmed', async () => {
    // The narrow claim, independent of what the issuer would say: silence is
    // not evidence. 'invalid' is the client's logout trigger and must be
    // reserved for an authoritative refusal.
    expect(verifyAuthToken(cloudToken())).toMatchObject({ ok: false, reason: UNVERIFIED });
    expect(UNVERIFIED).not.toBe('invalid');
  });

  it('puts the identity and the session on the request, exactly as the sync path does', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());
    const token = cloudToken();
    const request = { ...req(token), session: {} };
    const r = res();
    const next = vi.fn();

    await requireAuth()(request, r, next);

    expect(next).toHaveBeenCalled();
    expect(request.user).toMatchObject({ isAuthenticated: true, id: USER.id, auth_type: 'issuer-verified' });
    // getUserTokenFromSession reads this; a guard that admits without it leaves
    // pollers and plugins with no credential to present to api.agnt.gg.
    expect(request.session.userToken).toBe(token);
  });

  it('serves the second request from cache — one round trip, not one per request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());
    const token = cloudToken();

    await run(token);
    await run(token);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('a real refusal still ends the session', () => {
  it('answers invalid when the ISSUER disowns the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerRefuses());

    const { r, next } = await run(cloudToken());

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(401);
    // The one case where logging out is correct: the authority said no.
    expect(r.body.reason).toBe('invalid');
  });

  it('still rejects an EXPIRED token synchronously, without asking anyone', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const expired = jwt.sign({ id: USER.id }, OWN_SECRET, { expiresIn: -60 });

    const { r, next } = await run(expired);

    expect(next).not.toHaveBeenCalled();
    expect(r.body.reason).toBe('expired');
    expect(fetchSpy, 'exp must never cost a network call to enforce').not.toHaveBeenCalled();
  });

  it('still 401s a request with no token at all, synchronously', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { r, next } = await run(null);

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(401);
    expect(r.body.reason).toBe('missing');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('403s a genuine token belonging to somebody else', async () => {
    // Genuine is not the same as welcome. The async path must apply the same
    // membership boundary the synchronous one does, or re-verification becomes
    // a way around tenant ownership.
    //
    // THE SLUG IS WHAT ARMS THE CHECK. isPermittedUser returns true outright on
    // an instance with no AGNT_TENANT_SLUG, because a desktop has no membership
    // to enforce — so an owner alone proves nothing and this test would pass
    // against a guard that never checked at all.
    process.env.AGNT_TENANT_SLUG = 'someone-elses-tenant';
    process.env.AGNT_TENANT_OWNER = 'somebody-else-entirely';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());

    const { r, next } = await run(cloudToken());

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
  });
});

describe('an issuer outage must not become a fleet-wide logout', () => {
  it.each([
    ['a 5xx from the issuer', issuerBroken],
    ['a network failure', null],
  ])('refuses WITHOUT the logout reason on %s', async (_label, mock) => {
    if (mock) vi.spyOn(globalThis, 'fetch').mockResolvedValue(mock());
    else vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const { r, next } = await run(cloudToken());

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(401);
    // The request fails — correctly, we cannot confirm the caller. But the
    // session survives, so the user is still signed in when the API returns.
    expect(r.body.reason, 'a bad afternoon at the API would log out every tenant').toBe(UNVERIFIED);
  });

  it('keeps admitting a KNOWN-GOOD token through an outage (stale grace)', async () => {
    const token = cloudToken();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerConfirms());
    await verifyViaIssuer(token); // one good answer, now cached

    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 1000); // past POSITIVE_TTL_MS
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const { r, next } = await run(token);

    expect(next, `logged out a known-good member during an outage (${r.body?.reason})`).toHaveBeenCalled();
  });
});

describe('a desktop install is untouched', () => {
  it('rejects a foreign token synchronously as invalid, and never hits the network', async () => {
    delete process.env.AGNT_AUTH_MODE;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Here `jwt.verify` failing IS authoritative — this install holds the key —
    // so 'invalid' is the honest answer and the logout it triggers is correct.
    const r = res();
    const next = vi.fn();
    requireAuth()(req(cloudToken()), r, next); // NOT awaited: must be sync

    expect(r.statusCode).toBe(401);
    expect(r.body.reason).toBe('invalid');
    expect(next).not.toHaveBeenCalled();
    expect(fetchSpy, 'a desktop must not acquire a network dependency on auth').not.toHaveBeenCalled();
  });

  it('admits a locally-signed token synchronously', () => {
    delete process.env.AGNT_AUTH_MODE;
    const local = jwt.sign({ id: USER.id }, OWN_SECRET, { expiresIn: '1h' });
    const r = res();
    const next = vi.fn();

    requireAuth()(req(local), r, next); // NOT awaited

    expect(next).toHaveBeenCalled();
    expect(r.statusCode).toBe(0);
  });
});
