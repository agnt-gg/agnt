import axios from 'axios';

let store = null;

/**
 * Initialize the axios interceptor with the Vuex store
 * @param {Object} vuexStore - The Vuex store instance
 */
export function initializeAxiosInterceptor(vuexStore) {
  store = vuexStore;

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
