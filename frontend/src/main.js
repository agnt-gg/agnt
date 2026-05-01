// Import CSS files
import '@/styles/main.css';

import { createApp } from 'vue';
import App from '@/App.vue';
import router from '@/router';
import axios from 'axios';
import store from '@/store/state';
import { initializeAxiosInterceptor } from '@/utils/axiosInterceptor';
import { registerAllWidgets } from '@/canvas/widgets/index.js';

// Import test utilities in development mode
if (process.env.NODE_ENV === 'development') {
  import('@/utils/testRateLimit');
}

const app = createApp(App);

app.use(router);
app.use(store);

// Initialize the new unified theme system (synchronous, fast)
store.dispatch('theme/initTheme');

// Register all canvas widgets
registerAllWidgets();

// Initialize axios rate limit interceptor
initializeAxiosInterceptor(store);

// MOUNT IMMEDIATELY - show the app shell before data loading
// This eliminates the blank screen while API calls complete
app.mount('#app');

// License refresh interval (1 hour)
const LICENSE_REFRESH_INTERVAL = 60 * 60 * 1000;
let licenseRefreshTimer = null;

// Polyfill for runtimes without requestIdleCallback (older Chromium versions
// or Node-side SSR). Falls back to a 1ms timeout — the timing isn't exact,
// but the goal is just "after first paint, not blocking it."
const idle = (cb, opts) =>
  (typeof window !== 'undefined' && window.requestIdleCallback)
    ? window.requestIdleCallback(cb, opts)
    : setTimeout(cb, 1);

// Initialize app data in background AFTER mount.
//
// Two phases:
//   1. CRITICAL — fired immediately. Subscription + user identity drive what
//      UI we render first (gated features, etc.). These are remote calls, but
//      the responses *seed* the first paint of authenticated screens.
//   2. DEFERRED — fired from requestIdleCallback after first paint. Includes
//      license validation (off the critical path; cached license already
//      hydrated below), custom providers, the local-data fan-out
//      (`initializeStore`), and connector polling.
//
// Why this matters: Chromium caps at 6 concurrent connections per origin,
// and `<img>` requests are scheduled at lower priority than fetch/XHR. Firing
// 4–7 auth fetches in parallel at startup pushes assets like the Settings
// logo behind them. Splitting buys the asset pipeline first dibs on the
// connection pool while still loading auth data in the same animation frame.
const initializeApp = async () => {
  const token = localStorage.getItem('token');

  if (!token) {
    console.log('No token found, skipping authenticated init');
    // Defer license validation off first-paint. Anonymous/free tier doesn't
    // need it before the shell renders.
    idle(() => {
      store.dispatch('userAuth/validateLicense').catch((error) => {
        console.log('License validation skipped (no auth):', error.message);
      });
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

    // ── CRITICAL ── Fetch the two pieces of state that gate which UI we
    // render first. Both are remote calls but cheap. fetchSubscription drives
    // plan-tier UI; fetchUserData drives identity-aware screens.
    const criticalPromises = [
      store.dispatch('userAuth/fetchUserData'),
      store.dispatch('userAuth/fetchSubscription'),
    ];
    const criticalResults = await Promise.allSettled(criticalPromises);
    criticalResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Critical auth item ${index} failed:`, result.reason?.message || result.reason);
      }
    });
    console.log('Critical auth data fetched. planType:', store.state.userAuth.planType);

    // ── DEFERRED ── Run the rest from requestIdleCallback so above-the-fold
    // images and other low-priority assets get connection slots first.
    idle(() => {
      // Local data fan-out (initializeStore) — agents, workflows, tools, etc.
      // All hit localhost:3333; not blocking the first paint anyway, but
      // deferring keeps the network panel calmer during initial render.
      store.dispatch('initializeStore').catch(console.error);
      store.dispatch('appAuth/startPolling');

      // Remote, but not on the critical path.
      store.dispatch('aiProvider/fetchCustomProviders').catch((err) => {
        console.warn('fetchCustomProviders failed:', err?.message);
      });

      // Only validate license if cache is expired/missing (already hydrated above otherwise).
      if (needsLicenseValidation) {
        store.dispatch('userAuth/validateLicense').catch((err) => {
          console.warn('validateLicense failed:', err?.message);
        });
      }

      // User settings — loads custom-instructions etc. into the AI provider state.
      store.dispatch('aiProvider/loadUserSettings').catch((error) => {
        console.error('Failed to load user settings:', error);
      });

      // Start periodic license refresh
      startLicenseRefresh();
    }, { timeout: 2000 });
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
