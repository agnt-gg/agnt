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
 *   - logs to console (warn for no-user, error for fetch-failure)
 *   - emits a `auth-redirect` window CustomEvent with details
 *   - preserves the intended path as ?returnTo so a deep-link can resume
 */
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
          // No user after fetch — redirect to login surface. Surface the bounce
          // so a stranded click (e.g. saved-output → /chat) is not a silent no-op.
          console.warn(`[router] auth required for ${to.fullPath} but no user — redirecting to /settings`);
          window.dispatchEvent(new CustomEvent('auth-redirect', { detail: { from: to.fullPath, reason: 'no-user' } }));
          next({ path: '/settings', query: { returnTo: to.fullPath } });
        } else {
          next();
        }
      } catch (error) {
        console.error(`[router] fetchUserData failed while navigating to ${to.fullPath}:`, error);
        window.dispatchEvent(new CustomEvent('auth-redirect', { detail: { from: to.fullPath, reason: 'fetch-error', error: error?.message } }));
        next({ path: '/settings', query: { returnTo: to.fullPath } });
      }
    } else {
      next();
    }
  };
}
