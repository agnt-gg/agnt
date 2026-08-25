/**
 * A SIGN-IN POPUP HANDS ITS TOKEN BACK AND CLOSES. IT DOES NOT BECOME AGNT.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 * ---------------------------------------------------------------------------
 * `connectGoogle()` opens a 600x700 popup at the API's Google endpoint, passing
 * `redirectUrl=<our origin>/settings`. For every deployment that is NOT the
 * desktop app — Docker, a self-hosted VPS, a hosted tenant, anything reached
 * through a browser — the API finishes by redirecting that popup to:
 *
 *     <our origin>/settings?token=eyJ...
 *
 * which is the application. So the popup boots a SECOND, COMPLETE COPY of AGNT
 * inside a 600x700 chromeless window, adopts the token from its own address
 * bar, verifies it, and navigates to the chat. The window the user started
 * from is never told anything and sits on the sign-in screen.
 *
 * The user ends up working inside the popup. That is the reported symptom:
 * "signing in opens a second AGNT".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS AT MODULE SCOPE IN main.js
 * ---------------------------------------------------------------------------
 * A window that exists only to carry a token back must not mount an app. Run
 * from a mounted component, the entire SPA would render in the popup before it
 * closed — a second AGNT flashing up and vanishing, with every request that
 * render issued being real.
 *
 * It must also run BEFORE `adoptTokenFromUrl`, which strips `?token=` from the
 * address bar. The token is readable exactly once and whichever of the two
 * runs first is the one that gets it.
 *
 * ---------------------------------------------------------------------------
 * WHY A MISSING OPENER FALLS THROUGH INSTEAD OF FAILING
 * ---------------------------------------------------------------------------
 * `?token=` in the URL is ALSO the normal, supported way a hosted tenant hands
 * a session to a browser that navigated to it directly — no popup, no opener.
 * That flow must keep working exactly as it does today, so the absence of an
 * opener is not an error here: it is the signal that this is an ordinary page
 * load, and boot continues untouched.
 *
 * The presence of an opener is what distinguishes "I am a popup someone is
 * waiting on" from "I am the tab the user is looking at".
 *
 * ---------------------------------------------------------------------------
 * WHY A CROSS-ORIGIN OPENER IS DECLINED RATHER THAN POSTED TO
 * ---------------------------------------------------------------------------
 * `targetOrigin` here is OUR origin and never `'*'`. A session token must not
 * be readable by whatever else the opener may have navigated to, and `'*'`
 * would hand it to exactly that.
 *
 * A consequence worth stating: if some other site opens this URL with a token
 * of its own choosing, its window is cross-origin, the post would be dropped
 * silently by the browser, and closing the window would strand the user with
 * no explanation. So an opener we cannot confirm is same-origin is declined,
 * and boot proceeds normally — the status quo, rather than a new silent
 * failure.
 */

import { looksLikeJwt } from '@/store/auth/urlSessionToken.js';

/**
 * The message type the sign-in screen already listens for.
 *
 * Deliberately unchanged. The API's desktop callback page posts this exact
 * type today, from its own origin, and that path is live in production — a new
 * name here would be a name only one of the two senders knows.
 */
export const SESSION_HANDOFF_MESSAGE = 'google-auth-success';

/**
 * Is the opener a window we are allowed to hand a token to?
 *
 * Reading `location.origin` across a cross-origin boundary throws, which is
 * the check: if we can read it and it matches, the opener is ours.
 */
function openerIsSameOrigin(win, opener) {
  try {
    return opener.location.origin === win.location.origin;
  } catch {
    return false;
  }
}

/**
 * If this document is a sign-in popup carrying a token, give the token to the
 * window that opened it and close.
 *
 * @param {Window} [win] injectable for tests
 * @returns {boolean} true when this document handed off and must NOT boot
 */
export function handOffSessionTokenToOpener(win = globalThis.window) {
  if (!win) return false;

  let token = null;
  try {
    token = new URLSearchParams(win.location?.search || '').get('token');
  } catch {
    // A hostile or exotic URL must not take the whole app down. Falling
    // through costs a sign-in; throwing here costs boot.
    return false;
  }

  if (!token) return false;

  // Structural only — the backend verifies the signature and nothing here
  // could. It stops a malformed `?token=` from being forwarded and closing the
  // window over it; `adoptTokenFromUrl` already reports and strips those.
  if (!looksLikeJwt(token)) return false;

  const opener = win.opener && win.opener !== win ? win.opener : null;
  if (!opener) return false;

  if (!openerIsSameOrigin(win, opener)) return false;

  try {
    opener.postMessage({ type: SESSION_HANDOFF_MESSAGE, token }, win.location.origin);
  } catch {
    // The opener went away between the checks above and here. Boot normally
    // rather than closing a window whose token reached nobody.
    return false;
  }

  try {
    win.close();
  } catch {
    /* Closing is best effort; the handoff already happened. */
  }

  return true;
}
