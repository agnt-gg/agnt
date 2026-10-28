import { describe, it, expect, afterEach } from 'vitest';
import {
  runSignIn, getSignIn, finishSignIn, requestSignInWindow, isSignInPending, signInScope, _resetSignIns,
} from './browserSignIn.js';

const USER = 'u1';
const SCOPE = 'conv:abc';
const POLL = 5;
const WALL = { kind: 'sign-in', provider: 'app.example.com', host: 'app.example.com' };
const tick = (ms = POLL * 3) => new Promise((r) => { setTimeout(r, ms); });

/** A page whose state the test scripts: each inspect() takes the next frame, the last one repeats. */
function scriptedOps(frames, extra = {}) {
  let i = 0;
  const calls = { inspect: 0, finish: 0, openWindow: [], closeWindow: 0, restore: [] };
  let windowOpen = false;
  let closeWindowResolve = () => {};
  const ops = {
    canUseWindow: true,
    inspect: async () => { calls.inspect += 1; const f = frames[Math.min(i, frames.length - 1)]; i += 1; return f; },
    finish: async () => { calls.finish += 1; const f = frames[Math.min(i, frames.length - 1)]; return { url: f.url, signInRequired: f.login || undefined }; },
    openWindow: async (url) => { calls.openWindow.push(url); windowOpen = true; },
    windowOpen: () => windowOpen,
    windowClosed: () => new Promise((resolve) => { closeWindowResolve = resolve; }),
    closeWindow: async () => { calls.closeWindow += 1; windowOpen = false; closeWindowResolve(); },
    restore: async (url) => { calls.restore.push(url); return { url, title: 'Dashboard' }; },
    ...extra,
  };
  return {
    ops,
    calls,
    personClosesWindow: () => { windowOpen = false; closeWindowResolve(); },
  };
}

const start = (ops, overrides = {}) => runSignIn({
  userId: USER, scope: SCOPE, url: 'https://app.example.com/login', initialLogin: WALL, pollMs: POLL, ops, ...overrides,
});

afterEach(() => _resetSignIns());

describe('runSignIn — signing in here (the live card)', () => {
  it('finishes by itself once the page stops being a sign-in, and reports signed in', async () => {
    const { ops, calls } = scriptedOps([
      { url: 'https://app.example.com/login', login: WALL },
      { url: 'https://app.example.com/login', login: WALL },
      { url: 'https://app.example.com/home', login: null },
    ]);
    const result = await start(ops);
    expect(result).toMatchObject({ outcome: 'signed-in', signedIn: true, mode: 'here', error: null });
    expect(calls.finish).toBe(1);
    expect(calls.openWindow).toEqual([]);
    expect(isSignInPending(USER, SCOPE)).toBe(false);
  });

  it('a single clear frame mid-redirect does not count — it must stay clear', async () => {
    const { ops, calls } = scriptedOps([
      { url: 'https://app.example.com/login', login: WALL },
      { url: 'https://app.example.com/sso/callback', login: null },
      { url: 'https://idp.example.com/mfa', login: WALL },
      { url: 'https://app.example.com/home', login: null },
    ]);
    const result = await start(ops);
    expect(result.outcome).toBe('signed-in');
    // wall, clear(1), wall(reset), clear(1), clear(2) → five looks, not two.
    expect(calls.inspect).toBeGreaterThanOrEqual(5);
  });

  it('an OAuth consent screen is still the person\'s step, not "signed in"', async () => {
    const consent = { kind: 'consent', provider: 'Google', host: 'accounts.google.com' };
    const { ops, calls } = scriptedOps([
      { url: 'https://accounts.google.com/signin/oauth/id', login: consent },
      { url: 'https://accounts.google.com/signin/oauth/id', login: consent },
      { url: 'https://app.example.com/home', login: null },
    ]);
    const result = await start(ops, { initialLogin: null });
    expect(result.outcome).toBe('signed-in');
    expect(calls.inspect).toBeGreaterThanOrEqual(4);
  });

  it('a page that never was a wall waits for the person to press Done', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/', login: null }]);
    const run = start(ops, { initialLogin: null });
    await tick();
    expect(getSignIn(USER, SCOPE)).toMatchObject({ status: 'waiting', mode: 'here', host: 'app.example.com' });
    expect(finishSignIn(USER, SCOPE, 'done')).toBe(true);
    expect(await run).toMatchObject({ outcome: 'signed-in', signedIn: true });
  });

  it('Done on a page that still wants a password reports not signed in — the truth, not the button', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const run = start(ops);
    await tick();
    finishSignIn(USER, SCOPE, 'done');
    expect(await run).toMatchObject({ outcome: 'not-signed-in', signedIn: false });
  });

  it('moves to the window by itself when the provider refuses the automated browser', async () => {
    const refused = { kind: 'rejected-browser', provider: 'Google', host: 'accounts.google.com', window: true };
    const { ops, calls, personClosesWindow } = scriptedOps([{ url: 'https://accounts.google.com/v3/signin/rejected', login: refused }]);
    const run = start(ops, { url: 'https://accounts.google.com/v3/signin/identifier' });
    await tick();
    expect(calls.openWindow).toEqual(['https://accounts.google.com/v3/signin/identifier']);
    expect(getSignIn(USER, SCOPE)).toMatchObject({ mode: 'window', status: 'window' });
    personClosesWindow();
    const result = await run;
    expect(result).toMatchObject({ outcome: 'signed-in', mode: 'window' });
    expect(calls.restore).toEqual(['https://accounts.google.com/v3/signin/identifier']);
  });

  it('the person can ask for the window instead', async () => {
    const { ops, calls } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const run = start(ops);
    await tick();
    expect(requestSignInWindow(USER, SCOPE)).toBe(true);
    await tick();
    expect(calls.openWindow).toHaveLength(1);
    finishSignIn(USER, SCOPE, 'done');
    const result = await run;
    // Done while the window is open closes it politely and brings the automation browser back.
    expect(calls.closeWindow).toBe(1);
    expect(calls.restore).toHaveLength(1);
    expect(result.outcome).toBe('signed-in');
  });

  it('never offers the window on a surface that cannot use it (the canvas widget)', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }], { canUseWindow: false });
    const run = start(ops);
    await tick();
    expect(requestSignInWindow(USER, SCOPE)).toBe(false);
    finishSignIn(USER, SCOPE, 'cancelled');
    await run;
  });
});

describe('runSignIn — the window', () => {
  it('starts in the window when asked, finishes when the person closes it, restores the page', async () => {
    const { ops, calls, personClosesWindow } = scriptedOps([{ url: 'x', login: null }]);
    const run = start(ops, { mode: 'window', url: 'https://accounts.google.com/v3/signin/identifier' });
    await tick();
    expect(calls.inspect).toBe(0);
    personClosesWindow();
    const result = await run;
    expect(result).toMatchObject({ outcome: 'signed-in', signedIn: true, mode: 'window' });
    expect(calls.closeWindow).toBe(0);
  });

  it('a restored page that still asks for a sign-in is reported honestly', async () => {
    const { ops, personClosesWindow } = scriptedOps([], {
      restore: async (url) => ({ url, signInRequired: WALL }),
    });
    const run = start(ops, { mode: 'window' });
    await tick();
    personClosesWindow();
    expect(await run).toMatchObject({ outcome: 'not-signed-in', signedIn: false });
  });

  it('with nothing to restore (Settings), finishing is "finished", never claimed as signed in', async () => {
    const { ops, personClosesWindow } = scriptedOps([], { restore: null });
    const run = start(ops, { mode: 'window' });
    await tick();
    personClosesWindow();
    expect(await run).toMatchObject({ outcome: 'finished', signedIn: null });
  });

  it('a window that cannot open fails with the reason, and nothing is left pending', async () => {
    const { ops } = scriptedOps([], { openWindow: async () => { throw new Error('profile in use'); } });
    const result = await start(ops, { mode: 'window' });
    expect(result).toMatchObject({ outcome: 'failed', error: 'profile in use' });
    expect(isSignInPending(USER, SCOPE)).toBe(false);
  });

  it('a restore that fails is an error, not a silent success', async () => {
    const { ops, personClosesWindow } = scriptedOps([], { restore: async () => { throw new Error('no browser'); } });
    const run = start(ops, { mode: 'window' });
    await tick();
    personClosesWindow();
    const result = await run;
    expect(result.outcome).toBe('finished');
    expect(result.error).toMatch(/could not be restored.*no browser/);
  });
});

describe('runSignIn — ending without a sign-in', () => {
  it('Cancel ends it, and closes a window that is still open', async () => {
    const { ops, calls } = scriptedOps([], {});
    const run = start(ops, { mode: 'window' });
    await tick();
    expect(finishSignIn(USER, SCOPE, 'cancelled')).toBe(true);
    expect(await run).toMatchObject({ outcome: 'cancelled', signedIn: false });
    expect(calls.closeWindow).toBe(1);
    expect(calls.restore).toHaveLength(1);
  });

  it('stopping the run ends the wait at once', async () => {
    const controller = new AbortController();
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const run = start(ops, { signal: controller.signal, pollMs: 60_000 });
    await tick();
    controller.abort();
    expect(await run).toMatchObject({ outcome: 'stopped', signedIn: false });
  });

  it('gives up at the deadline (clamped to at least 10 seconds)', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const run = start(ops, { timeoutMs: 1 });
    const entry = getSignIn(USER, SCOPE);
    expect(entry.deadline - entry.startedAt).toBe(10_000);
    finishSignIn(USER, SCOPE, 'cancelled');
    await run;
  });

  it('times out when the deadline passes', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const realNow = Date.now;
    const run = start(ops);
    await tick();
    Date.now = () => realNow() + 11 * 60 * 1000;
    try {
      expect(await run).toMatchObject({ outcome: 'timed-out', signedIn: false });
    } finally {
      Date.now = realNow;
    }
  });
});

describe('answers from the card', () => {
  it('a stale button (wrong id) cannot end a newer sign-in', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const run = start(ops);
    await tick();
    expect(finishSignIn(USER, SCOPE, 'done', 'not-the-id')).toBe(false);
    expect(finishSignIn(USER, SCOPE, 'nonsense')).toBe(false);
    const { id } = getSignIn(USER, SCOPE);
    expect(finishSignIn(USER, SCOPE, 'cancelled', id)).toBe(true);
    await run;
  });

  it('another user cannot see or answer it', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const run = start(ops);
    await tick();
    expect(getSignIn('u2', SCOPE)).toBeNull();
    expect(finishSignIn('u2', SCOPE, 'done')).toBe(false);
    finishSignIn(USER, SCOPE, 'cancelled');
    await run;
  });

  it('one sign-in per conversation at a time', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login', login: WALL }]);
    const run = start(ops);
    await tick();
    await expect(start(ops)).rejects.toThrow(/already waiting/);
    finishSignIn(USER, SCOPE, 'cancelled');
    await run;
  });

  it('the public view carries no page content and no endpoint', async () => {
    const { ops } = scriptedOps([{ url: 'https://app.example.com/login?token=abc', login: WALL }]);
    const run = start(ops);
    await tick();
    const view = getSignIn(USER, SCOPE);
    expect(Object.keys(view).sort()).toEqual(['canUseWindow', 'deadline', 'error', 'host', 'id', 'mode', 'provider', 'startedAt', 'status', 'url']);
    finishSignIn(USER, SCOPE, 'cancelled');
    await run;
  });
});

describe('signInScope', () => {
  it('a conversation keys by its lane; anything else shares one scope', () => {
    expect(signInScope('conv:abc')).toBe('conv:abc');
    expect(signInScope(null)).toBe('shared');
  });
});
