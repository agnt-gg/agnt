/**
 * Navigation guard used by router.beforeEach.
 *
 * Exported as a factory so unit tests can inject a mock store. Lives in its
 * own file (not router/index.js) so importing it for tests does not pull the
 * entire Vue app graph (route components, etc.).
 *
 * Single source of truth for two orthogonal rules:
 *   1. OAuth callback redirect — /settings?code=… → /connectors (preserve query)
 *   2. Auth gating — requiresAuth routes need store.state.userAuth.user
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
 */
import { isDefinitiveAuthRejection } from '@/store/auth/userAuth.js';

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

    if (to.meta.requiresAuth && !storeInstance.state.userAuth.user) {
      try {
        await storeInstance.dispatch('userAuth/fetchUserData');

        if (!storeInstance.state.userAuth.user) {
          handleAuthFailure(storeInstance, to, next);
        } else {
          next();
        }
      } catch (error) {
        // Defensive: fetchUserData currently swallows its own errors, but if
        // a future change starts re-throwing we still want a clean bounce.
        // Synthesize a failure record so downstream consumers see consistent
        // shape regardless of which path got here.
        const failure = { reason: 'unknown', detail: error?.message || null, timestamp: Date.now() };
        storeInstance.commit('userAuth/SET_AUTH_FAILURE', failure);
        console.error(`[router] fetchUserData threw while navigating to ${to.fullPath}:`, error);
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

  const detail = { from: to.fullPath, ...failure };
  console.warn(`[router] auth required for ${to.fullPath} → bouncing to /settings`, detail);
  window.dispatchEvent(new CustomEvent('auth-redirect', { detail }));
  next({ path: '/settings', query: { returnTo: to.fullPath } });
}

function clearStaleAuth(storeInstance) {
  storeInstance.commit('userAuth/CLEAR_TOKEN');
  storeInstance.commit('userAuth/SET_USER', null);
}
