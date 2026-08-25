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
 * THE NULL-SOURCE ABSTENTION, AND HOW FAR IT IS ALLOWED TO REACH.
 *
 * `isTrustedAuthMessage` refuses a message only when a DIFFERENT sender is
 * positively identified. When `event.source` is null it abstains rather than
 * rejects, because this popup calls `postMessage` and then `close()`
 * immediately: by delivery the sender may already be discarded, and the HTML
 * spec permits a null `source` for exactly that case. Refusing there would
 * reject the LEGITIMATE message and lock that user out of signing in — worse
 * than the attack being defended against, on a path CI cannot exercise.
 *
 * That is a deliberate weakening of a security check, so its EDGES are what
 * need pinning, not its happy path. Two properties have to hold, and only the
 * first of them is obvious:
 *
 *   1. a message that cannot be attributed is still allowed through
 *   2. the abstention is NARROW - it excuses a sender from the identity check
 *      and from nothing else
 *
 * The second is the one that would actually hurt. An abstention written as an
 * early `if (!event.source) return true;` reads almost identically, passes
 * every test in the block above, and hands any CROSS-ORIGIN sender a way to
 * skip the origin check by the simple trick of not being identifiable. These
 * tests exist to make that refactor fail loudly.
 */
describe('isTrustedAuthMessage: the boundaries of the null-source abstention', () => {
  const ORIGIN = 'https://tenant.example.com';
  const win = { location: { origin: ORIGIN } };
  const popup = { name: 'the popup we opened' };

  describe('a sender that cannot be attributed is allowed through', () => {
    // Engines disagree on how an unattributable sender is reported, and the
    // difference is not observable from here, so both spellings must behave
    // the same. `null` is what the HTML spec calls for; `undefined` is what a
    // synthetic or proxied event can carry.
    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('abstains on a %s source', (_label, source) => {
      expect(isTrustedAuthMessage({ origin: ORIGIN, source }, popup, win)).toBe(true);
    });

    it('abstains for a popup the browser has already closed', () => {
      // The real sequence this exists for: the popup posts, closes itself, and
      // the message is delivered afterwards with nothing left to attribute it
      // to. The handle we still hold reports `closed`.
      const closedPopup = { name: 'the popup we opened', closed: true };

      expect(isTrustedAuthMessage({ origin: ORIGIN, source: null }, closedPopup, win)).toBe(true);
    });

    it('abstains when the origin is empty AND the sender is gone', () => {
      // Both known quirks at once: Electron reports an empty origin across
      // this window boundary, and the sender has been discarded. Neither is
      // evidence of an attack, and together they must not add up to one.
      expect(isTrustedAuthMessage({ origin: '', source: null }, popup, win)).toBe(true);
    });
  });

  describe('the abstention excuses the identity check and nothing else', () => {
    it('still refuses a cross-origin sender that has no identifiable source', () => {
      // THE LOAD-BEARING TEST. If the null-source case is ever moved ahead of
      // the origin check, this is the hole it opens: a hostile frame stops
      // being refused the moment it stops being identifiable, which is not a
      // property an attacker has to work for.
      const event = { origin: 'https://evil.example.net', source: null };

      expect(isTrustedAuthMessage(event, popup, win)).toBe(false);
    });

    it('still refuses a cross-origin sender whose source is undefined', () => {
      const event = { origin: 'https://evil.example.net', source: undefined };

      expect(isTrustedAuthMessage(event, popup, win)).toBe(false);
    });

    it('does not extend to a sender that IS identifiable', () => {
      // Tolerating the unattributable must not soften the case the check was
      // written for. A frame that can be seen, and is not ours, is refused.
      const artifactFrame = { name: 'an allow-same-origin srcdoc iframe' };

      expect(isTrustedAuthMessage({ origin: ORIGIN, source: artifactFrame }, popup, win)).toBe(
        false,
      );
    });

    it('refuses a missing event even though its source is also absent', () => {
      // `undefined.source` is unattributable in the most literal sense. It is
      // still not a reason to sign anybody in.
      expect(isTrustedAuthMessage(null, popup, win)).toBe(false);
    });
  });

  /**
   * The whole abstention rests on one claim: a sender that is still alive can
   * always be seen, so nothing an attacker controls reaches the abstaining
   * branch. If any live-window shape could arrive with a falsy `source`, the
   * abstention would be a bypass rather than a concession.
   *
   * This asserts the claim across every shape a hostile sender could plausibly
   * take in this app, rather than trusting the single object literal used
   * above.
   */
  describe('every identifiable sender that is not our popup is refused', () => {
    it.each([
      ['an artifact preview iframe', { tag: 'iframe', sandbox: 'allow-scripts allow-same-origin' }],
      ['a custom widget iframe', { tag: 'iframe', srcdoc: '<script>...</script>' }],
      ['a second popup the app opened', { name: 'some-other-popup' }],
      ['the top-level window itself', { self: 'window', top: true }],
      ['an object impersonating our popup by name', { name: 'the popup we opened' }],
    ])('refuses %s', (_label, source) => {
      // The last case matters most: identity here is reference equality, not a
      // name or any other forgeable property.
      expect(isTrustedAuthMessage({ origin: ORIGIN, source }, popup, win)).toBe(false);
    });

    it('accepts only the exact window object we opened', () => {
      expect(isTrustedAuthMessage({ origin: ORIGIN, source: popup }, popup, win)).toBe(true);

      // A structural clone of it is a different window.
      expect(isTrustedAuthMessage({ origin: ORIGIN, source: { ...popup } }, popup, win)).toBe(false);
    });
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
