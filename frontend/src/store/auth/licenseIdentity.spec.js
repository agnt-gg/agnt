/**
 * Regression suite for the "paid account renders as free" defect.
 *
 * Ground truth captured from production on 2026-07-31:
 *   GET  /users/subscription/status -> planType "enterprise", planStatus "active"
 *   POST /license/validate  (authed) -> license.userId "add4b3d4e2536a142bc0c89a585eda3e",
 *                                       planType "enterprise"
 *   POST /license/validate (anon)    -> license.userId "anonymous",
 *                                       planType "free", planName "Community Core",
 *                                       expiresAt = issuedAt + 7 days
 *
 * The stored license found in the app's localStorage was the ANONYMOUS one,
 * issued 9 seconds BEFORE the session token's `iat`. Every assertion below
 * exists because some link in that chain failed silently.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ANONYMOUS_SUBJECT,
  authSubject,
  licenseSubject,
  licenseMatchesSubject,
} from './licenseIdentity.js';
import { withFreshness } from '../_utils/withFreshness.js';

const REAL_USER_ID = 'add4b3d4e2536a142bc0c89a585eda3e';

function makeJwt(payload = {}) {
  const body = {
    id: REAL_USER_ID,
    userId: REAL_USER_ID,
    email: 'nathan@bizop.io',
    auth_type: 'google',
    iat: 1785455384,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}.sig`;
}

/** The exact shape production returns for an unauthenticated validate call. */
const anonymousLicense = {
  license: {
    userId: 'anonymous',
    email: null,
    planType: 'free',
    planStatus: 'active',
    planName: 'Community Core',
    features: {
      cloudSync: { enabled: false, interval: null },
      apiAccess: { enabled: false, tier: 'free' },
      plugins: { enabled: false, maxCount: 0 },
      whiteLabel: false,
    },
    issuedAt: 1785455375,
    expiresAt: 1785455375 + 7 * 24 * 3600,
    refreshBefore: 1785455375 + 5 * 24 * 3600,
  },
  signature: 'anon-sig',
};

/** The exact shape production returns for Nathan's authenticated call. */
const enterpriseLicense = {
  license: {
    userId: REAL_USER_ID,
    email: 'nathan@bizop.io',
    planType: 'enterprise',
    planStatus: 'active',
    planName: 'Enterprise',
    features: {
      cloudSync: { enabled: true, interval: 0 },
      apiAccess: { enabled: true, tier: 'enterprise' },
      plugins: { enabled: true, maxCount: -1 },
      whiteLabel: true,
    },
    issuedAt: 1785461454,
    expiresAt: 1785461454 + 7 * 24 * 3600,
    refreshBefore: 1785461454 + 5 * 24 * 3600,
  },
  signature: 'ent-sig',
};

describe('licenseIdentity — subject extraction', () => {
  it('treats a missing/!invalid token as the anonymous subject', () => {
    expect(authSubject(null)).toBe(ANONYMOUS_SUBJECT);
    expect(authSubject('')).toBe(ANONYMOUS_SUBJECT);
    expect(authSubject('not-a-jwt')).toBe(ANONYMOUS_SUBJECT);
  });

  it('reads the user id out of a real-shaped session token', () => {
    expect(authSubject(makeJwt())).toBe(REAL_USER_ID);
  });

  it('treats an EXPIRED token as anonymous (userFromJwt rejects it)', () => {
    const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect(authSubject(expired)).toBe(ANONYMOUS_SUBJECT);
  });

  it("reads the server's anonymous marker verbatim", () => {
    expect(licenseSubject(anonymousLicense)).toBe(ANONYMOUS_SUBJECT);
    expect(licenseSubject(enterpriseLicense)).toBe(REAL_USER_ID);
    expect(licenseSubject(null)).toBe(ANONYMOUS_SUBJECT);
  });
});

describe('licenseIdentity — the actual defect', () => {
  it('REJECTS the anonymous license against a logged-in session', () => {
    // This single assertion is the whole bug. Before the fix this pairing
    // was accepted, cached, and marked `valid`.
    expect(licenseMatchesSubject(anonymousLicense, makeJwt())).toBe(false);
  });

  it('accepts the enterprise license against its own session', () => {
    expect(licenseMatchesSubject(enterpriseLicense, makeJwt())).toBe(true);
  });

  it('accepts an anonymous license when genuinely logged out', () => {
    // Not an error state — a free user on a free license is correct.
    expect(licenseMatchesSubject(anonymousLicense, null)).toBe(true);
  });

  it("rejects another user's license (account switch)", () => {
    expect(licenseMatchesSubject(enterpriseLicense, makeJwt({ id: 'someone-else', userId: 'someone-else' })))
      .toBe(false);
  });

  it('rejects a malformed license rather than defaulting it to anonymous-match', () => {
    expect(licenseMatchesSubject({}, null)).toBe(false);
    expect(licenseMatchesSubject(null, null)).toBe(false);
  });

  it('does not care about expiry — that is a separate, already-working check', () => {
    // Anti-conflation guard: the stored license was NOT expired. If someone
    // "fixes" this by folding expiry in here, this fails.
    const longLived = { license: { userId: REAL_USER_ID, expiresAt: 0 } };
    expect(licenseMatchesSubject(longLived, makeJwt())).toBe(true);
  });
});

describe('withFreshness — identity-scoped caching', () => {
  let calls;
  beforeEach(() => { calls = 0; });

  const makeAction = (opts) =>
    withFreshness('test.action', async (ctx) => { calls++; return `result-for-${ctx.state.token ?? 'none'}`; }, opts);

  it('without identity scoping, a login is answered from the anonymous cache', async () => {
    // Pins the ORIGINAL broken behaviour so the fix is provably load-bearing.
    const action = makeAction({ staleAfter: 60_000 });
    const ctx = { state: { token: null } };
    await action(ctx);
    ctx.state.token = makeJwt();
    await action(ctx);
    expect(calls).toBe(1); // <- the swallowed post-login revalidation
  });

  it('with identity scoping, a login forces a real refetch', async () => {
    const action = makeAction({ staleAfter: 60_000, identity: (ctx) => authSubject(ctx.state.token) });
    const ctx = { state: { token: null } };
    await action(ctx);
    expect(calls).toBe(1);

    ctx.state.token = makeJwt();
    const second = await action(ctx);
    expect(calls).toBe(2);
    expect(second).toContain('eyJ'); // fetched for the authenticated subject
  });

  it('still serves the TTL cache when the subject is unchanged', async () => {
    const action = makeAction({ staleAfter: 60_000, identity: (ctx) => authSubject(ctx.state.token) });
    const ctx = { state: { token: makeJwt() } };
    await action(ctx);
    await action(ctx);
    await action(ctx);
    expect(calls).toBe(1); // identity scoping must not defeat the TTL
  });

  it('refetches on logout as well as login (symmetry)', async () => {
    const action = makeAction({ staleAfter: 60_000, identity: (ctx) => authSubject(ctx.state.token) });
    const ctx = { state: { token: makeJwt() } };
    await action(ctx);
    ctx.state.token = null;
    await action(ctx);
    expect(calls).toBe(2);
  });

  it('stamps identity at ISSUE time, so a login mid-flight cannot adopt the anonymous answer', async () => {
    // The request went out with no credentials, so its response describes the
    // anonymous subject regardless of who is logged in when it lands. Stamping
    // the post-await identity would relabel that free-tier payload as the
    // authenticated user's and serve it for the full TTL — the original defect,
    // reintroduced inside the wrapper meant to prevent it.
    // Each invocation parks its own resolver: a single shared `resolveFetch`
    // would be overwritten by the second call and deadlock the first.
    const pending = [];
    const releaseAll = () => { while (pending.length) pending.shift()(); };
    const gated = withFreshness(
      'test.gated',
      async () => { calls++; await new Promise((r) => pending.push(r)); return 'anon-payload'; },
      { staleAfter: 60_000, identity: (ctx) => authSubject(ctx.state.token) }
    );
    const ctx = { state: { token: null } };
    const inflight = gated(ctx);
    await Promise.resolve();
    ctx.state.token = makeJwt();     // login lands while the anon fetch is open
    releaseAll();
    await inflight;

    const second = gated(ctx);
    await Promise.resolve();
    releaseAll();
    await second;
    expect(calls).toBe(2); // refetched for the authenticated subject
  });

  it('a newly-authenticated caller does not ride an in-flight ANONYMOUS request', async () => {
    // Narrower window, same mistake: dedup is a cache too. Before the fix the
    // first fetch had lastFetched === 0, so `identityChanged` was false and a
    // post-login caller was handed the anonymous promise.
    const pending = [];
    const releaseAll = () => { while (pending.length) pending.shift()(); };
    const gated = withFreshness(
      'test.inflight',
      async (ctx) => { calls++; const t = ctx.state.token; await new Promise((r) => pending.push(r)); return `for-${t ?? 'none'}`; },
      { staleAfter: 60_000, identity: (ctx) => authSubject(ctx.state.token) }
    );
    const ctx = { state: { token: null } };
    const anonCall = gated(ctx);
    await Promise.resolve();

    ctx.state.token = makeJwt();
    const authedCall = gated(ctx);   // must NOT be the same promise
    await Promise.resolve();

    expect(authedCall).not.toBe(anonCall);
    releaseAll();
    const [anonResult, authedResult] = await Promise.all([anonCall, authedCall]);
    expect(calls).toBe(2);
    expect(anonResult).toBe('for-none');
    expect(authedResult).toContain('eyJ');
  });

  it('a throwing identity fn degrades to a miss, never to a wrong-subject hit', async () => {
    const action = makeAction({
      staleAfter: 60_000,
      identity: () => { throw new Error('boom'); },
    });
    const ctx = { state: { token: null } };
    await action(ctx);
    await action(ctx);
    expect(calls).toBe(2);
  });

  it('forceRefresh still bypasses everything', async () => {
    const action = makeAction({ staleAfter: 60_000, identity: (ctx) => authSubject(ctx.state.token) });
    const ctx = { state: { token: makeJwt() } };
    await action(ctx);
    await action(ctx, { forceRefresh: true });
    expect(calls).toBe(2);
  });
});
