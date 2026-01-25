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

// Initialize the new unified theme system (synchronous, fast)
store.dispatch('theme/initTheme');

// Initialize axios rate limit interceptor
initializeAxiosInterceptor(store);

// MOUNT IMMEDIATELY - show the app shell before data loading
// This eliminates the blank screen while API calls complete
app.mount('#app');

// License refresh interval (1 hour)
const LICENSE_REFRESH_INTERVAL = 60 * 60 * 1000;
let licenseRefreshTimer = null;

// Initialize app data in background AFTER mount
const initializeApp = async () => {
  const token = localStorage.getItem('token');

  if (!token) {
    console.log('No token found, skipping authenticated init');
    // Still validate license for free tier (non-blocking)
    store.dispatch('userAuth/validateLicense').catch((error) => {
      console.log('License validation skipped (no auth):', error.message);
    });
    return;
  }

  console.log('Token found, initializing app in background...');

  try {
    // Smart license caching - only clear if actually expired
    let needsLicenseValidation = true;
    const cachedLicense = localStorage.getItem('signedLicense');

    if (cachedLicense) {
      try {
        const parsed = JSON.parse(cachedLicense);
        const expiresAt = parsed?.license?.expiresAt;
        const now = Math.floor(Date.now() / 1000);

        // License valid for more than 5 minutes - use cache
        if (expiresAt && expiresAt > now + 300) {
          needsLicenseValidation = false;
          store.commit('userAuth/SET_SIGNED_LICENSE', parsed);
          console.log('Using cached license (still valid)');
        }
      } catch (e) {
        localStorage.removeItem('signedLicense');
      }
    }

    // PARALLEL: Run all independent auth calls together instead of sequentially
    // This reduces 4 sequential waits into 1 parallel batch
    console.log('Fetching auth data in parallel...');
    const authPromises = [
      store.dispatch('userAuth/fetchUserData'),
      store.dispatch('aiProvider/fetchCustomProviders'),
      store.dispatch('userAuth/fetchSubscription'),
    ];

    // Only validate license if cache is expired/missing
    if (needsLicenseValidation) {
      authPromises.push(store.dispatch('userAuth/validateLicense'));
    }

    const results = await Promise.allSettled(authPromises);

    // Log any failures for debugging
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Auth init item ${index} failed:`, result.reason?.message || result.reason);
      }
    });

    console.log('Auth data fetched. planType:', store.state.userAuth.planType);

    // Load user settings in background (non-blocking)
    store.dispatch('aiProvider/loadUserSettings').catch((error) => {
      console.error('Failed to load user settings:', error);
    });

    // Initialize store data in background (non-blocking)
    // This fetches agents, workflows, tools, etc.
    store.dispatch('initializeStore').catch((error) => {
      console.error('Failed to initialize store:', error);
    });

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

  console.log('License refresh timer started (every 1 hour)');
};

// Refresh license when window gains focus (user returns to app)
const handleWindowFocus = () => {
  store.dispatch('userAuth/refreshLicenseIfNeeded').catch((error) => {
    console.error('Focus license refresh failed:', error);
  });
};

// Listen for window focus events
window.addEventListener('focus', handleWindowFocus);

// Stop polling and cleanup when app is closed/unmounted
window.addEventListener('beforeunload', () => {
  store.dispatch('appAuth/stopPolling');
  if (licenseRefreshTimer) {
    clearInterval(licenseRefreshTimer);
    licenseRefreshTimer = null;
  }
  window.removeEventListener('focus', handleWindowFocus);
});

// Initialize app data in background AFTER mount (non-blocking)
initializeApp().catch(console.error);

// Axios interceptor for auth headers
axios.interceptors.request.use(
  (config) => {
    const token = store.state.userAuth.token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);
