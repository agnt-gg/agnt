import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';
import { SESSION } from '@/store/auth/userAuth.js';

let store = null;
let router = null;

/**
 * Is this a rejection minted by OUR auth middleware, from OUR backend?
 *
 * Deliberately narrow on both axes, because the cost of a false positive is
 * throwing a working user out of the app:
 *
 *   - the SHAPE must be the one `authenticateToken` produces, identified by
 *     its `reason` discriminator ('missing' | 'invalid'). A 401 relayed from
 *     an upstream LLM provider whose API key is wrong is also a 401, and it
 *     says nothing whatsoever about the user's session.
 *   - the ORIGIN must be BASE_URL, the backend serving this app's data.
 *     api.agnt.gg has its own authority and its own handling in fetchUserData.
 *
 * The backend contract this depends on is pinned by
 * backend/src/routes/authStatus.contract.test.js, so the two cannot drift
 * apart silently.
 */
function isOurSessionRejection(error) {
  const res = error?.response;
  if (!res || res.status !== 401) return false;
  const url = error.config?.url || '';
  // Relative URLs are same-origin, which in this app IS the data backend.
  const sameBackend = url.startsWith(API_CONFIG.BASE_URL) || url.startsWith('/api/');
  if (!sameBackend) return false;
  return res.data?.reason === 'missing' || res.data?.reason === 'invalid';
}

/**
 * Initialize the axios interceptor with the Vuex store
 * @param {Object} vuexStore - The Vuex store instance
 * @param {Object} [routerInstance] - Vue router, used to bounce on a dead session
 */
export function initializeAxiosInterceptor(vuexStore, routerInstance = null) {
  store = vuexStore;
  router = routerInstance;

  // Response interceptor to catch 429 errors
  axios.interceptors.response.use(
    (response) => {
      // If response is successful, check if we should clear rate limit
      if (store) {
        store.dispatch('theme/clearRateLimitIfExpired');
      }
      return response;
    },
    (error) => {
      // A dead session, discovered by a request that is not the auth probe.
      //
      // The gate in the router runs at navigation time; a token can be revoked
      // or expire while the user sits on a page that never navigates again.
      // Without this the app keeps rendering an authenticated shell over a
      // stream of 401s -- which is the same lie as before, just arrived at
      // later. First rejection wins: a burst of parallel requests all failing
      // at once must produce ONE logout, not twenty.
      if (store && isOurSessionRejection(error)) {
        const already = store.state.userAuth.sessionState === SESSION.INVALID;
        if (!already) {
          const detail = {
            from: router?.currentRoute?.value?.path || null,
            reason: 'http_401',
            status: 401,
            detail: error.response.data?.error || null,
            timestamp: Date.now(),
          };
          console.warn('[auth] backend rejected the session mid-flight - signing out', detail);
          store.commit('userAuth/SET_AUTH_FAILURE', detail);
          store.dispatch('userAuth/logout');
          window.dispatchEvent(new CustomEvent('auth-redirect', { detail }));
          // Leave any protected screen. The guard would catch this on the next
          // navigation, but "the next navigation" may never come.
          const path = router?.currentRoute?.value?.path || '';
          const lite = path === '/m' || path.startsWith('/m/');
          router?.push({ path: lite ? '/m' : '/settings' }).catch(() => {
            /* redundant navigation is fine */
          });
        }
      }

      // Check if it's a 429 error
      if (error.response && error.response.status === 429) {
        console.warn('Rate limit exceeded:', error.response.data);

        // Extract rate limit info from response
        const rateLimitInfo = {
          resetAt: error.response.data.resetAt || null,
          limit: error.response.data.limit || null,
          window: error.response.data.window || null,
          currentPlan: error.response.data.currentPlan || 'free',
          message: error.response.data.message || 'Rate limit exceeded',
        };

        // Dispatch to Vuex store
        if (store) {
          store.dispatch('theme/setRateLimited', rateLimitInfo);
        }
      }

      // Always reject the error so it can be handled by the calling code
      return Promise.reject(error);
    }
  );

  console.log('✅ Axios rate limit interceptor initialized');
}

/**
 * Manually trigger rate limit state (for testing)
 * @param {Object} info - Rate limit info object
 */
export function triggerRateLimit(info = {}) {
  if (store) {
    const rateLimitInfo = {
      resetAt: info.resetAt || Date.now() + 60 * 60 * 1000, // 1 hour from now
      limit: info.limit || 1000,
      window: info.window || 'hour',
      currentPlan: info.currentPlan || 'free',
      message: info.message || 'Rate limit exceeded (test)',
    };
    store.dispatch('theme/setRateLimited', rateLimitInfo);
  }
}
