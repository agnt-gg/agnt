/**
 * The desktop half of the system-browser sign-in.
 *
 * The property that matters most is the URL handed to the browser: it decides
 * where the API sends the user back, and the API keys its behaviour off that
 * path. Get it wrong and the API takes the old postMessage branch, posts into
 * a window with no opener, and the sign-in fails silently — which is the exact
 * failure being fixed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    BASE_URL: 'http://localhost:3333/api',
    REMOTE_URL: 'https://api.agnt.gg',
  },
}));

const { canUseDesktopSignIn, startDesktopSignIn } = await import('./desktopSignIn.js');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1LTEifQ.c2ln';
const NONCE = 'a'.repeat(64);

function harness({ claims = [] } = {}) {
  const opened = [];
  const win = { electron: { openExternalUrl: (url) => opened.push(url) } };

  let call = 0;
  const http = {
    post: vi.fn(async () => ({ data: { nonce: NONCE } })),
    get: vi.fn(async () => claims[Math.min(call++, claims.length - 1)]),
  };

  return { win, http, opened };
}

// The direct Google URL is still the path for opted-out users and non-production APIs.
const run = (h, over = {}) =>
  startDesktopSignIn({ win: h.win, http: h.http, pollIntervalMs: 1, timeoutMs: 500, bridge: false, ...over });

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}

beforeEach(() => vi.restoreAllMocks());

describe('canUseDesktopSignIn', () => {
  it('is true only when this build can reach the system browser', () => {
    expect(canUseDesktopSignIn({ electron: { openExternalUrl() {} } })).toBe(true);
  });

  it('is false in a team space view, whose hosted instance refuses the loopback handoff', () => {
    expect(canUseDesktopSignIn({ electron: { isSpaceView: true, openExternalUrl() {} } })).toBe(false);
    expect(canUseDesktopSignIn({ electron: { isSpaceView: true } })).toBe(false);
  });

  it('is false in a plain browser', () => {
    // The bridge is simply absent there, which is the correct signal that this
    // whole strategy does not apply.
    expect(canUseDesktopSignIn({})).toBe(false);
    expect(canUseDesktopSignIn({ electron: {} })).toBe(false);
    expect(canUseDesktopSignIn(undefined)).toBe(false);
  });
});

describe('the URL handed to the system browser', () => {
  it('names this backend’s loopback handoff endpoint as the redirect', async () => {
    const h = harness({ claims: [{ status: 200, data: { token: TOKEN } }] });
    await run(h).promise;

    expect(h.opened).toHaveLength(1);
    const url = new URL(h.opened[0]);

    expect(url.origin + url.pathname).toBe('https://api.agnt.gg/users/auth/google');

    const redirect = url.searchParams.get('redirectUrl');
    expect(redirect).toBe(`http://localhost:3333/api/auth/desktop/handoff/${NONCE}`);
  });

  it('carries the path the API branches on', async () => {
    // The API decides between "post to the opener" and "redirect" by looking
    // for this exact path. If it ever changes here it must change there too,
    // and this assertion is the reminder.
    const h = harness({ claims: [{ status: 200, data: { token: TOKEN } }] });
    await run(h).promise;

    const redirect = new URL(h.opened[0]).searchParams.get('redirectUrl');
    expect(redirect).toContain('/api/auth/desktop/handoff/');
  });

  it('percent-encodes the redirect so it survives as one parameter', async () => {
    const h = harness({ claims: [{ status: 200, data: { token: TOKEN } }] });
    await run(h).promise;

    // The raw query must not contain a bare `://` from the inner URL, or
    // everything after it is read as a separate parameter.
    const raw = h.opened[0].split('redirectUrl=')[1];
    expect(raw).not.toContain('://');
    expect(decodeURIComponent(raw)).toContain('://');
  });
});

describe('the agnt.gg sign-in bridge', () => {
  it('enters through agnt.gg with the nonce and the same loopback redirect, and remembers the nonce', async () => {
    const h = harness({ claims: [{ status: 200, data: { token: TOKEN } }] });
    const storage = memoryStorage();
    await run(h, { bridge: true, storage }).promise;

    const url = new URL(h.opened[0]);
    expect(url.origin + url.pathname).toBe('https://agnt.gg/api/journey/desktop-signin');
    expect(url.searchParams.get('nonce')).toBe(NONCE);
    expect(url.searchParams.get('redirect')).toBe(`http://localhost:3333/api/auth/desktop/handoff/${NONCE}`);
    expect(JSON.parse(storage.getItem('agnt_journey_signin_nonce')).nonce).toBe(NONCE);
  });

  it('is the default against production, with consent', async () => {
    const h = harness({ claims: [{ status: 200, data: { token: TOKEN } }] });
    await startDesktopSignIn({ win: h.win, http: h.http, pollIntervalMs: 1, timeoutMs: 500, storage: memoryStorage() }).promise;
    expect(new URL(h.opened[0]).hostname).toBe('agnt.gg');
  });

  it('is not used when the person has opted out, and nothing is remembered', async () => {
    const h = harness({ claims: [{ status: 200, data: { token: TOKEN } }] });
    const storage = memoryStorage({ agnt_analytics_opt_out: '1' });
    await startDesktopSignIn({ win: h.win, http: h.http, pollIntervalMs: 1, timeoutMs: 500, storage }).promise;
    expect(new URL(h.opened[0]).hostname).toBe('api.agnt.gg');
    expect(storage.getItem('agnt_journey_signin_nonce')).toBeNull();
  });

  it('is not used against a development API', async () => {
    const h = harness({ claims: [{ status: 200, data: { token: TOKEN } }] });
    await startDesktopSignIn({ win: h.win, http: h.http, pollIntervalMs: 1, timeoutMs: 500, storage: memoryStorage(), remoteUrl: 'http://localhost:4000' }).promise;
    expect(new URL(h.opened[0]).origin).toBe('http://localhost:4000');
  });
});

describe('waiting for the browser', () => {
  it('returns the token once it arrives', async () => {
    const h = harness({
      claims: [{ status: 204 }, { status: 204 }, { status: 200, data: { token: TOKEN } }],
    });

    await expect(run(h).promise).resolves.toBe(TOKEN);
    expect(h.http.get).toHaveBeenCalledTimes(3);
  });

  it('keeps polling through a dropped request', async () => {
    // A single failed poll is a transport hiccup, not a failed sign-in. The
    // user may already have finished in their browser.
    const h = harness();
    let n = 0;
    h.http.get = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('ECONNRESET');
      return { status: 200, data: { token: TOKEN } };
    });

    await expect(run(h).promise).resolves.toBe(TOKEN);
  });

  it('stops when the sign-in has expired', async () => {
    const h = harness({ claims: [{ status: 404 }] });
    await expect(run(h).promise).rejects.toThrow(/expired/i);
  });

  it('gives up rather than polling forever', async () => {
    const h = harness({ claims: [{ status: 204 }] });
    await expect(run(h, { timeoutMs: 20 }).promise).rejects.toThrow(/timed out/i);
  });

  it('stops when cancelled, and does not resolve afterwards', async () => {
    const h = harness({ claims: [{ status: 204 }] });
    const attempt = run(h, { timeoutMs: 5000 });

    attempt.cancel();

    await expect(attempt.promise).rejects.toThrow(/cancelled/i);
    const callsAtCancel = h.http.get.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(h.http.get.mock.calls.length).toBe(callsAtCancel);
  });

  it('fails clearly when the backend will not start a sign-in', async () => {
    const h = harness();
    h.http.post = vi.fn(async () => ({ data: {} }));

    await expect(run(h).promise).rejects.toThrow(/could not start/i);
    // Nothing was opened, so the user is not left staring at a browser tab
    // that can never complete.
    expect(h.opened).toHaveLength(0);
  });
});
