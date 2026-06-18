import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';
import LicenseValidator from '@/services/LicenseValidator.js';
import { withFreshness } from '../_utils/withFreshness.js';
import { TTL } from '../_utils/freshnessConfig.js';

// All fetch* actions in this module are wrapped with `withFreshness` so the
// second call within the per-action TTL is a no-op. Pass `{ forceRefresh: true }`
// to bypass — required after writes that change the underlying data.

/**
 * Classify an axios error into a structured auth failure record so the router
 * guard can tell the user why their session is no longer trusted, and admins
 * can grep logs by reason. Distinguishes:
 *
 *   - http_401 / http_403 / http_5xx / http_<N>  — server responded
 *   - timeout                                     — request aborted at the timeout
 *   - network_error                               — request never reached the server
 *   - unknown                                     — anything else
 *
 * The caller decides whether each reason warrants clearing the local token.
 * Definitive client-side rejections (401/403/unauthenticated_response/no_token)
 * should clear; transient failures (5xx/network/timeout) should NOT.
 */
export function classifyAuthError(error) {
  const timestamp = Date.now();
  if (error?.response) {
    const status = error.response.status;
    const detail = error.response.data?.error || null;
    if (status === 401) return { reason: 'http_401', status, detail, timestamp };
    if (status === 403) return { reason: 'http_403', status, detail, timestamp };
    if (status >= 500) return { reason: 'http_5xx', status, detail, timestamp };
    return { reason: `http_${status}`, status, detail, timestamp };
  }
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) {
    return { reason: 'timeout', detail: error?.message || null, timestamp };
  }
  if (error?.message) {
    return { reason: 'network_error', detail: error.message, timestamp };
  }
  return { reason: 'unknown', timestamp };
}

/**
 * Reasons that mean the server has *definitively* rejected the local token,
 * so it is safe (and helpful) to clear it. Transient failures are excluded
 * so an outage or offline blip does not log the user out.
 */
const DEFINITIVE_AUTH_REJECTIONS = new Set([
  'http_401',
  'http_403',
  'unauthenticated_response',
  'no_token',
]);

export function isDefinitiveAuthRejection(reason) {
  return DEFINITIVE_AUTH_REJECTIONS.has(reason);
}

// Helper function to sync token with local backend
const syncTokenWithBackend = async (token) => {
  try {
    const response = await axios.post(
      `${API_CONFIG.BASE_URL}/users/sync-token`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        withCredentials: true,
      }
    );

    if (response.data.success) {
      console.log('Token synchronized with backend successfully');
    }
  } catch (error) {
    console.error('Error syncing token with backend:', error);
  }
};

export default {
  namespaced: true,
  state: {
    token: localStorage.getItem('token') || null,
    user: null,
    userName: null,
    userEmail: null,
    userPseudonym: null, // Store pseudonym here
    subscription: null,
    planType: 'free',
    planFeatures: {},
    hasCompletedOnboarding: localStorage.getItem('hasCompletedOnboarding') === 'true',

    // License validation state
    signedLicense: JSON.parse(localStorage.getItem('signedLicense') || 'null'),
    licenseStatus: 'unknown', // 'valid', 'expired', 'invalid', 'offline', 'unknown'
    lastLicenseCheck: null,

    // Diagnostic record of why the last fetchUserData failed (if it did).
    // Populated whenever the auth probe fails to confirm a user; cleared on
    // a successful probe. Consumed by the router auth-guard so it can tell
    // the user (and any admin watching DevTools) *why* the session is no
    // longer trusted instead of bouncing them to /settings silently.
    //
    // Shape: { reason, status?, detail?, timestamp } or null when healthy.
    // Reasons: no_token | http_401 | http_403 | http_5xx | http_<N> |
    //          timeout | network_error | unauthenticated_response | unknown
    lastAuthFailure: null,
  },
  mutations: {
    SET_TOKEN(state, token) {
      state.token = token;
      localStorage.setItem('token', token);

      // Sync with backend when token is set
      if (token) {
        syncTokenWithBackend(token);
      }
    },
    CLEAR_TOKEN(state) {
      state.token = null;
      localStorage.removeItem('token');
    },
    SET_USER(state, user) {
      state.user = user;
      state.userName = user?.name || null;
      state.userEmail = user?.email || null;
    },
    SET_PSEUDONYM(state, pseudonym) {
      state.userPseudonym = pseudonym;
    },
    SET_SUBSCRIPTION(state, subscriptionData) {
      state.subscription = subscriptionData;
      state.planType = subscriptionData.planType || 'free';
      state.planFeatures = subscriptionData.features || {};
    },
    CLEAR_SUBSCRIPTION(state) {
      state.subscription = null;
      state.planType = 'free';
      state.planFeatures = {};
    },
    COMPLETE_ONBOARDING(state) {
      state.hasCompletedOnboarding = true;
      localStorage.setItem('hasCompletedOnboarding', 'true');
    },
    RESET_ONBOARDING(state) {
      state.hasCompletedOnboarding = false;
      localStorage.removeItem('hasCompletedOnboarding');
    },

    // License mutations
    SET_SIGNED_LICENSE(state, signedLicense) {
      state.signedLicense = signedLicense;
      state.lastLicenseCheck = Date.now();

      if (signedLicense) {
        localStorage.setItem('signedLicense', JSON.stringify(signedLicense));

        // Extract plan info from verified license
        if (signedLicense.license) {
          state.planType = signedLicense.license.planType || 'free';
          state.planFeatures = signedLicense.license.features || {};
          state.licenseStatus = 'valid';
        }
      } else {
        localStorage.removeItem('signedLicense');
        state.licenseStatus = 'invalid';
      }
    },
    SET_LICENSE_STATUS(state, status) {
      state.licenseStatus = status;
    },
    CLEAR_LICENSE(state) {
      state.signedLicense = null;
      state.planType = 'free';
      state.planFeatures = {};
      state.licenseStatus = 'invalid';
      localStorage.removeItem('signedLicense');
    },
    SET_AUTH_FAILURE(state, failure) {
      state.lastAuthFailure = failure;
    },
    CLEAR_AUTH_FAILURE(state) {
      state.lastAuthFailure = null;
    },
  },
  actions: {
    fetchUserData: withFreshness('userAuth.fetchUserData', async ({ commit, state, dispatch }) => {
      if (!state.token) {
        commit('SET_AUTH_FAILURE', { reason: 'no_token', timestamp: Date.now() });
        return;
      }

      try {
        const response = await axios.get(`${API_CONFIG.REMOTE_URL}/users/auth/status`, {
          headers: { Authorization: `Bearer ${state.token}` },
          withCredentials: true,
          timeout: 10000,
        });

        if (response.data.isAuthenticated && response.data.user) {
          commit('SET_USER', response.data.user);
          commit('CLEAR_AUTH_FAILURE');
          // Fetch pseudonym after user data is set
          if (response.data.user.email) {
            dispatch('fetchPseudonym');
          }
        } else {
          commit('SET_AUTH_FAILURE', {
            reason: 'unauthenticated_response',
            status: response.status,
            detail: response.data?.error || null,
            timestamp: Date.now(),
          });
          console.error('Auth status returned but no user data:', response.data);
        }
      } catch (error) {
        const failure = classifyAuthError(error);
        commit('SET_AUTH_FAILURE', failure);
        console.error(`Error fetching user data (${failure.reason}):`, error);
      }
    }, { staleAfter: TTL.userAuthFetchUserData }),
    fetchPseudonym: withFreshness('userAuth.fetchPseudonym', async ({ commit, state }) => {
      if (!state.userEmail) return;

      try {
        const response = await axios.get(`${API_CONFIG.REMOTE_URL}/referrals/user/${encodeURIComponent(state.userEmail)}`, {
          headers: { Authorization: `Bearer ${state.token}` },
        });

        if (response.data) {
          const pseudonym = response.data.pseudonym || state.userEmail.split('@')[0];
          commit('SET_PSEUDONYM', pseudonym);
        }
      } catch (error) {
        console.error('Failed to fetch pseudonym:', error);
        // Fallback to email prefix
        const fallback = state.userEmail.split('@')[0];
        commit('SET_PSEUDONYM', fallback);
      }
    }, { staleAfter: TTL.userAuthFetchPseudonym }),
    async requestMagicLink({ commit }, email) {
      try {
        const response = await axios.post(`${API_CONFIG.REMOTE_URL}/users/auth/magic-link/request`, { email }, { withCredentials: true });
        return { success: true, message: response.data.message };
      } catch (error) {
        const errorMessage = error.response?.data?.error || 'Failed to send code. Please try again.';
        return { success: false, error: errorMessage };
      }
    },
    async verifyMagicLink({ commit, dispatch }, { email, code }) {
      try {
        const response = await axios.post(`${API_CONFIG.REMOTE_URL}/users/auth/magic-link/verify`, { email, code }, { withCredentials: true });

        if (response.data.success && response.data.token) {
          commit('SET_TOKEN', response.data.token);
          commit('SET_USER', {
            id: response.data.userId,
            name: response.data.name,
            email: response.data.email,
            authMethod: response.data.authMethod,
          });

          // If this is a new user, reset onboarding so they see it
          if (response.data.isNewUser) {
            commit('RESET_ONBOARDING');
          }

          // CRITICAL: Fetch subscription and validate license immediately after login
          // This ensures users see their correct plan status on day 1
          console.log('🔄 Fetching subscription after login...');
          await dispatch('fetchSubscription');
          console.log('🔐 Validating license after login...');
          await dispatch('validateLicense');

          // Fetch initial data in background after successful login
          // using root: true to access root action
          this.dispatch('initializeStore', null, { root: true });

          return { success: true, isNewUser: response.data.isNewUser };
        }
        return { success: false, error: 'Verification failed' };
      } catch (error) {
        const errorMessage = error.response?.data?.error || 'Failed to verify code. Please try again.';
        return { success: false, error: errorMessage };
      }
    },
    async devLogin({ commit, dispatch }) {
      if (process.env.NODE_ENV === 'development') {
        const mockToken = 'dev-' + Math.random().toString(36).substring(2);
        const mockUser = {
          name: 'Dev User',
          email: 'dev@local.test',
        };
        commit('SET_TOKEN', mockToken);
        commit('SET_USER', mockUser);

        // Fetch subscription and validate license after dev login
        await dispatch('fetchSubscription');
        await dispatch('validateLicense');

        // Initialize data for dev login too
        dispatch('initializeStore', null, { root: true });
      }
    },
    fetchSubscription: withFreshness('userAuth.fetchSubscription', async ({ commit, state }) => {
      if (!state.token) {
        console.log('❌ fetchSubscription: No token available');
        return;
      }

      try {
        console.log('🔄 Fetching subscription from API...');
        const response = await axios.get(`${API_CONFIG.REMOTE_URL}/users/subscription/status`, {
          headers: { Authorization: `Bearer ${state.token}` },
          withCredentials: true,
          timeout: 10000,
        });

        console.log('✅ Subscription API response:', response.data);
        console.log('📋 Plan Type from API:', response.data.planType);

        commit('SET_SUBSCRIPTION', response.data);

        console.log('✅ Subscription committed to store. Current planType:', state.planType);
        return response.data;
      } catch (error) {
        console.error('❌ Error fetching subscription:', error);
        console.error('❌ Error response:', error.response?.data);
        commit('CLEAR_SUBSCRIPTION');
        return null;
      }
    }, { staleAfter: TTL.userAuthFetchSubscription }),
    async createSubscription({ commit, state }, { planType, interval = 'yearly', pricingTier = 'discount', successUrl, cancelUrl }) {
      if (!state.token) {
        throw new Error('Authentication required');
      }

      try {
        const response = await axios.post(
          `${API_CONFIG.REMOTE_URL}/users/subscription/create`,
          { planType, interval, pricingTier, successUrl, cancelUrl },
          {
            headers: { Authorization: `Bearer ${state.token}` },
            withCredentials: true,
          }
        );

        // Open Stripe checkout in external browser (for Electron)
        if (response.data.url) {
          if (window.electron?.openExternalUrl) {
            window.electron.openExternalUrl(response.data.url);
          } else {
            window.open(response.data.url, '_blank');
          }
        }

        return response.data;
      } catch (error) {
        console.error('Error creating subscription:', error);
        console.error('Error response:', error.response?.data);
        console.error('Request data:', { planType, interval, pricingTier });
        throw error;
      }
    },
    async cancelSubscription({ commit, state }) {
      if (!state.token) {
        throw new Error('Authentication required');
      }

      try {
        const response = await axios.post(
          `${API_CONFIG.REMOTE_URL}/users/subscription/cancel`,
          {},
          {
            headers: { Authorization: `Bearer ${state.token}` },
            withCredentials: true,
          }
        );

        return response.data;
      } catch (error) {
        console.error('Error cancelling subscription:', error);
        throw error;
      }
    },
    async reactivateSubscription({ commit, state }) {
      if (!state.token) {
        throw new Error('Authentication required');
      }

      try {
        const response = await axios.post(
          `${API_CONFIG.REMOTE_URL}/users/subscription/reactivate`,
          {},
          {
            headers: { Authorization: `Bearer ${state.token}` },
            withCredentials: true,
          }
        );

        return response.data;
      } catch (error) {
        console.error('Error reactivating subscription:', error);
        throw error;
      }
    },
    async updateSubscription({ commit, state }, { newPlanType }) {
      if (!state.token) {
        throw new Error('Authentication required');
      }

      try {
        const response = await axios.post(
          `${API_CONFIG.REMOTE_URL}/users/subscription/update`,
          { newPlanType },
          {
            headers: { Authorization: `Bearer ${state.token}` },
            withCredentials: true,
          }
        );

        return response.data;
      } catch (error) {
        console.error('Error updating subscription:', error);
        throw error;
      }
    },

    /**
     * Validate license with AGNT server
     * Fetches a fresh signed license and verifies it locally
     */
    validateLicense: withFreshness('userAuth.validateLicense', async ({ commit, state }) => {
      const machineId = await LicenseValidator.getMachineId();
      const appVersion = window.electron?.getAppVersion?.() || '1.0.0';

      // Check if we have a cached license that's still valid
      if (state.signedLicense && !navigator.onLine) {
        const result = await LicenseValidator.verifyLicense(state.signedLicense);
        if (result.valid) {
          commit('SET_LICENSE_STATUS', 'offline');
          console.log('📜 Using cached license (offline mode)');
          return result.license;
        }
      }

      // If not authenticated, we can still get a free license
      try {
        console.log('🔄 Validating license with AGNT server...');

        const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};

        const response = await axios.post(
          `${API_CONFIG.REMOTE_URL}/license/validate`,
          {
            machineId,
            appVersion,
            currentLicenseExpiry: state.signedLicense?.license?.expiresAt || null,
          },
          {
            headers,
            withCredentials: true,
            timeout: 10000, // 10 second timeout
          }
        );

        // Verify the signature locally
        const verifyResult = await LicenseValidator.verifyLicense(response.data);

        if (verifyResult.valid) {
          commit('SET_SIGNED_LICENSE', response.data);
          console.log('✅ License validated successfully:', verifyResult.license.planType);
          return verifyResult.license;
        } else {
          console.warn('⚠️ License verification failed:', verifyResult.reason);
          commit('CLEAR_LICENSE');
          return null;
        }
      } catch (error) {
        console.error('❌ License validation error:', error.message);

        // Network error - try to use cached license if still valid
        if (state.signedLicense) {
          const result = await LicenseValidator.verifyLicense(state.signedLicense);
          if (result.valid) {
            commit('SET_LICENSE_STATUS', 'offline');
            console.log('📜 Using cached license (network error)');
            return result.license;
          }
        }

        // No valid cached license - default to free
        commit('SET_LICENSE_STATUS', 'expired');
        return null;
      }
    }, { staleAfter: TTL.userAuthValidateLicense }),

    /**
     * Refresh license if needed (based on refreshBefore timestamp)
     */
    async refreshLicenseIfNeeded({ dispatch, state }) {
      // No license - need to validate
      if (!state.signedLicense) {
        return dispatch('validateLicense');
      }

      // Check if refresh is needed
      if (LicenseValidator.shouldRefresh(state.signedLicense.license)) {
        console.log('🔄 License refresh needed, validating...');
        return dispatch('validateLicense');
      }

      // License is still fresh
      return state.signedLicense.license;
    },

    /**
     * Check cached license validity on app startup
     * Called before trying to fetch from server
     */
    async checkCachedLicense({ commit, state }) {
      if (!state.signedLicense) {
        commit('SET_LICENSE_STATUS', 'unknown');
        return null;
      }

      const result = await LicenseValidator.verifyLicense(state.signedLicense);

      if (result.valid) {
        // Update plan info from cached license
        commit('SET_LICENSE_STATUS', 'valid');
        return result.license;
      } else {
        // Cached license is invalid/expired
        commit('CLEAR_LICENSE');
        return null;
      }
    },

    logout({ commit }) {
      commit('CLEAR_TOKEN');
      commit('SET_USER', null);
      commit('SET_PSEUDONYM', null);
      commit('CLEAR_SUBSCRIPTION');
      commit('CLEAR_LICENSE');
      // Clear onboarding status on logout so new users see onboarding
      commit('RESET_ONBOARDING');
      // Clear all feature stores to prevent data leakage between users
      commit('agents/CLEAR_AGENTS', null, { root: true });
      commit('workflows/CLEAR_WORKFLOWS', null, { root: true });
      commit('tools/CLEAR_TOOLS', null, { root: true });
      commit('goals/CLEAR_GOALS', null, { root: true });
    },
  },
  getters: {
    isAuthenticated: (state) => !!state.token,
    userName: (state) => state.userName,
    userEmail: (state) => state.userEmail,
    userPseudonym: (state) => state.userPseudonym || state.userName || state.userEmail?.split('@')[0] || 'User',
    planType: (state) => state.planType,
    planFeatures: (state) => state.planFeatures,
    hasFeature: (state) => (feature) => {
      return state.planFeatures[feature] || false;
    },
    shouldShowOnboarding: (state, getters, rootState, rootGetters) => {
      // Don't show if already completed
      if (state.hasCompletedOnboarding) return false;

      // Don't show if not authenticated
      if (!getters.isAuthenticated) return false;

      // Show onboarding for authenticated users who haven't completed it
      // (Removed activity check - users can now go through onboarding anytime via Tour Settings)
      return true;
    },

    // License getters
    signedLicense: (state) => state.signedLicense,
    licenseStatus: (state) => state.licenseStatus,
    license: (state) => state.signedLicense?.license || null,

    /**
     * Check if the license is valid and verified
     * This is the primary check for premium features
     */
    hasValidLicense: (state) => {
      return state.licenseStatus === 'valid' || state.licenseStatus === 'offline';
    },

    /**
     * Check if user has premium access (non-free plan)
     * Use this for gating premium features
     *
     * Note: Previously required hasValidLicense, but this caused users to be
     * locked out of paid features when license validation failed due to network
     * issues. Now we trust planType from the subscription API as the source of truth.
     */
    isPremium: (state) => {
      return state.planType !== 'free';
    },

    /**
     * Get a specific feature from the verified license
     * Returns the feature config or false if not available
     */
    getLicenseFeature: (state, getters) => (featureName) => {
      if (!getters.hasValidLicense) return false;

      const license = state.signedLicense?.license;
      if (!license || !license.features) return false;

      const feature = license.features[featureName];

      // Handle boolean features
      if (typeof feature === 'boolean') return feature;

      // Handle object features
      if (typeof feature === 'object' && feature !== null) {
        return feature.enabled ? feature : false;
      }

      return false;
    },

    /**
     * Get rate limits from license
     */
    rateLimits: (state) => {
      return state.signedLicense?.license?.rateLimits || {
        requestsPerHour: 1000,
        requestsPerDay: 10000,
      };
    },

    /**
     * Get time until license expires (for UI display)
     */
    licenseExpiresIn: (state) => {
      if (!state.signedLicense?.license?.expiresAt) return null;
      const now = Math.floor(Date.now() / 1000);
      return state.signedLicense.license.expiresAt - now;
    },
  },
};
