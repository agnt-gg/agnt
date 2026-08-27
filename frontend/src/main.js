// Import CSS files
import '@/styles/main.css';

import { createApp } from 'vue';
import App from '@/App.vue';
import router from '@/router';
import { installDeepLinkRouting } from '@/deepLinkRouting.js';
import axios from 'axios';
import store from '@/store/state';
import { initializeAxiosInterceptor } from '@/utils/axiosInterceptor';
import { registerAllWidgets } from '@/canvas/widgets/index.js';
import { syncMediaCookieFromStorage } from '@/services/mediaAuth.js';
import { watchSession, stopLicenseRefresh, idle } from '@/store/auth/sessionBoot.js';
import { adoptTokenFromUrl } from '@/store/auth/urlSessionToken.js';
import { handOffSessionTokenToOpener } from '@/utils/oauthPopupHandoff.js';
import { vTooltip } from '@/directives/tooltip.js';
import { vViewportClamp } from '@/directives/viewportClamp.js';
import { installAppHeight } from '@/utils/appHeight.js';

// Import test utilities in development mode
if (process.env.NODE_ENV === 'development') {
  import('@/utils/testRateLimit');
}

// Before mount, not after: a restored conversation can render an <img
// src="/api/local-file/..."> on the very first paint, and that request needs
// the cookie already present or it 401s and stays broken for the session.
syncMediaCookieFromStorage();

// Before mount: every full-height shell reads --app-height on its first paint,
// and on a phone the CSS fallback is one keyboard too tall. No-op on desktop.
installAppHeight();

const app = createApp(App);

app.use(router);
app.use(store);

// agnt:// links that arrive while the app is already running. A cold start
// does not come through here — main.js in the Electron main process loads the
// window directly onto the target path — so this only handles the warm case,
// where reloading the SPA would discard in-memory state to do a navigation.
installDeepLinkRouting(router);

// The themed replacement for the native `title` attribute. Registered
// globally so it works in every template without a per-file import.
app.directive('tooltip', vTooltip);

// Keeps fixed-position popups (tool/provider selectors, command menus) fully
// on screen regardless of window size — kills the hand-tuned-offset bleed bug
// class at the root instead of per component.
app.directive('viewport-clamp', vViewportClamp);

// Initialize the new unified theme system (synchronous, fast)
store.dispatch('theme/initTheme');

// Register all canvas widgets
registerAllWidgets();

// EVERY outgoing axios request carries the session token, and this is
// registered BEFORE mount for a reason.
//
// It used to be the last statement in this file — after `app.mount()` and
// after `initializeApp()`. Any request issued while components were still
// mounting therefore went out with no `Authorization` header, because the
// thing that attaches it did not exist yet. The backend refused those
// correctly with `401 {reason:'missing'}`, and the response interceptor below
// used to read that refusal as a dead session and clear the token.
//
// Nothing may mount before the credential path is complete, so the ordering
// is now: attach headers, handle rejections, adopt any token, THEN mount.
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

// Initialize axios interceptors: rate limiting, and the mid-session auth net
// that signs the user out when the data backend rejects their token.
initializeAxiosInterceptor(store, router);

// FIRST, and before `adoptTokenFromUrl` below: if this document is a sign-in
// popup that has come back carrying a token, hand that token to the window
// that opened it and close. Never mount.
//
// The ordering is load-bearing twice over. `adoptTokenFromUrl` STRIPS `?token=`
// from the address bar, so the token is readable exactly once and whichever
// runs first is the one that gets it. And a window that exists only to carry a
// token back must not mount an application, or the user watches a second AGNT
// boot inside a 600x700 window while the window they started from stays on the
// sign-in screen.
//
// Returns false for an ordinary page load — including a hosted tenant arriving
// at `?token=` by direct navigation, which has no opener and must keep working
// exactly as it does today. See utils/oauthPopupHandoff.js.
const isSessionHandoffPopup = handOffSessionTokenToOpener();

// A hosted tenant delivers its token in the URL rather than in localStorage,
// so the store cannot seed itself the way it does on desktop. Adopt it here —
// synchronously, before mount — so no component can ever observe a null token
// and poll without one. See store/auth/urlSessionToken.js.
if (!isSessionHandoffPopup) adoptTokenFromUrl(store);

// Load the user's data when a session STARTS, and drop it when one ends —
// however that happens. Installed before anything can change sessionState so
// the very first transition is observed.
//
// This used to be a block inside initializeApp below, which meant it ran only
// on a page load that happened to find a token in localStorage. Signing in
// does not reload the page, so after a login none of it ran and the app showed
// empty panels until the user pressed refresh. See store/auth/sessionBoot.js.
watchSession(store);

// ============================================================================
// DIAGNOSTICS — renderer error capture
// ============================================================================
// Installed BEFORE mount so an error thrown during initial render is caught.
// The renderer has no fs access; window.electron.reportError relays to main,
// which writes to the same JSONL timeline as the backend and workflow child.
// In web/Docker builds window.electron is absent and every call is a no-op.
const reportClientError = (level, src, msg, err, extra = {}) => {
  try {
    window.electron?.reportError?.({
      level,
      src,
      msg: String(msg || '').slice(0, 400),
      url: window.location?.hash,
      ...extra,
      err: err ? { name: err.name, msg: err.message, stack: err.stack } : undefined,
    });
  } catch {
    /* an error reporter must never throw inside an error handler */
  }
};

window.addEventListener('error', (event) => {
  reportClientError('ERROR', 'window', event.message, event.error, {
    line: event.lineno,
    col: event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  reportClientError('ERROR', 'promise', 'unhandled rejection', reason);
});

app.config.errorHandler = (err, _instance, info) => {
  reportClientError('ERROR', 'vue', info, err, { componentStack: info });
  console.error(err); // keep the devtools behaviour developers rely on
};

// MOUNT IMMEDIATELY - show the app shell before data loading
// This eliminates the blank screen while API calls complete
//
// Unless this document is a sign-in popup that has already handed its token
// back and is closing. Mounting there is the whole defect: a second complete
// copy of AGNT, running in a chromeless 600x700 window, issuing real requests.
if (!isSessionHandoffPopup) app.mount('#app');

// Dev-only: `__auditContrast()` in the console reports any on-screen text that
// is unreadable against its ACTUAL rendered backdrop. Static analysis cannot
// see compositional failures (text from one component over a background painted
// by another, or a blanket selector outranking a component's own colour), which
// is how the Workspace palette shipped invisible in light mode.
// The dynamic import keeps it out of the production bundle entirely.
if (import.meta.env.DEV) {
  import('./utils/contrastAudit.js')
    .then(({ auditContrast }) => {
      window.__auditContrast = auditContrast;
    })
    .catch(() => {
      /* the auditor is a convenience; never let it break boot */
    });
}

// Boot decides ONE thing: does this page load already have a session?
//
// Everything that used to follow — the license cache, the identity fetches,
// `initializeStore`, connector polling, run resumption — now lives in
// store/auth/sessionBoot.js and is driven by the session transition. None of it
// was ever boot-specific; it was SESSION work that happened to be written in
// the one place a session can begin without a user action, which is why the
// four places a user can actually sign in never ran it.
const initializeApp = async () => {
  const token = localStorage.getItem('token');

  if (!token) {
    console.log('No token found, skipping authenticated init');
    store.commit('userAuth/SET_SESSION_STATE', 'invalid');
    // Defer license validation off first-paint. Anonymous/free tier doesn't
    // need it before the shell renders.
    idle(() => {
      store.dispatch('userAuth/validateLicense').catch((error) => {
        console.log('License validation skipped (no auth):', error.message);
      });
    });
    return;
  }

  console.log('[boot] token found, verifying session...');

  // A token in localStorage is not a session; only the backend that serves the
  // data can say that. Verifying first is what stops 20 requests going out for
  // a session that is about to be rejected. On 'valid', the watcher installed
  // above starts the session and loads everything.
  const sessionState = await store.dispatch('userAuth/verifySession');
  if (sessionState !== 'valid') {
    console.warn(`[boot] session is ${sessionState} — not loading user data.`);
    // A license is not user data and the login screen still needs plan copy.
    idle(() => {
      store.dispatch('userAuth/validateLicense').catch(() => {
        /* free tier is the correct fallback */
      });
    });
  }
};

// Refresh license when window gains focus (user returns to app)
const handleWindowFocus = () => {
  store.dispatch('userAuth/refreshLicenseIfNeeded').catch((error) => {
    console.error('Focus license refresh failed:', error);
  });
};

// Listen for window focus events
window.addEventListener('focus', handleWindowFocus);

// Stop polling and cleanup when app is closed/unmounted. The license timer is
// owned by sessionBoot now, which is also what stops it on logout — previously
// it was only ever cleared here, so signing out left an hourly refresh running
// for a user who was no longer signed in.
window.addEventListener('beforeunload', () => {
  store.dispatch('appAuth/stopPolling');
  stopLicenseRefresh();
  window.removeEventListener('focus', handleWindowFocus);
});

// Initialize app data in background AFTER mount (non-blocking)
// Skipped in a handoff popup: nothing mounted, and the session belongs to the
// window we just posted the token to.
if (!isSessionHandoffPopup) initializeApp().catch(console.error);
