/**
 * FINISH A "CONTINUE WITH GOOGLE" SIGN-IN IN THE WINDOW THAT STARTED IT.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 * ---------------------------------------------------------------------------
 * `connectGoogle()` in LoginSection.vue opens a 600x700 popup at
 * `<REMOTE>/users/auth/google?redirectUrl=<origin>/settings`, and then listens
 * on its own window for a `google-auth-success` message.
 *
 * Nothing ever sent that message. It has been dead code since it was written:
 * a repo-wide search finds the listener and no sender.
 *
 * The remote does not hand the token back to the opener. It redirects the
 * POPUP to `<origin>/settings?token=...`, and that URL is the whole
 * application. So the popup booted a second copy of AGNT, adopted the token
 * from its own address bar, verified it and navigated to the chat — inside a
 * 600x700 window with no chrome. The window the user started from was never
 * told anything and sat on the sign-in screen.
 *
 * The user ends up working in the popup. That is the reported symptom: "AGNT
 * opens in the sign-in window instead of the main one."
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIX GOES HERE AND NOT IN A COMPONENT
 * ---------------------------------------------------------------------------
 * A window that exists only to carry a token back must not mount an app. If
 * this ran from a mounted component the entire SPA would render in the popup
 * before it closed — the user would watch a second AGNT flash up and vanish,
 * and every request that render issued would be real.
 *
 * So it runs at module scope in main.js, before `createApp`.
 *
 * ---------------------------------------------------------------------------
 * ORDERING: THIS MUST RUN BEFORE adoptTokenFromUrl()
 * ---------------------------------------------------------------------------
 * `store/auth/urlSessionToken.js` reads `?token=` and then STRIPS it from the
 * address bar via `history.replaceState`, so that a live credential does not
 * leak into browser history or into the `Referer` header. That is correct, and
 * it means the token is readable exactly once. Whichever of the two runs first
 * is the one that gets it.
 *
 * If adoption ran first, this function would find an empty query string, the
 * popup would sign itself in, and the bug would be exactly as it was. The
 * order is asserted mechanically in googleAuthPopup.spec.js, in the same way
 * and for the same reason as the rest of the boot sequence.
 */

/** The message type LoginSection.vue's opener-side listener waits for. */
export const GOOGLE_AUTH_SUCCESS = 'google-auth-success';

/**
 * If this document is a Google-auth popup on its return leg, give the token to
 * the opener and close.
 *
 * @param {Window} win  Injectable for tests; defaults to the real window.
 * @returns {boolean}   true when the handoff happened and the caller must NOT
 *                      boot the app. false means "this is an ordinary page
 *                      load" — including the genuine redirect flow, where
 *                      there is no opener and boot signs in normally.
 */
export function forwardGoogleAuthToOpener(win = globalThis.window) {
  if (!win) return false;

  // No opener means this is not a popup. That is the redirect flow — the path
  // taken when the browser blocks popups — and signing in right here is the
  // correct behaviour, not the bug. Returning false hands it to
  // adoptTokenFromUrl untouched.
  const opener = win.opener;
  if (!opener || opener === win) return false;

  let token = null;
  try {
    token = new URLSearchParams(win.location.search).get('token');
  } catch {
    return false;
  }

  // A popup with no token: the OAuth leg is still in flight, or an error came
  // back. Either way there is nothing to forward.
  if (!token) return false;

  try {
    // targetOrigin is OUR origin and never '*'. The opener is same-origin by
    // construction, and a session token must not be readable by whatever else
    // that window may have navigated to in the meantime.
    opener.postMessage({ type: GOOGLE_AUTH_SUCCESS, token }, win.location.origin);
  } catch {
    // The opener was closed, or is otherwise unreachable. Report "not handled"
    // so the caller boots normally and the user is still signed in — in this
    // window, which is the old behaviour and strictly better than stranding
    // them in a popup nobody is listening to.
    return false;
  }

  try {
    win.close();
  } catch {
    /* close() is a request, not a guarantee; main.js handles a refusal */
  }

  return true;
}
