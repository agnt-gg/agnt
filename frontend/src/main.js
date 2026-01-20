// Import CSS files
import '@/styles/main.css';

import { createApp } from 'vue';
import App from '@/App.vue';
import router from '@/router';
import axios from 'axios';
import store from '@/store/state';
import { initializeAxiosInterceptor } from '@/utils/axiosInterceptor';

// Import test utilities in development mode
if (process.env.NODE_ENV === 'development') {
  import('@/utils/testRateLimit');
}

const app = createApp(App);

app.use(router);
app.use(store);

// Initialize the new unified theme system
store.dispatch('theme/initTheme');

// Initialize axios rate limit interceptor
initializeAxiosInterceptor(store);

// License refresh interval (1 hour)
const LICENSE_REFRESH_INTERVAL = 60 * 60 * 1000;
let licenseRefreshTimer = null;

// CRITICAL: Ensure token is loaded from localStorage FIRST before any API calls
const initializeApp = async () => {
  // FORCE CLEAR stale cached license on startup to ensure fresh validation
  console.log('🧹 Clearing cached license to force fresh validation...');
  localStorage.removeItem('signedLicense');
  store.commit('userAuth/CLEAR_LICENSE');

  // Check if token exists in localStorage
  const token = localStorage.getItem('token');

  if (!token) {
    console.log('❌ No token found in localStorage');
    // Still validate license (will get free tier)
    await store.dispatch('userAuth/validateLicense').catch((error) => {
      console.log('License validation skipped (no auth):', error.message);
    });
    return;
  }

  console.log('✅ Token found in localStorage, initializing app...');

  try {
    // Fetch user data (this will set the user info in the store)
    await store.dispatch('userAuth/fetchUserData');
    console.log('✅ User data fetched, token exists:', !!store.state.userAuth.token);

    // Load user settings after authentication is established
    store.dispatch('aiProvider/loadUserSettings').catch((error) => {
      console.error('Failed to load user settings:', error);
    });

    // FORCE CLEAR subscription state to ensure fresh fetch every time
    console.log('🧹 Clearing subscription state to force fresh fetch...');
    store.commit('userAuth/CLEAR_SUBSCRIPTION');

    // Fetch subscription data immediately after user data
    console.log('🔄 Fetching subscription from API (forced fresh)...');
    await store.dispatch('userAuth/fetchSubscription').catch((error) => {
      console.error('Failed to fetch subscription:', error);
    });
    console.log('✅ Subscription fetch completed. Current planType:', store.state.userAuth.planType);

    // Validate license with AGNT server (this is the cryptographic verification)
    // This should return the LATEST plan info from the server
    console.log('🔐 Validating license with AGNT server...');
    await store.dispatch('userAuth/validateLicense').catch((error) => {
      console.error('License validation error:', error);
    });
    console.log('✅ License validation completed. Status:', store.state.userAuth.licenseStatus);
    console.log('📋 Final planType after license validation:', store.state.userAuth.planType);

    // Fetch ALL data needed for AGNT score calculation ONCE on app load
    await store.dispatch('initializeStore');

    // Start centralized polling for connected apps (60 second interval)
    store.dispatch('appAuth/startPolling');

    // Start periodic license refresh
    startLicenseRefresh();
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
};

// Periodic license refresh
const startLicenseRefresh = () => {
  // Clear any existing timer
  if (licenseRefreshTimer) {
    clearInterval(licenseRefreshTimer);
  }

  // Refresh license every hour
  licenseRefreshTimer = setInterval(() => {
    console.log('🔄 Periodic license refresh check...');
    store.dispatch('userAuth/refreshLicenseIfNeeded').catch((error) => {
      console.error('Periodic license refresh failed:', error);
    });
  }, LICENSE_REFRESH_INTERVAL);

  console.log('✅ License refresh timer started (every 1 hour)');
};

// Refresh license when window gains focus (user returns to app)
const handleWindowFocus = () => {
  console.log('👁️ Window focused, checking license...');
  store.dispatch('userAuth/refreshLicenseIfNeeded').catch((error) => {
    console.error('Focus license refresh failed:', error);
  });
};

// Listen for window focus events
window.addEventListener('focus', handleWindowFocus);

// Call the initialization function
initializeApp();

// Stop polling and cleanup when app is closed/unmounted
window.addEventListener('beforeunload', () => {
  store.dispatch('appAuth/stopPolling');
  // Clear license refresh timer
  if (licenseRefreshTimer) {
    clearInterval(licenseRefreshTimer);
    licenseRefreshTimer = null;
  }
  // Remove focus listener
  window.removeEventListener('focus', handleWindowFocus);
});

app.mount('#app');

// Update axios interceptor to use auth module state
axios.interceptors.request.use(
  (config) => {
    const token = store.state.userAuth.token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);
