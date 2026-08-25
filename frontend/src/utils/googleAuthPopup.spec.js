/**
 * A SIGN-IN MUST FINISH IN THE WINDOW THAT STARTED IT.
 *
 * The reason this defect survived so long is that nothing about it looks like
 * a failure. The popup signed the user in perfectly — verified the token,
 * loaded the workspace, navigated to the chat. It just did all of that in a
 * 600x700 window with no chrome, while the window the user had been looking at
 * stayed on the sign-in screen. Every unit that could have caught it was
 * passing, because every unit did its job.
 *
 * So these tests are written against the DECISION, in isolation: given an
 * opener and a token, hand it over and close; given no opener, do nothing and
 * let the page boot. Both halves are load-bearing. The false branch is the
 * redirect flow — the path taken when a browser blocks popups — and a fix that
 * broke it would lock those users out entirely while looking correct here.
 *
 * The ordering against `adoptTokenFromUrl` is asserted mechanically against
 * main.js source, in the same way and for the same reason as the rest of the
 * boot sequence: both read the same single-use `?token=`, the loser of that
 * race silently restores the original bug, and no unit test of either function
 * can see it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  forwardGoogleAuthToOpener,
  isTrustedAuthMessage,
  GOOGLE_AUTH_SUCCESS,
} from './googleAuthPopup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const makeWin = ({ search = '', opener = null, origin = 'https://tenant.example.com' } = {}) => ({
  opener,
  close: vi.fn(),
  location: { search, origin },
});

const makeOpener = () => ({ postMessage: vi.fn() });

describe('forwardGoogleAuthToOpener', () => {
  let opener;

  beforeEach(() => {
    opener = makeOpener();
  });

  it('hands the token to the opener and closes the popup', () => {
    const win = makeWin({ search: '?token=header.payload.signature', opener });

    const handled = forwardGoogleAuthToOpener(win);

    expect(handled).toBe(true);
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: GOOGLE_AUTH_SUCCESS, token: 'header.payload.signature' },
      'https://tenant.example.com',
    );
    expect(win.close).toHaveBeenCalled();
  });

  it('never posts a token to a wildcard origin', () => {
    // '*' would publish a live session token to whatever the opener had
    // navigated to by then.
    const win = makeWin({ search: '?token=header.payload.signature', opener });

    forwardGoogleAuthToOpener(win);

    expect(opener.postMessage.mock.calls[0][1]).not.toBe('*');
  });

  it('leaves the redirect flow alone when there is no opener', () => {
    // A real page load, which must go on to boot and adopt the token here.
    // This is the popup-blocked path; breaking it would lock those users out.
    const win = makeWin({ search: '?token=header.payload.signature', opener: null });

    expect(forwardGoogleAuthToOpener(win)).toBe(false);
    expect(win.close).not.toHaveBeenCalled();
  });

  it('does nothing in a popup that is not carrying a token', () => {
    const win = makeWin({ search: '', opener });

    expect(forwardGoogleAuthToOpener(win)).toBe(false);
    expect(opener.postMessage).not.toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
  });

  it('ignores a window that is its own opener', () => {
    const win = makeWin({ search: '?token=header.payload.signature' });
    win.opener = win;

    expect(forwardGoogleAuthToOpener(win)).toBe(false);
    expect(win.close).not.toHaveBeenCalled();
  });

  it('reports "not handled" when the opener is gone, so the app still boots', () => {
    const dead = {
      postMessage: vi.fn(() => {
        throw new Error('opener is closed');
      }),
    };
    const win = makeWin({ search: '?token=header.payload.signature', opener: dead });

    // False here is what puts the user in a working app rather than a blank
    // popup that nobody is listening to.
    expect(forwardGoogleAuthToOpener(win)).toBe(false);
    expect(win.close).not.toHaveBeenCalled();
  });

  it('still reports handled when the browser refuses to close the window', () => {
    const win = makeWin({ search: '?token=header.payload.signature', opener });
    win.close = vi.fn(() => {
      throw new Error('close blocked');
    });

    // The token was delivered, so the opener is signing in. main.js carries the
    // fallback for a window that is still standing afterwards.
    expect(forwardGoogleAuthToOpener(win)).toBe(true);
    expect(opener.postMessage).toHaveBeenCalled();
  });

  it('survives being called with no window at all', () => {
    expect(forwardGoogleAuthToOpener(undefined)).toBe(false);
  });
});

/**
 * WHO IS ALLOWED TO COMPLETE A SIGN-IN.
 *
 * The origin check that shipped first is not sufficient, and the gap is
 * reachable in this application rather than theoretical: artifact previews and
 * custom widgets are rendered in `allow-scripts allow-same-origin` iframes
 * with authored HTML in `srcdoc`, so that content runs at the app's own
 * origin. On an origin check alone it could post its own token and be
 * believed, moving the user into someone else's account without any visible
 * change.
 */
describe('isTrustedAuthMessage', () => {
  const win = { location: { origin: 'https://tenant.example.com' } };
  const popup = { name: 'the popup we opened' };

  it('accepts the popup we opened', () => {
    const event = { origin: 'https://tenant.example.com', source: popup };

    expect(isTrustedAuthMessage(event, popup, win)).toBe(true);
  });

  it('refuses a same-origin artifact iframe posing as the popup', () => {
    // The Copilot finding, verbatim: right origin, wrong window.
    const artifactFrame = { name: 'an allow-same-origin srcdoc iframe' };
    const event = { origin: 'https://tenant.example.com', source: artifactFrame };

    expect(isTrustedAuthMessage(event, popup, win)).toBe(false);
  });

  it('refuses a cross-origin sender', () => {
    const event = { origin: 'https://evil.example.net', source: popup };

    expect(isTrustedAuthMessage(event, popup, win)).toBe(false);
  });

  it('tolerates an empty origin, which Electron reports across this boundary', () => {
    const event = { origin: '', source: popup };

    expect(isTrustedAuthMessage(event, popup, win)).toBe(true);
  });

  it('abstains when the sender cannot be identified at all', () => {
    // The popup closes itself immediately after posting, and an engine that
    // has already discarded it can report `source: null`. Refusing here would
    // lock those users out of signing in entirely — a worse failure than the
    // one being defended against, and this abstention does not reopen it:
    // a live frame always has a source, so the spoof above is still refused.
    const event = { origin: 'https://tenant.example.com', source: null };

    expect(isTrustedAuthMessage(event, popup, win)).toBe(true);
  });

  it('abstains when the popup handle is missing', () => {
    // Nothing to compare against; the origin check is all that is left.
    const event = { origin: 'https://tenant.example.com', source: { some: 'window' } };

    expect(isTrustedAuthMessage(event, null, win)).toBe(true);
  });

  it('refuses a missing event outright', () => {
    expect(isTrustedAuthMessage(undefined, popup, win)).toBe(false);
  });
});

/**
 * The handoff and `adoptTokenFromUrl` both read `?token=`, and adoption strips
 * it from the address bar so it cannot leak into history or a Referer header.
 * That makes it single-use. If adoption runs first the popup keeps the token,
 * signs itself in, and the reported bug is back — with every unit test in this
 * file still green.
 */
describe('boot order in main.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

  // The comments in main.js name these functions while explaining them. Index
  // arithmetic over raw text would match the prose, not the code.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const at = (needle) => {
    const i = code.indexOf(needle);
    expect(i, `expected to find \`${needle}\` in main.js`).toBeGreaterThan(-1);
    return i;
  };

  it('forwards the token to the opener before adoption strips it from the URL', () => {
    expect(at('forwardGoogleAuthToOpener()')).toBeLessThan(at('adoptTokenFromUrl(store)'));
  });

  it('decides before anything mounts', () => {
    // A window that exists only to carry a token back must not render an app.
    expect(at('forwardGoogleAuthToOpener()')).toBeLessThan(at('app.mount('));
  });

  it('does not mount unconditionally', () => {
    // The guard is the whole fix. A bare `app.mount('#app');` here would mean
    // the popup boots a second AGNT again.
    expect(code).toMatch(/if\s*\(\s*!isGoogleAuthHandoff\s*\)\s*\{\s*app\.mount\(/);
  });
});
