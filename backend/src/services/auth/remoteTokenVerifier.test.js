/**
 * Issuer-delegated token verification.
 *
 * The assertions that matter are the refusals and the failure policy. A cache
 * that answers "yes" when it should not is worse than no cache, and a network
 * blip that logs out every user of a hosted instance is an outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetVerifierForTests,
  forgetToken,
  isRemoteVerifyMode,
  verifierStats,
  verifyViaIssuer,
} from './remoteTokenVerifier.js';

const TOKEN = 'header.payload.signature';
const USER = { id: 'u-1', userId: 'u-1', email: 'nathan@bizop.io' };

const ok = () => ({ ok: true, json: async () => ({ isAuthenticated: true, user: USER }) });
const denied = () => ({ ok: true, json: async () => ({ isAuthenticated: false, user: null }) });

beforeEach(() => {
  __resetVerifierForTests();
  process.env.AGNT_AUTH_MODE = 'verify-remote';
  process.env.REMOTE_URL = 'https://api.agnt.gg';
});

afterEach(() => {
  delete process.env.AGNT_AUTH_MODE;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the mode gate — desktop must be untouched', () => {
  it('is off unless explicitly set', () => {
    delete process.env.AGNT_AUTH_MODE;
    expect(isRemoteVerifyMode()).toBe(false);
  });

  it.each(['', 'local', 'verify_remote', 'VERIFY-REMOTELY', 'true'])(
    'stays off for %j rather than guessing',
    (value) => {
      process.env.AGNT_AUTH_MODE = value;
      // The unsafe direction — reaching out to the network on every failed
      // verify — is the one that must be spelled exactly.
      expect(isRemoteVerifyMode()).toBe(false);
    }
  );

  it('is on for an exact match, trimmed and case-insensitive', () => {
    for (const v of ['verify-remote', '  Verify-Remote  ']) {
      process.env.AGNT_AUTH_MODE = v;
      expect(isRemoteVerifyMode()).toBe(true);
    }
  });
});

describe('asking the issuer', () => {
  it('accepts what the issuer accepts, and passes the token as a bearer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());

    const result = await verifyViaIssuer(TOKEN);

    expect(result).toMatchObject({ ok: true, source: 'issuer' });
    expect(result.user.email).toBe('nathan@bizop.io');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.agnt.gg/users/auth/status');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses what the issuer refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(denied());
    expect(await verifyViaIssuer(TOKEN)).toMatchObject({ ok: false, user: null });
  });

  it('treats a non-2xx as UNKNOWN, not as a denial', async () => {
    // A rate-limited or briefly-broken issuer must not read as "this user is an
    // impostor" — that is how a bad afternoon at the API becomes a mass logout.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 });

    const result = await verifyViaIssuer(TOKEN);
    expect(result.ok).toBe(false);
    expect(result.source).toMatch(/unreachable/);
    // Crucially it was NOT cached as a denial, so recovery is immediate.
    expect(verifierStats().remoteDeny).toBe(0);
  });

  it('never throws, whatever the network does', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(verifyViaIssuer(TOKEN)).resolves.toMatchObject({ ok: false });
  });

  it('refuses an empty token without calling out', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    for (const bad of ['', null, undefined, 42]) {
      expect((await verifyViaIssuer(bad)).ok).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('answers a repeat from cache instead of hammering the issuer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());

    for (let i = 0; i < 25; i++) await verifyViaIssuer(TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verifierStats().hits).toBe(24);
  });

  it('caches denials too, so a bad token cannot be used as an amplifier', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(denied());

    for (let i = 0; i < 10; i++) await verifyViaIssuer(TOKEN);

    // Without this, a client looping on a rejected token turns this install
    // into a traffic amplifier against the issuer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-asks once the positive TTL lapses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());

    await verifyViaIssuer(TOKEN);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    await verifyViaIssuer(TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forgets a token on demand, so sign-out is not outlived by the TTL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());

    await verifyViaIssuer(TOKEN);
    forgetToken(TOKEN);
    await verifyViaIssuer(TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('NEVER STORES THE RAW TOKEN', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await verifyViaIssuer(TOKEN);

    // A heap snapshot or process dump of the cache must not yield usable
    // credentials, so the key is a hash and the value holds only identity.
    const serialised = JSON.stringify(verifierStats());
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain('signature');
  });
});

describe('the failure policy', () => {
  it('serves a stale POSITIVE through an outage, within the grace window', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await verifyViaIssuer(TOKEN);

    fetchMock.mockRejectedValue(new Error('network down'));
    vi.advanceTimersByTime(6 * 60 * 1000); // past the TTL, inside the grace

    const result = await verifyViaIssuer(TOKEN);
    // A transient fault must not log out every user of a running instance.
    expect(result).toMatchObject({ ok: true, source: 'stale-grace' });
  });

  it('stops serving stale once the grace window closes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    await verifyViaIssuer(TOKEN);

    fetchMock.mockRejectedValue(new Error('still down'));
    vi.advanceTimersByTime(40 * 60 * 1000);

    expect((await verifyViaIssuer(TOKEN)).ok).toBe(false);
  });

  it('NEVER invents a positive for a token it has not already seen', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    // The grace path only ever EXTENDS an answer the issuer already gave. If an
    // outage could manufacture a session, taking the issuer offline would be
    // the cheapest possible attack.
    expect((await verifyViaIssuer('a-token-never-seen-before')).ok).toBe(false);
  });

  it('does not let a prior DENIAL become a stale positive', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(denied());
    await verifyViaIssuer(TOKEN);

    fetchMock.mockRejectedValue(new Error('down'));
    vi.advanceTimersByTime(60 * 1000);

    expect((await verifyViaIssuer(TOKEN)).ok).toBe(false);
  });
});
