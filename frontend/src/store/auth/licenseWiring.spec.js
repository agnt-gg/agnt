/**
 * Wiring contract for license identity binding.
 *
 * The defect was never a wrong function — it was a correct check that did not
 * exist at three specific junctions. Unit-testing the helpers proves nothing
 * about whether anything CALLS them, so these assert the call sites directly:
 *
 *   1. userAuth.SET_SIGNED_LICENSE refuses a foreign license  (behavioural)
 *   2. userAuth.SET_TOKEN drops a foreign license on identity change (behavioural)
 *   3. validateLicense is registered with an `identity` scope    (source)
 *   4. the cached-license fast path is gated on subject          (source)
 *
 * (4) moved from main.js to store/auth/sessionBoot.js when session start
 * stopped being something only a page load could do. The invariant is
 * unchanged; only its address is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.resolve(HERE, p), 'utf8');
/** Source scanners must never match their own explanatory prose. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const REAL_USER_ID = 'add4b3d4e2536a142bc0c89a585eda3e';

vi.mock('@/services/mediaAuth.js', () => ({ setMediaCookie: vi.fn(), clearMediaCookie: vi.fn() }));
vi.mock('@/composables/useAppVersion.js', () => ({
  useAppVersion: () => ({ fetchVersion: async () => '0.6.5' }),
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

function makeJwt(payload = {}) {
  const body = {
    id: REAL_USER_ID, userId: REAL_USER_ID, email: 'nathan@bizop.io',
    exp: Math.floor(Date.now() / 1000) + 3600, ...payload,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}.sig`;
}

const anonLicense = {
  license: { userId: 'anonymous', planType: 'free', planName: 'Community Core', features: { plugins: { enabled: false } } },
  signature: 's',
};
const entLicense = {
  license: { userId: REAL_USER_ID, planType: 'enterprise', features: { plugins: { enabled: true, maxCount: -1 } } },
  signature: 's',
};

let userAuth;
beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  userAuth = (await import('./userAuth.js')).default;
});

const freshState = (over = {}) => ({
  token: null, signedLicense: null, planType: 'free', planFeatures: {},
  licenseStatus: 'unknown', lastLicenseCheck: null, ...over,
});

describe('SET_SIGNED_LICENSE refuses a license issued to another subject', () => {
  it('does NOT let the anonymous license downgrade a logged-in enterprise user', () => {
    // Exact production sequence: fetchSubscription lands enterprise first,
    // then the boot-time anonymous license arrives and used to stomp it.
    const state = freshState({ token: makeJwt(), planType: 'enterprise' });

    userAuth.mutations.SET_SIGNED_LICENSE(state, anonLicense);

    expect(state.planType).toBe('enterprise');       // not clobbered
    expect(state.signedLicense).toBeNull();          // not cached
    expect(state.licenseStatus).toBe('unknown');     // triggers revalidation
    expect(localStorage.getItem('signedLicense')).toBeNull();
  });

  it('accepts and applies the matching enterprise license', () => {
    const state = freshState({ token: makeJwt() });

    userAuth.mutations.SET_SIGNED_LICENSE(state, entLicense);

    expect(state.planType).toBe('enterprise');
    expect(state.licenseStatus).toBe('valid');
    expect(state.planFeatures.plugins.enabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('signedLicense'))).toEqual(entLicense);
  });

  it('still accepts an anonymous license for a genuinely logged-out user', () => {
    const state = freshState({ token: null });

    userAuth.mutations.SET_SIGNED_LICENSE(state, anonLicense);

    expect(state.licenseStatus).toBe('valid');
    expect(state.planType).toBe('free');
  });

  it('null clears as before (unchanged contract)', () => {
    const state = freshState({ token: makeJwt(), signedLicense: entLicense });
    userAuth.mutations.SET_SIGNED_LICENSE(state, null);
    expect(state.licenseStatus).toBe('invalid');
  });
});

describe('SET_TOKEN invalidates a license belonging to the previous subject', () => {
  it('drops the anonymous license the moment a real session begins', () => {
    const state = freshState({ token: null, signedLicense: anonLicense, licenseStatus: 'valid' });

    userAuth.mutations.SET_TOKEN(state, makeJwt());

    expect(state.signedLicense).toBeNull();
    expect(state.licenseStatus).toBe('unknown');
    expect(localStorage.getItem('signedLicense')).toBeNull();
  });

  it('keeps a license that still matches the incoming token (token refresh)', () => {
    const token = makeJwt();
    const state = freshState({ token, signedLicense: entLicense, licenseStatus: 'valid' });

    userAuth.mutations.SET_TOKEN(state, makeJwt({ iat: 999 })); // same subject, new token

    expect(state.signedLicense).toEqual(entLicense);
    expect(state.licenseStatus).toBe('valid');
  });
});

describe('degraded mode — feature gates survive a missing license for paid subscriptions', () => {
  // Shape captured live from GET /users/subscription/status on 2026-07-31.
  const enterpriseSub = {
    planType: 'enterprise', planStatus: 'active',
    features: {
      coreFeatures: true, unlimitedWorkflows: true, allIntegrations: true,
      cloudSync: true, apiAccess: true, webhooks: true, emailServer: true,
      multiUser: true, whiteLabel: true, sla: true,
      syncInterval: 0, webhookInterval: 0, emailInterval: 0, maxUsers: -1,
    },
  };

  it('falls back to subscription-attested features when no valid license exists', () => {
    const state = freshState({ token: makeJwt(), subscription: enterpriseSub, planType: 'enterprise' });
    const feat = userAuth.getters.getLicenseFeature(state, { hasValidLicense: false });

    expect(feat('webhooks')).toMatchObject({ enabled: true, interval: 0 });
    expect(feat('emailServer')).toMatchObject({ enabled: true, interval: 0 });
    expect(feat('cloudSync')).toMatchObject({ enabled: true, interval: 0 });
    expect(feat('apiAccess')).toMatchObject({ enabled: true, tier: 'enterprise' });
    expect(feat('multiUser')).toMatchObject({ enabled: true, maxSeats: -1 });
    expect(feat('whiteLabel')).toBe(true);
  });

  it('never invents features the subscription does not attest (plugins)', () => {
    const state = freshState({ subscription: enterpriseSub, planType: 'enterprise' });
    const feat = userAuth.getters.getLicenseFeature(state, { hasValidLicense: false });
    expect(feat('plugins')).toBe(false);
  });

  it('free tier gets nothing from the fallback — strictness intact', () => {
    const state = freshState({
      subscription: { planType: 'free', features: { webhooks: false } },
      planType: 'free',
    });
    const feat = userAuth.getters.getLicenseFeature(state, { hasValidLicense: false });
    expect(feat('webhooks')).toBe(false);
    expect(feat('coreFeatures')).toBe(false);
  });

  it('no subscription at all -> false (fully-offline fresh install stays gated)', () => {
    const state = freshState({ subscription: null, planType: 'enterprise' });
    const feat = userAuth.getters.getLicenseFeature(state, { hasValidLicense: false });
    expect(feat('webhooks')).toBe(false);
  });

  it('a valid license takes PRECEDENCE over the subscription — including saying no', () => {
    // The license is the stricter, signed instrument. If it explicitly
    // disables a feature, a rosier subscription must not override it.
    const state = freshState({
      subscription: enterpriseSub, planType: 'enterprise', licenseStatus: 'valid',
      signedLicense: { license: { userId: REAL_USER_ID, features: { webhooks: { enabled: false } } }, signature: 's' },
    });
    const feat = userAuth.getters.getLicenseFeature(state, { hasValidLicense: true });
    expect(feat('webhooks')).toBe(false);
  });
});

describe('source contract — the checks are actually installed', () => {
  it('validateLicense is registered with an identity scope', () => {
    const src = stripComments(read('./userAuth.js'));
    // The action must pass an identity fn derived from the token, not just a TTL.
    expect(src).toMatch(/staleAfter:\s*TTL\.userAuthValidateLicense/);
    expect(src).toMatch(/identity:\s*\(ctx\)\s*=>\s*authSubject\(ctx\.state\.token\)/);
  });

  it('withFreshness honours the identity option', () => {
    const src = stripComments(read('../_utils/withFreshness.js'));
    expect(src).toMatch(/identity\s*=\s*null/);
    expect(src).toMatch(/identityChanged/);
  });

  it('the cached-license fast path is gated on subject match', () => {
    // In sessionBoot.js now: hydrating a cached license is session-start work,
    // and a login can find a usable cached license just as a page load can.
    const src = stripComments(read('./sessionBoot.js'));
    expect(src).toMatch(/licenseMatchesSubject\(parsed,\s*token\)/);
    // and the fast path must require it
    expect(src).toMatch(/expiresAt > now \+ 300 && belongsToThisSession/);
  });

  it('main.js does not keep a second, unguarded copy of that fast path', () => {
    // The failure mode this whole file exists for is a correct check that some
    // OTHER call site skips. Moving logic is exactly when a stale duplicate
    // gets left behind.
    const src = stripComments(read('../../main.js'));
    expect(src).not.toMatch(/signedLicense/);
    expect(src).not.toMatch(/expiresAt/);
  });

  it('anti-vacuity: the scanners find real, non-empty sources', () => {
    expect(stripComments(read('./userAuth.js')).length).toBeGreaterThan(5000);
    expect(stripComments(read('./sessionBoot.js')).length).toBeGreaterThan(1000);
  });
});
