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
 * A same-origin channel the handover falls back to when `window.opener` is not
 * reachable.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND CHANNEL AT ALL
 * ---------------------------------------------------------------------------
 * `opener.postMessage` needs the opener relationship to survive the round trip
 * through Google. Today it does, but only just: `accounts.google.com` already
 * sends
 *
 *   cross-origin-opener-policy-report-only: same-origin
 *
 * Report-only means Google is MEASURING the breakage before enforcing it. On
 * the day that header loses its `-report-only`, navigating the popup to
 * accounts.google.com swaps its browsing-context group, `window.opener`
 * becomes permanently null, and a handover built on the opener alone goes
 * silently inert — the popup would boot a second app again, which is the exact
 * bug this file exists to fix. The same COOP change is what broke the
 * `window.closed` polling in Google's own GSI library.
 *
 * Electron is the other unknown: the popup is a separate BrowserWindow created
 * by `setWindowOpenHandler`, and whether the child sees a usable `opener` is
 * not something a unit test here can settle.
 *
 * A BroadcastChannel depends on neither. It is same-origin by construction and
 * carries no relationship to how the window was created, so it works whether
 * or not COOP severs the opener, and regardless of how Electron builds the
 * child window.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A FALLBACK AND NOT THE PRIMARY
 * ---------------------------------------------------------------------------
 * `postMessage` to a specific opener is TARGETED: exactly one window receives
 * the token. A broadcast reaches every same-origin context, which here
 * includes artifact and widget iframes, since those are rendered
 * `allow-scripts allow-same-origin`.
 *
 * That is not a new capability — this application keeps the session token in
 * `localStorage`, which any same-origin script can already read, so a hostile
 * artifact does not need the channel to obtain one. But "no worse than
 * today" is a poor reason to widen a path, so the broadcast only happens when
 * the targeted route is unavailable. In the common case nothing is broadcast
 * at all.
 */
export const GOOGLE_AUTH_CHANNEL = 'agnt-google-auth';

/**
 * Set by the opener immediately before `window.open`, read by the popup on its
 * return leg.
 *
 * THE PROBLEM THIS SOLVES: a popup whose opener COOP has severed and an
 * ordinary redirect into the user's own tab are INDISTINGUISHABLE from inside
 * the document. Both have `window.opener === null` and both arrive at
 * `/settings?token=...`. Broadcasting and closing on that signal alone would
 * mean a popup-blocked user — who is signing in in their real tab — has that
 * tab closed underneath them.
 *
 * So the opener leaves a positive signal instead of the popup guessing.
 * `localStorage` rather than `sessionStorage`, because a session store is only
 * cloned into a same-origin `window.open`, and this popup is navigated
 * cross-origin before it comes back.
 *
 * A stale mark is bounded three ways: a short TTL, the opener clearing it when
 * the flow finishes, and the fact that `window.close()` is a no-op on a window
 * that script did not open — so the worst case of a misread is the one-second
 * mount fallback in main.js, not a lost tab.
 */
const POPUP_MARK_KEY = 'agnt:google-auth-popup-open';
const POPUP_MARK_TTL_MS = 5 * 60 * 1000;

/** localStorage, or null where it is unavailable (private mode, some embeds). */
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Record that this window is about to open a Google auth popup. */
export function markGoogleAuthPopupOpen(storage = defaultStorage()) {
  try {
    storage?.setItem(POPUP_MARK_KEY, String(Date.now()));
  } catch {
    /* a storage that refuses writes just means we fall back to opener-only */
  }
}

/** Forget it, once the flow has finished one way or the other. */
export function clearGoogleAuthPopupMark(storage = defaultStorage()) {
  try {
    storage?.removeItem(POPUP_MARK_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Was a popup opened recently enough that this document is plausibly it? */
function popupMarkIsFresh(storage) {
  try {
    const raw = storage?.getItem(POPUP_MARK_KEY);
    if (!raw) return false;
    const age = Date.now() - Number(raw);
    return Number.isFinite(age) && age >= 0 && age < POPUP_MARK_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * May this `message` event be allowed to complete a sign-in?
 *
 * ---------------------------------------------------------------------------
 * WHY AN ORIGIN CHECK IS NOT ENOUGH
 * ---------------------------------------------------------------------------
 * `event.origin` says the sender is same-origin. It does not say the sender is
 * the popup we just opened, and this application renders authored HTML in
 * iframes that are same-origin by construction:
 *
 *   Artifacts.vue          sandbox="allow-scripts allow-same-origin"
 *   CustomWidgetRenderer   sandbox="allow-scripts allow-same-origin ..."
 *                          :srcdoc="renderedSource"
 *
 * `allow-scripts` together with `allow-same-origin` means that content runs AT
 * the app's real origin. Any artifact or widget could therefore call
 * `parent.postMessage({ type: 'google-auth-success', token }, origin)` and, on
 * an origin check alone, be believed. The user would be moved into whichever
 * account that token belongs to and carry on working there — filing their
 * keys, files and conversations under someone else's login.
 *
 * So the sender's identity is checked, not merely its origin.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A STRICT `event.source === popup`
 * ---------------------------------------------------------------------------
 * A message is only REFUSED when a different sender is positively identified.
 * If `event.source` is null — some engines drop it once the sender has been
 * discarded, and this popup closes itself immediately after posting — the
 * check abstains rather than rejects.
 *
 * That abstention cannot be exploited: a live frame always has a non-null
 * `source`, so the spoof above is refused either way. What it buys is that a
 * quirk of one embedder can never lock a user out of signing in, which a
 * strict identity test would risk for no additional protection. Electron is
 * already known to report an empty `origin` across this same window boundary.
 *
 * @param {MessageEvent} event
 * @param {Window|null}  popup  the handle returned by `window.open`
 * @param {Window}       [win]  injectable for tests
 */
export function isTrustedAuthMessage(event, popup, win = globalThis.window) {
  if (!event) return false;

  // An empty origin is tolerated for the same reason as below: Electron's
  // proxy for a window that is same-origin by construction can report one.
  const expectedOrigin = win?.location?.origin;
  if (event.origin && expectedOrigin && event.origin !== expectedOrigin) return false;

  // A sender we can see, that is not the window we opened, is refused.
  if (popup && event.source && event.source !== popup) return false;

  return true;
}

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
export function forwardGoogleAuthToOpener(win = globalThis.window, options = {}) {
  if (!win) return false;

  const {
    storage = defaultStorage(),
    createChannel = defaultCreateChannel,
    defer = (fn) => setTimeout(fn, 0),
  } = options;

  let token = null;
  try {
    token = new URLSearchParams(win.location.search).get('token');
  } catch {
    return false;
  }

  // No token: the OAuth leg is still in flight, an error came back, or this is
  // an ordinary page load. Nothing to forward either way.
  if (!token) return false;

  // ── Route 1: the opener, when we can still reach it ──────────────────────
  // Targeted delivery to exactly one window. targetOrigin is OUR origin and
  // never '*': the opener is same-origin by construction, and a session token
  // must not be readable by whatever else that window may have navigated to.
  const opener = win.opener && win.opener !== win ? win.opener : null;
  if (opener) {
    let delivered = false;
    try {
      opener.postMessage({ type: GOOGLE_AUTH_SUCCESS, token }, win.location.origin);
      delivered = true;
    } catch {
      /* opener closed or unreachable — fall through to the channel */
    }

    if (delivered) {
      clearGoogleAuthPopupMark(storage);
      try {
        win.close();
      } catch {
        /* close() is a request, not a guarantee; main.js handles a refusal */
      }
      return true;
    }
  }

  // ── Route 2: the same-origin channel ─────────────────────────────────────
  // Only for a window we can POSITIVELY identify as a popup. Without the mark,
  // a document with no opener is indistinguishable from the redirect flow, and
  // broadcasting there would mean closing a tab the user opened themselves.
  if (!popupMarkIsFresh(storage)) return false;

  const channel = createChannel(GOOGLE_AUTH_CHANNEL);
  if (!channel) return false; // no BroadcastChannel: boot normally, old behaviour

  try {
    channel.postMessage({ type: GOOGLE_AUTH_SUCCESS, token });
  } catch {
    return false;
  } finally {
    try {
      channel.close();
    } catch {
      /* already gone */
    }
  }

  clearGoogleAuthPopupMark(storage);

  // Deferred by one task. `postMessage` queues delivery on the receiving
  // contexts rather than this one, so closing immediately should be safe —
  // this costs nothing and removes the question.
  defer(() => {
    try {
      win.close();
    } catch {
      /* main.js mounts after a second if the browser refused */
    }
  });

  return true;
}

/** A BroadcastChannel, or null where the API is unavailable or blocked. */
function defaultCreateChannel(name) {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
  } catch {
    return null;
  }
}
