/**
 * The popup side of a sign-in handoff.
 *
 * The behaviour that matters is not "does it post a message" — it is WHICH
 * documents decide they are a popup at all. Getting that wrong in the other
 * direction breaks the hosted-tenant sign-in, which delivers its token in the
 * URL of an ordinary tab. So the negative cases carry as much weight as the
 * positive one.
 */

import { describe, it, expect, vi } from 'vitest';
import { handOffSessionTokenToOpener, SESSION_HANDOFF_MESSAGE } from './oauthPopupHandoff.js';

const ORIGIN = 'https://tenant.example.com';
const TOKEN = ['eyJhbGciOiJIUzI1NiJ9', 'eyJ1c2VySWQiOiJ1LTEifQ', 'c2lnbmF0dXJl'].join('.');

/** A window carrying `?token=` whose opener is same-origin, i.e. our popup. */
function popupWindow({ token = TOKEN, opener = {}, origin = ORIGIN, openerOrigin = ORIGIN } = {}) {
  const win = {
    location: { search: token === null ? '' : `?token=${token}`, origin },
    close: vi.fn(),
    opener: null,
  };
  if (opener) {
    win.opener = {
      postMessage: vi.fn(),
      // Reading this across a real cross-origin boundary throws; a plain
      // mismatch models an opener that navigated somewhere else.
      location:
        openerOrigin === null
          ? {
              get origin() {
                throw new Error('cross-origin');
              },
            }
          : { origin: openerOrigin },
      ...opener,
    };
  }
  return win;
}

describe('handOffSessionTokenToOpener', () => {
  it('posts the token to the opener and closes', () => {
    const win = popupWindow();

    expect(handOffSessionTokenToOpener(win)).toBe(true);
    expect(win.opener.postMessage).toHaveBeenCalledWith(
      { type: SESSION_HANDOFF_MESSAGE, token: TOKEN },
      ORIGIN,
    );
    expect(win.close).toHaveBeenCalled();
  });

  it('targets our own origin, never a wildcard', () => {
    // A session token must not be readable by whatever else the opener may
    // have navigated to since it opened us.
    const win = popupWindow();
    handOffSessionTokenToOpener(win);

    const [, targetOrigin] = win.opener.postMessage.mock.calls[0];
    expect(targetOrigin).toBe(ORIGIN);
    expect(targetOrigin).not.toBe('*');
  });

  describe('documents that are NOT a handoff popup', () => {
    it('leaves an ordinary page load alone', () => {
      const win = popupWindow({ token: null });
      expect(handOffSessionTokenToOpener(win)).toBe(false);
      expect(win.close).not.toHaveBeenCalled();
    });

    it('leaves a hosted tenant arriving at ?token= by direct navigation alone', () => {
      // THE REGRESSION THIS GUARDS. A tenant hands the session over in the URL
      // of a normal tab. There is no opener, boot must continue, and
      // adoptTokenFromUrl must still get its chance at the token.
      const win = popupWindow({ opener: null });

      expect(handOffSessionTokenToOpener(win)).toBe(false);
      expect(win.close).not.toHaveBeenCalled();
    });

    it('declines an opener that is not same-origin', () => {
      // The post would be dropped silently by the browser, and closing over it
      // would strand the user with no explanation.
      const win = popupWindow({ openerOrigin: null });

      expect(handOffSessionTokenToOpener(win)).toBe(false);
      expect(win.opener.postMessage).not.toHaveBeenCalled();
      expect(win.close).not.toHaveBeenCalled();
    });

    it('declines an opener that has navigated to another origin', () => {
      const win = popupWindow({ openerOrigin: 'https://elsewhere.example' });

      expect(handOffSessionTokenToOpener(win)).toBe(false);
      expect(win.opener.postMessage).not.toHaveBeenCalled();
    });

    it('ignores a malformed token rather than closing over it', () => {
      // adoptTokenFromUrl reports and strips these; forwarding one would close
      // the window and leave the user with nothing to show for it.
      const win = popupWindow({ token: 'not-a-jwt' });

      expect(handOffSessionTokenToOpener(win)).toBe(false);
      expect(win.close).not.toHaveBeenCalled();
    });

    it('ignores a window that is its own opener', () => {
      const win = popupWindow();
      win.opener = win;

      expect(handOffSessionTokenToOpener(win)).toBe(false);
    });
  });

  describe('boot survives a hostile or exotic window', () => {
    it('returns false when the URL cannot be read', () => {
      const win = {
        get location() {
          throw new Error('opaque');
        },
      };
      expect(() => handOffSessionTokenToOpener(win)).not.toThrow();
      expect(handOffSessionTokenToOpener(win)).toBe(false);
    });

    it('returns false when the opener vanishes before the post', () => {
      const win = popupWindow();
      win.opener.postMessage = () => {
        throw new Error('window closed');
      };

      expect(handOffSessionTokenToOpener(win)).toBe(false);
      expect(win.close).not.toHaveBeenCalled();
    });

    it('still reports a handoff when close() is refused', () => {
      // The token already reached the opener. Refusing to close does not undo
      // that, and booting an app on top of it would be worse.
      const win = popupWindow();
      win.close = () => {
        throw new Error('cannot close');
      };

      expect(handOffSessionTokenToOpener(win)).toBe(true);
    });

    it('returns false when there is no window at all', () => {
      expect(handOffSessionTokenToOpener(null)).toBe(false);
      expect(handOffSessionTokenToOpener(undefined)).toBe(false);
    });
  });
});
