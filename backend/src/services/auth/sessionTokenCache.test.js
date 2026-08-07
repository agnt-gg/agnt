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
  __resetSessionTokenCacheForTests,
} from './sessionTokenCache.js';

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
