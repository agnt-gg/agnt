/**
 * WHO MAY COMPLETE A SIGN-IN BY POSTING A MESSAGE.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ORIGIN CHECK IS NOT ENOUGH HERE
 * ---------------------------------------------------------------------------
 * The sign-in screen listens on `window` for a message carrying a session
 * token. `window.addEventListener('message', ...)` is a GLOBAL receiver: it
 * gets every message the window is sent, from anyone able to reach it.
 *
 * An origin check alone cannot settle this one, because AGNT renders authored
 * HTML at its OWN origin:
 *
 *     Artifacts.vue            sandbox="allow-scripts allow-same-origin"
 *     CustomWidgetRenderer.vue sandbox="allow-scripts allow-same-origin"  :srcdoc
 *
 * `allow-scripts` together with `allow-same-origin` means that content runs at
 * the real origin and passes any origin test by construction. So a widget or
 * artifact could post a token of its own and be believed, which signs the user
 * into someone else's account with nothing on screen to indicate it.
 *
 * Sender IDENTITY is the only thing that separates the sign-in popup from a
 * frame we render ourselves.
 *
 * ---------------------------------------------------------------------------
 * THE CASE A `popup &&` GUARD MISSES
 * ---------------------------------------------------------------------------
 * The obvious form of this check is
 *
 *     if (popup && event.source !== popup) return false;
 *
 * and it has a hole: `window.open` returns null when the browser BLOCKS the
 * popup, so with no handle the whole clause short-circuits and every sender is
 * believed — including the artifact iframe the check exists to refuse. A
 * blocked popup is not an exotic state; it is the default for anyone whose
 * browser blocks popups on first use, which is exactly when a user clicks the
 * button a second time.
 *
 * A handle is not the only way to place a sender, though. Artifact and widget
 * iframes are DESCENDANTS of this window, and a popup never is. So with no
 * handle, a sender positively identified as one of our own frames is refused,
 * and a sender that cannot be placed at all is abstained on.
 *
 * That asymmetry is deliberate: refuse what is identified, abstain on what
 * cannot be seen. A quirk of one embedder must not be able to lock a user out
 * of signing in, and a live frame always has a non-null `source`, so the spoof
 * above is refused either way.
 */

/**
 * May this message be allowed to complete a sign-in?
 *
 * @param {MessageEvent} event
 * @param {Window|null}  popup  the handle from `window.open`, or null
 * @param {Window}       [win]  injectable for tests
 * @returns {boolean}
 */
export function isTrustedAuthMessageSender(event, popup, win = globalThis.window) {
  if (!event) return false;

  // A sender we can see, that is not the window we opened, is refused.
  if (popup && event.source && event.source !== popup) return false;

  // No handle to compare against — a blocked popup, or a flow that never used
  // one. A sender that is one of our own frames cannot be the sign-in window.
  if (!popup && event.source && isDescendantFrame(win, event.source)) return false;

  return true;
}

/**
 * Is `candidate` one of this window's descendant frames?
 *
 * Walks children rather than only direct ones: a widget may itself embed
 * something, and a nested document posting to `top` arrives with ITS window as
 * `event.source`, which is not in `win.frames`.
 *
 * Bounded on both depth and total windows visited, so a pathological page can
 * never make a message handler expensive, and a frame tree containing itself
 * returns rather than overflowing. A cross-origin child throws on access,
 * which is caught and treated as "cannot see inside" — the same abstention
 * used everywhere else here.
 */
function isDescendantFrame(win, candidate, maxDepth = 5, budget = { left: 200 }) {
  if (!win || !candidate || maxDepth < 0 || budget.left <= 0) return false;

  let frames;
  try {
    frames = win.frames;
    if (!frames || typeof frames.length !== 'number') return false;
  } catch {
    return false;
  }

  for (let i = 0; i < frames.length; i += 1) {
    if (budget.left-- <= 0) return false;

    let child;
    try {
      child = frames[i];
    } catch {
      continue; // cross-origin child we may not touch
    }

    if (child === candidate) return true;
    if (isDescendantFrame(child, candidate, maxDepth - 1, budget)) return true;
  }

  return false;
}
