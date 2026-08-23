/**
 * The credential that lets background work identify itself.
 *
 * This module exists because the email and webhook pollers, workflow nodes and
 * plugins all call api.agnt.gg with no request in scope — and therefore, until
 * now, with no credential. That is the reason those remote endpoints had to
 * accept anonymous callers, and the reason one of them could be asked for any
 * user's OAuth token.
 *
 * The risks worth testing are not "does it store a string". They are:
 *   - does it ever hand out the WRONG user's token (worse than none),
 *   - does it emit a malformed header (`Bearer undefined` is precisely how the
 *     webhook auth bypass turned a missing secret into a valid password),
 *   - does a stale token live forever.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  rememberSessionToken,
  getSessionToken,
  getSessionUserId,
  authHeader,
  clearSessionToken,
  subscribe,
  __resetSessionTokenCacheForTests,
} from './sessionTokenCache.js';

/**
 * A JWT-SHAPED string carrying a real `exp`. Deliberately unsigned: nothing in
 * this module verifies a signature, and pretending otherwise in a fixture would
 * imply a guarantee the code does not make.
 *
 * @param {string} expiresAtIso
 * @param {string} nonce  makes two tokens with the same expiry distinguishable
 */
const jwtExpiring = (expiresAtIso, nonce = 'a') => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.parse(expiresAtIso) / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 'user-1', exp, n: nonce })}.sig-${nonce}`;
};

beforeEach(() => {
  __resetSessionTokenCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('remembering a verified token', () => {
  it('hands back what it was given', () => {
    rememberSessionToken('tok-abc', 'user-1');
    expect(getSessionToken()).toBe('tok-abc');
    expect(getSessionUserId()).toBe('user-1');
  });

  it('produces a well-formed Authorization header', () => {
    rememberSessionToken('tok-abc', 'user-1');
    expect(authHeader()).toEqual({ Authorization: 'Bearer tok-abc' });
  });

  it('OMITS the header entirely when there is no token', () => {
    // Not `{ Authorization: 'Bearer undefined' }`. That exact string is what
    // turned the webhook receiver's missing credential into a valid password.
    expect(authHeader()).toEqual({});
    expect(Object.keys(authHeader())).toHaveLength(0);
  });

  it('ignores empty or malformed input rather than caching it', () => {
    rememberSessionToken('', 'user-1');
    rememberSessionToken(null, 'user-1');
    rememberSessionToken('tok', null);
    expect(getSessionToken()).toBeNull();
    expect(authHeader()).toEqual({});
  });

  it('forgets on demand', () => {
    rememberSessionToken('tok-abc', 'user-1');
    clearSessionToken();
    expect(getSessionToken()).toBeNull();
  });
});

describe('the single-user assumption is enforced, not assumed', () => {
  it('DISABLES itself if a second user id appears', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    rememberSessionToken('tok-a', 'user-1');
    rememberSessionToken('tok-b', 'user-2');

    // Returning either token would attribute one user's background work to the
    // other. No token is the only safe answer.
    expect(getSessionToken()).toBeNull();
    expect(authHeader()).toEqual({});
    expect(err).toHaveBeenCalled();
  });

  it('stays disabled once poisoned, even for the original user', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rememberSessionToken('tok-a', 'user-1');
    rememberSessionToken('tok-b', 'user-2');
    rememberSessionToken('tok-a2', 'user-1');
    expect(getSessionToken()).toBeNull();
  });

  it('a refreshed token for the SAME user is accepted', () => {
    rememberSessionToken('tok-a', 'user-1');
    rememberSessionToken('tok-a-refreshed', 'user-1');
    expect(getSessionToken()).toBe('tok-a-refreshed');
  });
});

describe('staleness', () => {
  it('stops offering a token that is too old', () => {
    vi.useFakeTimers();
    rememberSessionToken('tok-abc', 'user-1');
    expect(getSessionToken()).toBe('tok-abc');

    vi.advanceTimersByTime(37 * 60 * 60 * 1000);
    expect(getSessionToken()).toBeNull();
  });

  it('still offers it well inside the window', () => {
    vi.useFakeTimers();
    rememberSessionToken('tok-abc', 'user-1');
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    expect(getSessionToken()).toBe('tok-abc');
  });
});

describe('two valid credentials for one user do not fight over the slot', () => {
  // The defect this covers: a second window, a paired device or a stale storage
  // copy leaves TWO unexpired tokens for the SAME user in circulation. The
  // single-user poison latch never trips (the ids match), so the slot flipped
  // on every request and re-pushed across the fork ~623 times in 11 unattended
  // hours. Background callers then used whichever credential landed last.
  const LONGER = jwtExpiring('2026-09-21T00:00:00Z', 'longer');
  const SHORTER = jwtExpiring('2026-09-10T00:00:00Z', 'shorter');

  it('refuses a token that dies sooner than the one already held', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    rememberSessionToken(LONGER, 'user-1');
    rememberSessionToken(SHORTER, 'user-1');

    expect(getSessionToken()).toBe(LONGER);
  });

  it('THE REGRESSION: alternating credentials stop notifying after the first', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const changes = [];
    subscribe((entry) => changes.push(entry.token));

    // Two clients, each re-presenting its own credential on a 60s poll.
    for (let i = 0; i < 50; i += 1) {
      rememberSessionToken(LONGER, 'user-1');
      rememberSessionToken(SHORTER, 'user-1');
    }

    // One change, not a hundred. Each of those was an IPC message.
    expect(changes).toEqual([LONGER]);
  });

  it('ANTI-VACUITY: the rule must not simply freeze the slot forever', () => {
    // If "never go backwards" were implemented as "never change", the test
    // above would pass and token rotation would silently stop working.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const renewed = jwtExpiring('2026-10-30T00:00:00Z', 'renewed');

    rememberSessionToken(LONGER, 'user-1');
    rememberSessionToken(renewed, 'user-1');

    expect(getSessionToken()).toBe(renewed);
  });

  it('replaces an incumbent that has already expired, even with a shorter-lived token', () => {
    // Otherwise an issuer shortening its lifetimes (30d -> 7d) would pin this
    // slot to a dead credential permanently.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    rememberSessionToken(SHORTER, 'user-1');

    vi.setSystemTime(new Date('2026-09-11T00:00:00Z')); // SHORTER has expired
    const brieferButAlive = jwtExpiring('2026-09-18T00:00:00Z', 'briefer');
    rememberSessionToken(brieferButAlive, 'user-1');

    expect(getSessionToken()).toBe(brieferButAlive);
  });

  it('still accepts a refresh when neither token is a readable JWT', () => {
    // Unchanged behaviour for non-JWT callers, including the IPC fixtures.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    rememberSessionToken('tok-a', 'user-1');
    rememberSessionToken('tok-a-refreshed', 'user-1');
    expect(getSessionToken()).toBe('tok-a-refreshed');
  });
});

describe('an expired credential never reaches background work', () => {
  it('stops offering a token once its own exp passes, even while the user is active', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = jwtExpiring('2026-01-01T01:00:00Z');

    rememberSessionToken(token, 'user-1');
    expect(getSessionToken()).toBe(token);

    // The user keeps clicking, so `seenAt` is refreshed constantly and the 36h
    // staleness window can never fire. Only the token's own expiry can help.
    vi.setSystemTime(new Date('2026-01-01T00:30:00Z'));
    rememberSessionToken(token, 'user-1');
    expect(getSessionToken(), 'sanity: still valid before exp').toBe(token);

    vi.setSystemTime(new Date('2026-01-01T01:00:01Z'));
    rememberSessionToken(token, 'user-1');

    expect(getSessionToken(), 'an expired credential must never reach a poller').toBeNull();
    expect(authHeader()).toEqual({});
  });
});

describe('diagnostics name a credential without disclosing it', () => {
  it('logs a fingerprint, never the token itself', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const longer = jwtExpiring('2026-09-21T00:00:00Z', 'longer');
    const shorter = jwtExpiring('2026-09-10T00:00:00Z', 'shorter');

    rememberSessionToken(longer, 'user-1');
    rememberSessionToken(shorter, 'user-1');

    const written = [...log.mock.calls, ...warn.mock.calls].flat().join(' ');
    expect(written).not.toContain(longer);
    expect(written).not.toContain(shorter);
    // Anti-vacuity: it must actually have said something about them.
    expect(written).toMatch(/fp=[0-9a-f]{8}/);
  });

  it('reports the subscriber count, which is how double-delivery is spotted', () => {
    // One subscriber in the main process, none in the child. Any other number
    // means every change is being sent N times over IPC — indistinguishable
    // from token churn if you only count messages arriving at the child.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    subscribe(() => {});

    rememberSessionToken(jwtExpiring('2026-09-21T00:00:00Z'), 'user-1');

    expect(log.mock.calls.flat().join(' ')).toContain('subscribers=1');
  });
});

describe('this module stays free of I/O', () => {
  it('exports only the slot, with no network or filesystem surface', async () => {
    // It sits on the hot path of every authenticated request. The moment it
    // grows a side effect, an auth check starts depending on something that can
    // hang — so the absence of one is worth asserting rather than assuming.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'sessionTokenCache.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/\bimport\b.*\b(axios|node-fetch|fs|http|https)\b/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
  });
});
