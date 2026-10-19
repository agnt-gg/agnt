/**
 * Day 30 never arrives.
 *
 * Every credentialed workflow, email trigger and webhook authenticates to
 * api.agnt.gg with the 30-day session token the user signed in with. Nothing
 * renewed it, so on day 30 all of them stopped until someone signed in again.
 * sessionRenewal trades a still-valid token for a fresh one in the last week.
 *
 * What must hold:
 *   - inside the last week, the token is renewed and the renewal reaches every
 *     holder (cache -> subscribers -> the workflow process over IPC);
 *   - outside it, no network at all;
 *   - a failure NEVER removes a credential, and a refusal is loud;
 *   - a renewal is adopted only if it verifies, is for the same account, and
 *     lives longer than what it replaces.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  rememberSessionToken,
  getSessionToken,
  subscribe,
  __resetSessionTokenCacheForTests,
} from './sessionTokenCache.js';
import {
  renewExpiringSessions,
  startSessionRenewal,
  RENEW_WITHIN_MS,
  CHECK_EVERY_MS,
  __resetSessionRenewalForTests,
} from './sessionRenewal.js';

const SECRET = 'renewal-test-secret';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-01T12:00:00Z');

/** A token the way api.agnt.gg issues one: `issuedDaysAgo` before NOW, 30-day lifetime. */
const sessionToken = (userId, issuedDaysAgo, { secret = SECRET, lifetimeDays = 30 } = {}) => {
  const iat = Math.floor((NOW - issuedDaysAgo * DAY) / 1000);
  return jwt.sign({ id: userId, userId, email: `${userId}@example.com`, auth_type: 'google', iat, exp: iat + lifetimeDays * 86400 }, secret);
};

const ok = (token) => async () => ({ status: 200, body: { token } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv('JWT_SECRET', SECRET);
  __resetSessionTokenCacheForTests();
  __resetSessionRenewalForTests();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  __resetSessionRenewalForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('renewing in the last week', () => {
  it('THE DAY-30 OUTAGE: a token 6 days from expiry is renewed, and the renewal reaches the workflow process', async () => {
    const old = sessionToken('user-1', 24);
    rememberSessionToken(old, 'user-1');
    const forwarded = [];
    subscribe((entry) => forwarded.push(entry)); // what WorkflowProcessBridge forwards over IPC

    const renewed = sessionToken('user-1', 0);
    const outcomes = await renewExpiringSessions({ now: NOW, post: ok(renewed) });

    expect(outcomes).toEqual([{ userId: 'user-1', outcome: 'renewed' }]);
    expect(getSessionToken('user-1')).toBe(renewed);
    expect(forwarded).toEqual([{ token: renewed, userId: 'user-1' }]);

    // And the point of it all: past the OLD token's expiry, background work
    // still has a credential.
    vi.setSystemTime(NOW + 7 * DAY);
    expect(getSessionToken('user-1')).toBe(renewed);
  });

  it('keeps renewing, cycle after cycle, so it never has to end', async () => {
    let current = sessionToken('user-1', 0);
    rememberSessionToken(current, 'user-1');
    for (let cycle = 1; cycle <= 6; cycle++) {
      vi.setSystemTime(NOW + cycle * 24 * DAY);
      const issuedAt = Math.floor(Date.now() / 1000);
      const next = jwt.sign({ id: 'user-1', iat: issuedAt, exp: issuedAt + 30 * 86400 }, SECRET);
      await renewExpiringSessions({ now: Date.now(), post: ok(next) });
      expect(getSessionToken('user-1'), `cycle ${cycle}`).toBe(next);
      current = next;
    }
  });

  it('costs no network while more than a week remains', async () => {
    rememberSessionToken(sessionToken('user-1', 22), 'user-1'); // 8 days left
    const post = vi.fn();
    await renewExpiringSessions({ now: NOW, post });
    expect(post).not.toHaveBeenCalled();
    expect(RENEW_WITHIN_MS).toBe(7 * DAY);
  });

  it('never sends an API key or a non-JWT token anywhere', async () => {
    rememberSessionToken(`agnt_sk_${'a'.repeat(64)}`, 'user-key');
    rememberSessionToken('opaque-test-token', 'user-opaque');
    const post = vi.fn();
    await renewExpiringSessions({ now: NOW, post });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('a failure never takes a credential away', () => {
  it('a refusal keeps the current token, and says so loudly, once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = sessionToken('user-1', 25);
    rememberSessionToken(old, 'user-1');
    const post = async () => ({ status: 401, body: { reason: 'proof' } });

    await renewExpiringSessions({ now: NOW, post });
    await renewExpiringSessions({ now: NOW, post });

    expect(getSessionToken('user-1')).toBe(old);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(/REFUSED.*reason=proof.*will stop at/);
  });

  it('unreachable or a 5xx: keep the token and try again next tick', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const old = sessionToken('user-1', 25);
    rememberSessionToken(old, 'user-1');

    const down = await renewExpiringSessions({ now: NOW, post: async () => { throw new Error('ECONNRESET'); } });
    const busy = await renewExpiringSessions({ now: NOW, post: async () => ({ status: 503, body: { reason: 'unavailable' } }) });

    expect(down).toEqual([{ userId: 'user-1', outcome: 'unreachable' }]);
    expect(busy).toEqual([{ userId: 'user-1', outcome: 'refused:503' }]);
    expect(getSessionToken('user-1')).toBe(old);
  });

  it('a server without the route yet (404) is a quiet retry, not an error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    rememberSessionToken(sessionToken('user-1', 25), 'user-1');
    await renewExpiringSessions({ now: NOW, post: async () => ({ status: 404, body: null }) });
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('only a renewal it can vouch for is adopted', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

  it('not one that fails verification', async () => {
    const old = sessionToken('user-1', 25);
    rememberSessionToken(old, 'user-1');
    const outcomes = await renewExpiringSessions({ now: NOW, post: ok(sessionToken('user-1', 0, { secret: 'someone-else' })) });
    expect(outcomes).toEqual([{ userId: 'user-1', outcome: 'discarded' }]);
    expect(getSessionToken('user-1')).toBe(old);
  });

  it('not one for another account', async () => {
    const old = sessionToken('user-1', 25);
    rememberSessionToken(old, 'user-1');
    await renewExpiringSessions({ now: NOW, post: ok(sessionToken('user-2', 0)) });
    expect(getSessionToken('user-1')).toBe(old);
    expect(getSessionToken('user-2')).toBeNull();
  });

  it('not one that would shorten the session', async () => {
    const old = sessionToken('user-1', 25);
    rememberSessionToken(old, 'user-1');
    await renewExpiringSessions({ now: NOW, post: ok(sessionToken('user-1', 0, { lifetimeDays: 2 })) });
    expect(getSessionToken('user-1')).toBe(old);
  });
});

describe('the schedule', () => {
  it('first check shortly after boot, then every hour; stoppable', async () => {
    const run = vi.fn().mockResolvedValue([]);
    const stop = startSessionRenewal({ firstCheckAfterMs: 1000, everyMs: CHECK_EVERY_MS, run });

    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(5 * CHECK_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a slow check with the next one, and starting twice is one schedule', async () => {
    let release;
    const run = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    startSessionRenewal({ firstCheckAfterMs: 10, everyMs: 100, run });
    startSessionRenewal({ firstCheckAfterMs: 10, everyMs: 100, run });

    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500); // still in flight: every tick skipped
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a check that throws does not kill the schedule', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    startSessionRenewal({ firstCheckAfterMs: 10, everyMs: 100, run });
    await vi.advanceTimersByTimeAsync(110);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
