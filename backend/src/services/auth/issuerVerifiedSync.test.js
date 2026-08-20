/**
 * One cloud token, three verification sites.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS FILE EXISTS FOR
 * ---------------------------------------------------------------------------
 * A hosted install cannot hold the issuer's signing key, so a genuine cloud
 * token fails `jwt.verify` there. The first fix traded it for a token the
 * install minted itself, which let all three sites verify locally.
 *
 * That broke the app in a way no backend test could see. The FRONTEND keeps ONE
 * token in localStorage and sends it to TWO authorities — this backend, and
 * api.agnt.gg for credits, subscription, referrals, licence, marketplace and
 * connected apps. Swapping the stored token left every direct-to-cloud call
 * holding a credential the cloud could not verify:
 *
 *     api.agnt.gg/users/auth/status  -> 200 {"isAuthenticated":false}
 *     api.agnt.gg/users/credits      -> 401
 *     api.agnt.gg/users/subscription -> 401
 *
 * The user stayed signed in and silently lost half the product.
 *
 * So the client keeps the cloud token, and the two SYNCHRONOUS verify sites
 * read the answer the ASYNCHRONOUS one already got from the issuer. These tests
 * pin that the sharing works, that it cannot manufacture a positive, and — most
 * importantly — that none of it happens on a normal install.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

import {
  __resetVerifierForTests,
  forgetToken,
  verifiedUserSync,
  verifyViaIssuer,
} from './remoteTokenVerifier.js';

const OWN_SECRET = 'this-hosted-installs-own-private-secret';
const CLOUD_SECRET = 'the-published-cloud-secret-we-do-not-have';
const USER = { id: 'user-abc', userId: 'user-abc', email: 'nathan@bizop.io' };

/** A token as api.agnt.gg issues it — signed with a key this install lacks. */
const cloudToken = () => jwt.sign({ id: USER.id, email: USER.email }, CLOUD_SECRET, { expiresIn: '30d' });

const issuerSays = (yes) => ({
  ok: true,
  json: async () => ({ isAuthenticated: yes, user: yes ? USER : null }),
});

const prev = {};

beforeEach(() => {
  __resetVerifierForTests();
  prev.mode = process.env.AGNT_AUTH_MODE;
  prev.secret = process.env.JWT_SECRET;
  prev.trust = process.env.TRUST_REMOTE_AUTH;
  process.env.AGNT_AUTH_MODE = 'verify-remote';
  process.env.JWT_SECRET = OWN_SECRET;
  delete process.env.TRUST_REMOTE_AUTH;
});

afterEach(() => {
  for (const [k, v] of [
    ['AGNT_AUTH_MODE', prev.mode],
    ['JWT_SECRET', prev.secret],
    ['TRUST_REMOTE_AUTH', prev.trust],
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetVerifierForTests();
  vi.restoreAllMocks();
});

describe('verifiedUserSync can only REPORT a positive, never create one', () => {
  it('returns null for a token the issuer has never confirmed', () => {
    // If an unseen token could pass, this would be a trust decision rather than
    // a memo, and taking the issuer offline would become an attack.
    expect(verifiedUserSync(cloudToken())).toBeNull();
  });

  it('returns null for a token the issuer REFUSED', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerSays(false));
    const token = cloudToken();
    await verifyViaIssuer(token);

    expect(verifiedUserSync(token)).toBeNull();
  });

  it('returns the ISSUER\u2019s identity, not a decode of the payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerSays(true));
    // Claims a different user than the issuer will report. A local decode would
    // return `somebody-else`; the issuer's answer must win.
    const token = jwt.sign({ id: 'somebody-else' }, CLOUD_SECRET, { expiresIn: '1h' });
    await verifyViaIssuer(token);

    expect(verifiedUserSync(token).id).toBe(USER.id);
  });

  it.each([null, undefined, '', 42, {}])('refuses the non-token %j', (bad) => {
    expect(verifiedUserSync(bad)).toBeNull();
  });

  it('stops reporting once the entry expires', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerSays(true));
    const token = cloudToken();
    await verifyViaIssuer(token);
    expect(verifiedUserSync(token)).toBeTruthy();

    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    expect(verifiedUserSync(token)).toBeNull();
  });

  it('stops reporting after sign-out', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerSays(true));
    const token = cloudToken();
    await verifyViaIssuer(token);

    forgetToken(token);
    expect(verifiedUserSync(token)).toBeNull();
  });
});

describe('THE PREMISE: one cloud token satisfies all three sites', () => {
  it('is accepted by authGuard and socketIdentity once the issuer has confirmed it', async () => {
    const token = cloudToken();
    const { verifyAuthToken } = await import('../../utils/authGuard.js');
    const { resolveSocketIdentity } = await import('../../utils/socketIdentity.js');
    const env = { JWT_SECRET: OWN_SECRET, NODE_ENV: 'production' };

    // BEFORE: nothing has verified it, so both refuse. This is also the cold
    // -start behaviour, and it is exactly today's 401 — no worse.
    expect(verifyAuthToken(token).ok).toBe(false);
    expect(resolveSocketIdentity({ token }, env).ok).toBe(false);

    // The REST middleware runs first on every page load and asks the issuer.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerSays(true));
    await verifyViaIssuer(token);

    // AFTER: the same token now works everywhere, with no client change.
    const guard = verifyAuthToken(token);
    expect(guard.ok, 'media, file and image URLs would 401').toBe(true);
    expect(guard.user.id).toBe(USER.id);
    expect(guard.user.auth_type).toBe('issuer-verified');

    const socket = resolveSocketIdentity({ token }, env);
    expect(socket.ok, `no realtime chat or tool events (${socket.reason})`).toBe(true);
    expect(socket.userId).toBe(USER.id);
  });

  it('an EXPIRED local token is still expired \u2014 exp stays unbypassable', async () => {
    const { verifyAuthToken } = await import('../../utils/authGuard.js');
    const expired = jwt.sign({ id: USER.id }, OWN_SECRET, { expiresIn: -60 });

    // Even with a warm cache for it, expiry must win: otherwise this path
    // becomes a way to extend a dead session.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(issuerSays(true));
    await verifyViaIssuer(expired);

    expect(verifyAuthToken(expired)).toMatchObject({ ok: false, reason: 'expired' });
  });
});

describe('NONE of this happens on a normal install', () => {
  it('a desktop never consults the cache, because nothing populates it', async () => {
    delete process.env.AGNT_AUTH_MODE;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { verifyAuthToken } = await import('../../utils/authGuard.js');
    const { resolveSocketIdentity } = await import('../../utils/socketIdentity.js');

    // A locally-signed token: the ordinary desktop case, unchanged.
    const local = jwt.sign({ id: USER.id }, OWN_SECRET, { expiresIn: '1h' });
    expect(verifyAuthToken(local)).toMatchObject({ ok: true });
    expect(verifyAuthToken(local).user.auth_type).toBe('local');
    expect(resolveSocketIdentity({ token: local }, { JWT_SECRET: OWN_SECRET }).ok).toBe(true);

    // A foreign token is refused, and NOTHING reaches out to the network. A
    // desktop that quietly began calling api.agnt.gg on every bad token would
    // be a new dependency with an identical status code.
    expect(verifyAuthToken(cloudToken()).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
