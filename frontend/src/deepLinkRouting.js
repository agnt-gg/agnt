/**
 * `agnt://` links, once they reach the running app.
 *
 * THE TWO PATHS, AND WHY THERE ARE TWO
 * ────────────────────────────────────
 * Cold start — no window existed when the link arrived, so main.js loaded the
 * window straight onto the target path. Nothing here runs; the router simply
 * boots at the right URL, and the destination screen reads its own query.
 *
 * Warm — the app was already open. Reloading the whole SPA to change page
 * would throw away every bit of in-memory state (an open chat, an unsaved
 * canvas) to accomplish a navigation, so main.js sends the parsed intent over
 * IPC instead and this pushes it through the router.
 *
 * Both paths end at the same route with the same query, which is the property
 * that makes them testable as one thing: a destination screen never needs to
 * know which way the user arrived.
 *
 * WHAT THIS TRUSTS
 * ────────────────
 * The intent has already been validated in the main process against an
 * allowlist of actions, with unknown parameters dropped. The re-check below is
 * not redundancy for its own sake: this function is reachable from any future
 * caller, and a router that will accept an arbitrary string is one refactor
 * away from accepting `//evil.example` as a protocol-relative URL.
 */

/**
 * @param {import('vue-router').Router} router
 * @returns {() => void} unsubscribe
 */
export function installDeepLinkRouting(router) {
  // Absent in a browser tab and in Docker — there is no Electron bridge there,
  // and no OS handing us URLs either. Feature-detect rather than assume.
  if (typeof window === 'undefined' || !window.electron?.onDeepLink) return () => {};

  return window.electron.onDeepLink((intent) => {
    const path = intent?.path;

    // A single leading slash, and nothing that could read as an origin.
    // `//host` is a protocol-relative URL, not a route.
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      console.warn('[deep-link] renderer refused a malformed path', intent);
      return;
    }

    // Already there, query and all: pushing would be a no-op that vue-router
    // reports as a duplicated-navigation rejection.
    if (router.currentRoute.value.fullPath === path) return;

    router.push(path).catch((err) => {
      // A rejected navigation is normal (a guard bounced it to sign-in, say),
      // and must not surface as an unhandled rejection.
      console.warn('[deep-link] navigation rejected:', err?.message || err);
    });
  });
}
