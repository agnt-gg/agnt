/**
 * browser action="signin", end to end through the real state machine
 * (services/browserSignIn.js) with the browser itself replaced: what the page
 * says, and what opening/closing the window does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const calls = [];
const page = { url: 'https://app.example.com/login', login: null };
let windowOpen = false;
let closeWindowNow = () => {};

vi.mock('./ai-browser-act.js', () => ({
  default: {
    resolveSurface: vi.fn(async () => { calls.push('resolveSurface'); return { cdpUrl: 'ws://127.0.0.1:1/devtools/browser/x', kind: 'launched', instanceId: 'host:u1:conv:c1' }; }),
  },
}));
vi.mock('../../../services/browserActDriver.js', () => ({
  performBrowserAction: vi.fn(async (_u, _c, action, params) => {
    calls.push(`${action}${params?.url ? ` ${params.url}` : ''}`);
    if (action === 'navigate') page.url = params.url;
    return { url: page.url, title: 'Page', snapshot: '@e1 button "Go"', ...(page.login ? { signInRequired: page.login } : {}) };
  }),
  inspectBrowserPage: vi.fn(async () => ({ url: page.url, title: 'Page', login: page.login })),
}));
vi.mock('./browserFallbackSurface.js', () => ({
  ensureFallbackSurface: vi.fn(async () => { calls.push('relaunch'); return 'ws://127.0.0.1:2/devtools/browser/y'; }),
  openSignInWindow: vi.fn(async ({ url }) => { calls.push(`openWindow ${url}`); windowOpen = true; }),
  closeSignInWindow: vi.fn(async () => { calls.push('closeWindow'); windowOpen = false; closeWindowNow(); }),
  isSignInWindowOpen: () => windowOpen,
  signInWindowClosed: () => new Promise((resolve) => { closeWindowNow = resolve; }),
}));
vi.mock('../../../services/browserLanes.js', () => ({
  laneFor: (engine) => (engine?.conversationId ? `conv:${engine.conversationId}` : null),
  captureLanePages: vi.fn(async () => { calls.push('captureLanes'); return [{ instanceId: 'host:u2:conv:other', url: 'https://other.example/' }]; }),
  reopenLanes: vi.fn(async (captured, _cdp, { except }) => { calls.push(`reopenLanes except=${except} n=${captured.length}`); return captured.length; }),
}));

const { default: signIn, chooseSignInMode, describeSignIn } = await import('./ai-browser-signin.js');
const { getSignIn, finishSignIn, _resetSignIns } = await import('../../../services/browserSignIn.js');

const chat = (extra = {}) => ({ userId: 'u1', conversationId: 'c1', provider: 'anthropic', ...extra });
const waitFor = async (check) => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('condition never held');
};

beforeEach(() => {
  calls.length = 0;
  page.url = 'https://app.example.com/login';
  page.login = null;
  windowOpen = false;
});
afterEach(() => _resetSignIns());

describe('chooseSignInMode', () => {
  it('Google, Microsoft and Apple go to the window; other sites stay in the live view', () => {
    expect(chooseSignInMode({ login: { window: true }, url: 'https://accounts.google.com/x' })).toBe('window');
    expect(chooseSignInMode({ login: null, url: 'https://appleid.apple.com/' })).toBe('window');
    expect(chooseSignInMode({ login: { window: false }, url: 'https://github.com/login' })).toBe('here');
  });
  it('an explicit request wins — except on the canvas widget, which has its own cookies', () => {
    expect(chooseSignInMode({ requested: 'window', login: null, url: 'https://github.com/login' })).toBe('window');
    expect(chooseSignInMode({ requested: 'here', login: { window: true }, url: 'https://accounts.google.com/' })).toBe('here');
    expect(chooseSignInMode({ requested: 'window', url: 'https://accounts.google.com/', surfaceKind: 'widget' })).toBe('here');
  });
});

describe('describeSignIn', () => {
  it('never says "signed in" unless the page proved it', () => {
    expect(describeSignIn({ outcome: 'signed-in', mode: 'here', page: { url: 'u' } }, { minutes: 10 })).toMatchObject({ success: true, signedIn: true });
    for (const outcome of ['not-signed-in', 'finished', 'cancelled', 'stopped', 'timed-out', 'failed']) {
      expect(describeSignIn({ outcome, mode: 'here', page: null }, { minutes: 10 }).success).toBe(false);
    }
  });
});

describe('browser action="signin"', () => {
  it('refuses in a workflow and says where to sign in instead', async () => {
    const result = await signIn.execute({}, {}, { userId: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Settings › Browser/);
    expect(calls).toEqual([]);
  });

  it('Google: opens the window at the sign-in page, and the conversation carries on signed in once it closes', async () => {
    page.url = 'https://accounts.google.com/v3/signin/identifier?continue=x';
    page.login = { kind: 'sign-in', provider: 'Google', host: 'accounts.google.com', window: true };
    const run = signIn.execute({}, {}, chat());
    await waitFor(() => windowOpen);
    expect(getSignIn('u1', 'conv:c1')).toMatchObject({ mode: 'window', status: 'window', provider: 'Google' });

    // The person signs in and closes the window; Google now lets the page through.
    page.login = null;
    windowOpen = false;
    closeWindowNow();
    const result = await run;

    expect(result).toMatchObject({ success: true, signedIn: true, mode: 'window' });
    expect(result.note).toMatch(/saved in the AGNT browser profile/);
    // Order is the contract: other conversations' pages are captured BEFORE the
    // window takes the profile, and given back after the automation browser returns.
    expect(calls).toEqual([
      'resolveSurface',
      'captureLanes',
      'openWindow https://accounts.google.com/v3/signin/identifier?continue=x',
      'relaunch',
      'reopenLanes except=host:u1:conv:c1 n=1',
      'resolveSurface',
      'navigate https://accounts.google.com/v3/signin/identifier?continue=x',
    ]);
  });

  it('any other site: navigates to url, the person signs in in the live view, done by itself', async () => {
    page.login = { kind: 'sign-in', provider: 'portal.example.com', host: 'portal.example.com', window: false };
    const run = signIn.execute({ url: 'https://portal.example.com/login' }, {}, chat());
    await waitFor(() => getSignIn('u1', 'conv:c1'));
    expect(getSignIn('u1', 'conv:c1')).toMatchObject({ mode: 'here', host: 'portal.example.com' });
    page.url = 'https://portal.example.com/dashboard';
    page.login = null;
    const result = await run;
    expect(result).toMatchObject({ success: true, signedIn: true, mode: 'here', url: 'https://portal.example.com/dashboard' });
    expect(calls).toContain('navigate https://portal.example.com/login');
    expect(calls).not.toContain('captureLanes');
  }, 15000);

  it('stopping the run ends the wait', async () => {
    page.login = { kind: 'sign-in', provider: 'x', host: 'x', window: false };
    const controller = new AbortController();
    const run = signIn.execute({}, {}, chat({ abortSignal: controller.signal }));
    await waitFor(() => getSignIn('u1', 'conv:c1'));
    controller.abort();
    expect(await run).toMatchObject({ success: false, error: expect.stringMatching(/stopped/) });
  });

  it('a second sign-in in the same conversation is refused while one waits', async () => {
    page.login = { kind: 'sign-in', provider: 'x', host: 'x', window: false };
    const first = signIn.execute({}, {}, chat());
    await waitFor(() => getSignIn('u1', 'conv:c1'));
    const second = await signIn.execute({}, {}, chat());
    expect(second.error).toMatch(/already waiting/);
    finishSignIn('u1', 'conv:c1', 'cancelled');
    expect(await first).toMatchObject({ success: false, error: 'The user cancelled the sign-in.' });
  });

  it('a blank tab is not something to sign in to', async () => {
    page.url = 'data:text/html,ready';
    const result = await signIn.execute({}, {}, chat());
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/no web page to sign in to/) });
  });
});
