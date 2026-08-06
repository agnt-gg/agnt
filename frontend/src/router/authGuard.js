/**
 * Navigation guard used by router.beforeEach.
 *
 * Exported as a factory so unit tests can inject a mock store. Lives in its
 * own file (not router/index.js) so importing it for tests does not pull the
 * entire Vue app graph (route components, etc.).
 *
 * Single source of truth for two orthogonal rules:
 *   1. OAuth callback redirect — /settings?code=… → /connectors (preserve query)
 *   2. Auth gating — requiresAuth routes need a CONFIRMED session
 *
 * ---------------------------------------------------------------------------
 * WHAT THE GATE ASKS, AND WHY IT CHANGED
 * ---------------------------------------------------------------------------
 * It used to ask "is there a user object in the store?" and populate one by
 * calling the REMOTE auth server. Both halves were wrong:
 *
 *   - the user object could be manufactured client-side by DECODING the JWT
 *     when the remote was unreachable, so an unverified token walked straight
 *     through this guard into a fully rendered app
 *   - the remote is not the server that holds the data on screen, so its
 *     answer was never binding on the requests the app was about to make
 *
 * It now asks the backend that serves this app's data, through
 * `userAuth/verifySession`, and lets exactly one answer through: VALID.
 * UNKNOWN (offline, 5xx, timeout) is NOT a pass — the whole failure mode being
 * closed is "we could not check, so we assumed yes".
 *
 * When the auth gate trips a redirect, the guard:
 *   - reads `state.userAuth.lastAuthFailure` for the structured reason
 *     populated by fetchUserData (no_token, http_401, http_5xx, etc.)
 *   - logs to console with the reason so admins can grep
 *   - emits a `auth-redirect` window CustomEvent carrying the full failure
 *     record (reason, status, detail, timestamp) so the UI can show a
 *     reason-aware message
 *   - preserves the intended path as ?returnTo so a deep-link can resume
 *   - clears the local token ONLY for definitive rejections (401/403/etc.) —
 *     transient failures (5xx, network, timeout) leave the token alone so
 *     an outage doesn't log everyone out
 *
 * The gate needs a LIVE answer, never a cached one. It gets that structurally:
 * verifySession is deliberately not wrapped in withFreshness, so there is no
 * cache to bypass and no `forceRefresh` flag anyone can forget to pass. (The
 * previous gate called the TTL-cached fetchUserData and had to opt out by
 * hand.) The steady-state cost is nil — a session already VALID is not
 * re-probed — and the cost when it does run is one loopback round trip.
 */
import { isDefinitiveAuthRejection, SESSION } from '@/store/auth/userAuth.js';

export function createAuthGuard(storeInstance) {
  return async (to, from, next) => {
    // OAuth callback to /settings — handoff to /connectors with code intact
    if (to.path === '/settings' && to.query.code) {
      console.log('OAuth callback detected, redirecting to settings page');
      next({
        path: '/connectors',
        query: to.query,
      });
      return;
    }

    if (to.meta.requiresAuth && storeInstance.state.userAuth.sessionState !== SESSION.VALID) {
      try {
        await storeInstance.dispatch('userAuth/verifySession');

        // Re-read from the store rather than trusting the return value: the
        // store is what every other consumer (sidebar, canvas, nav) reads, and
        // a gate that agreed with a return value while disagreeing with the
        // rendered UI would be the same class of bug all over again.
        if (storeInstance.state.userAuth.sessionState === SESSION.VALID) {
          next();
        } else {
          handleAuthFailure(storeInstance, to, next);
        }
      } catch (error) {
        // Defensive: verifySession handles its own errors, but if a future
        // change starts re-throwing we still want a clean bounce rather than
        // an unhandled rejection that leaves navigation hanging — which would
        // strand the user on whatever was already painted.
        const failure = { reason: 'unknown', detail: error?.message || null, timestamp: Date.now() };
        storeInstance.commit('userAuth/SET_AUTH_FAILURE', failure);
        storeInstance.commit('userAuth/SET_SESSION_STATE', SESSION.UNKNOWN);
        console.error(`[router] verifySession threw while navigating to ${to.fullPath}:`, error);
        handleAuthFailure(storeInstance, to, next);
      }
    } else {
      next();
    }
  };
}

function handleAuthFailure(storeInstance, to, next) {
  const failure = storeInstance.state.userAuth.lastAuthFailure || {
    reason: 'unknown',
    timestamp: Date.now(),
  };

  // Only clear the local token on definitive server rejections. Transient
  // failures (5xx, network, timeout) probably mean the token is still valid;
  // logging the user out would punish them for an infra issue they did not
  // cause.
  if (isDefinitiveAuthRejection(failure.reason)) {
    clearStaleAuth(storeInstance);
  }

  // detail.from is user-facing (rendered in the modal copy), so use the
  // bare path — fullPath would leak ?content-id=… and similar internal query
  // noise into messages a human reads. The ?returnTo below DOES use fullPath
  // so deep-link resume after sign-in preserves the original query.
  const detail = { from: to.path, ...failure };
  // Mobile lite has its own pairing home (/m); do not dump users into full
  // Settings, which is unusable on a phone-sized shell.
  //
  // Match on the /m SEGMENT, not the /m PREFIX. startsWith('/m') is true for
  // every route whose name merely begins with the letter m -- /marketplace and
  // /memory both matched, so a desktop session that lapsed on either page
  // landed on the phone pairing screen. A prefix test is not a segment test.
  const bouncePath = isLiteRoute(to) ? '/m' : '/settings';
  console.warn(`[router] auth required for ${to.fullPath} → bouncing to ${bouncePath}`, detail);
  window.dispatchEvent(new CustomEvent('auth-redirect', { detail }));
  next({ path: bouncePath, query: { returnTo: to.fullPath } });
}

/**
 * Does this route belong to the mobile lite shell?
 *
 * Exported so the route-table guard can assert the classification against every
 * declared path rather than re-deriving the rule and drifting from it.
 *
 * @param {{ path?: string, meta?: { lite?: boolean } }} to
 * @returns {boolean}
 */
export function isLiteRoute(to) {
  if (to?.meta?.lite) return true;
  const path = to?.path || '';
  return path === '/m' || path.startsWith('/m/');
}

function clearStaleAuth(storeInstance) {
  storeInstance.commit('userAuth/CLEAR_TOKEN');
  storeInstance.commit('userAuth/SET_USER', null);
}
