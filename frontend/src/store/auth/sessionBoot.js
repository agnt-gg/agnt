/**
 * The lifecycle of an authenticated session: what starts when one begins, and
 * what stops when one ends.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO FIX
 * ---------------------------------------------------------------------------
 * Loading the user's data was triggered by "the page booted and localStorage
 * happened to contain a token" — a single block inside main.js's initializeApp.
 * But that is not when a session begins. It is only when ONE of the ways a
 * session can begin happens to coincide with a page load.
 *
 * Signing in does not reload the page, and there were FOUR ways to sign in
 * without one — the Google popup, the Google redirect-with-token, the magic
 * link, and devLogin. Each had grown its own hand-rolled imitation of the boot
 * block, and no two agreed:
 *
 *   path                    initializeStore  subscription  license  pseudonym
 *   Google (popup)                —               yes        yes        —
 *   Google (url token)            —               yes        yes        —
 *   magic link                   yes              yes        yes       yes
 *   devLogin                     yes              yes        yes        —
 *
 * So a Google sign-in loaded NO user data at all: not agents, workflows, tools,
 * outputs, groups, stats, skills, widgets or connected apps. And even the two
 * paths that remembered `initializeStore` still missed everything else boot
 * did — `aiProvider/loadUserSettings`, `appAuth/startPolling`,
 * `resumeInflightRuns`, `chatUnified/reclaimChannelScopes`, and the cached
 * license hydration.
 *
 * Meanwhile the screens had been deliberately stripped of their own fetches —
 * `// Data is pre-loaded by initializeStore in main.js - no redundant fetches
 * needed` appears verbatim in three panels. So the components correctly relied
 * on a guarantee that only ever held on a page load, and the user saw an empty
 * app until they hit refresh.
 *
 * Four call sites, four different subsets, no single answer to "what does being
 * signed in load?" — the shape of a missing abstraction.
 *
 * ---------------------------------------------------------------------------
 * THE FIX
 * ---------------------------------------------------------------------------
 * Trigger on the STATE TRANSITION, not on the page load. `sessionState` becomes
 * VALID exactly when a session begins — however it began: boot with a stored
 * token, magic link, Google popup, Google redirect, dev login, or a token that
 * only verified on the second attempt. One watcher, one sequence, and every
 * present and future sign-in route inherits it by construction.
 *
 * The symmetry matters as much as the trigger: VALID -> INVALID stops the
 * things this started (polling, the license timer) and clears the data it
 * loaded. Before, logout cleared 4 of the 12 stores `initializeStore` fills and
 * left both timers running.
 */

import { authSubject, licenseMatchesSubject, licenseSubject } from './licenseIdentity.js';
import { resumeInflightRuns as defaultResumeInflightRuns } from '@/services/runResume.js';
import { startPreferenceSync, stopPreferenceSync } from '@/services/userPreferences.js';

/** Refresh the signed license once an hour while a session is live. */
const LICENSE_REFRESH_INTERVAL = 60 * 60 * 1000;

/**
 * Ceiling on the two identity fetches that gate first paint.
 *
 * Preserved from the original boot path: a slow or hung agnt.gg must not pin
 * `initializeStore`, which gates the dashboard skeleton via `criticalDataReady`.
 */
const AUTH_WAIT_CEILING_MS = 1500;

/**
 * requestIdleCallback with a fallback for runtimes without it. The timing does
 * not need to be exact — the goal is only "after first paint, not blocking it".
 */
export const idle = (cb, opts) =>
  typeof window !== 'undefined' && window.requestIdleCallback
    ? window.requestIdleCallback(cb, opts)
    : setTimeout(cb, 1);

// Module-local session scope. Reset by endSession() so a second sign-in in the
// same page load starts from a clean slate.
let inFlight = null;
let licenseRefreshTimer = null;

/**
 * Everything that becomes true when a session starts.
 *
 * Concurrent callers share one run: boot and the router guard can both observe
 * the transition in the same tick, and loading the whole app twice would double
 * every request. This is an in-flight dedupe, NOT a cache — once it settles the
 * next session start runs again from scratch.
 *
 * Never rejects. It is called from a store watcher and from boot, neither of
 * which has anywhere meaningful to catch, and a half-loaded app must not also
 * produce an unhandled rejection.
 *
 * @param {object} store  the Vuex store
 * @param {{ reason?: string, resumeInflightRuns?: Function }} [opts]
 * @returns {Promise<void>}
 */
export function startSession(store, opts = {}) {
  if (inFlight) return inFlight;
  inFlight = runStartSession(store, opts).catch((err) => {
    console.error('[session] start failed:', err?.message || err);
  });
  return inFlight;
}

async function runStartSession(store, { reason = 'unknown', resumeInflightRuns = defaultResumeInflightRuns } = {}) {
  console.log(`[session] starting (${reason})`);

  // Hand the token to the local backend's session store before anything reads
  // from it. Three login paths each called this by hand; one forgot to await it.
  // Promise.resolve() throughout this function: Vuex returns `undefined` from
  // dispatch() for an action it does not know — it logs and carries on — so a
  // bare `.catch()` throws TypeError SYNCHRONOUSLY, before any handler exists.
  // In the idle() block below that lands in a timer with no caller, where it
  // escapes as an unhandled ERROR rather than a rejection: the suite reports
  // 'Tests 3452 passed | Errors 1 error' and CI goes red with nothing failing.
  // It also breaks the invariant this function is documented to hold —
  // startSession never rejects — and is a real hazard for any store whose
  // modules are not all registered at boot.
  await Promise.resolve(store.dispatch('userAuth/syncTokenWithBackend')).catch((err) => {
    console.warn('[session] token sync failed:', err?.message || err);
  });

  const needsLicenseValidation = hydrateCachedLicense(store);

  // ── CRITICAL ── the two fetches that decide WHICH UI renders first.
  // fetchSubscription drives plan-tier gating; fetchUserData drives
  // identity-aware screens. Raced against a ceiling so a slow remote cannot
  // hold up the local data fan-out below.
  await Promise.race([
    Promise.allSettled([
      store.dispatch('userAuth/fetchUserData'),
      store.dispatch('userAuth/fetchSubscription'),
      store.dispatch('userAuth/fetchPseudonym'),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[session] identity fetch ${i} failed:`, r.reason?.message || r.reason);
        }
      });
    }),
    new Promise((resolve) => setTimeout(resolve, AUTH_WAIT_CEILING_MS)),
  ]);

  // ── DEFERRED ── from requestIdleCallback so above-the-fold images and other
  // low-priority assets get connection slots first. Chromium caps at 6
  // concurrent connections per origin and schedules <img> below fetch/XHR.
  idle(() => {
    // The local data fan-out: agents, workflows, tools, outputs, groups,
    // stats, skills, widgets, connected apps. THE line whose absence from both
    // Google sign-in paths meant they loaded nothing at all.
    Promise.resolve(store.dispatch('initializeStore')).catch((err) => {
      console.error('[session] initializeStore failed:', err?.message || err);
    });

    store.dispatch('appAuth/startPolling');

    Promise.resolve(store.dispatch('aiProvider/fetchCustomProviders')).catch((err) => {
      console.warn('[session] fetchCustomProviders failed:', err?.message);
    });

    if (needsLicenseValidation) {
      Promise.resolve(store.dispatch('userAuth/validateLicense')).catch((err) => {
        console.warn('[session] validateLicense failed:', err?.message);
      });
    }

    // Custom instructions and provider preferences.
    Promise.resolve(store.dispatch('aiProvider/loadUserSettings')).catch((err) => {
      console.error('[session] loadUserSettings failed:', err?.message || err);
    });

    // Cross-device UI preferences (theme, font, panel geometry). Session
    // scoped, not boot scoped, for exactly the reason this module exists: a
    // sign-in does not reload the page, so a browser that signed in without
    // one would otherwise keep painting the previous defaults until refresh.
    // localStorage has already painted the last known-good values
    // synchronously; this only reconciles them with the server.
    //
    // try/catch for the same reason resumeInflightRuns is wrapped above: a
    // synchronous throw in here is an unhandled ERROR, not a rejection, and
    // would silently abort every step queued after it.
    try {
      startPreferenceSync(store);
    } catch (err) {
      console.warn('[session] preference sync failed to start:', err?.message || err);
    }

    startLicenseRefresh(store);

    // Rejoin any chat turn still generating when this tab last went away.
    // Deliberately not awaited: each reattach holds an SSE connection open
    // until its run finishes, which can be minutes.
    // Promise.resolve() because resumeInflightRuns is INJECTABLE (see opts) and
    // so is not guaranteed to return a promise. Calling .catch() on a bare
    // undefined throws TypeError SYNCHRONOUSLY, and this runs inside idle() — a
    // timer with no caller — so it escapes as an unhandled ERROR rather than a
    // rejection anything can observe. That fails the entire run while every
    // test passes ('Tests 3452 passed | Errors 1 error'), which is the least
    // debuggable shape a failure can take, and it breaks the invariant this
    // function is documented to hold: startSession never rejects.
    Promise.resolve(resumeInflightRuns(store)).catch((err) => {
      console.warn('[session] run reattach sweep failed:', err?.message || err);
    });

    // One-time repair for transcripts saved before chat channels declared
    // their ownership. Without it every workspace / artifact / widget chat
    // stays listed among the user's real conversations.
    Promise.resolve(store.dispatch('chatUnified/reclaimChannelScopes'))
      .then((r) => {
        if (r?.scoped) {
          console.log(`[session] reclaimed ${r.scoped}/${r.total} channel transcript(s)`);
          store.dispatch('contentOutputs/fetchOutputs', { force: true });
        }
      })
      .catch((err) => {
        console.warn('[session] scope reclaim failed:', err?.message || err);
      });
  }, { timeout: 2000 });
}

/**
 * Everything that must stop or be forgotten when a session ends.
 *
 * The mirror image of startSession, and the half that was missing entirely:
 * logout used to clear 4 of the 12 stores `initializeStore` fills, leave the
 * connector poller running against a dead token, and leave the hourly license
 * timer ticking for a user who was no longer signed in.
 */
export function endSession(store, { reason = 'unknown' } = {}) {
  console.log(`[session] ending (${reason})`);
  inFlight = null;
  stopLicenseRefresh();
  // Detach the preference subscriber and drop anything queued. Without this a
  // sign-out leaves it watching the store, and a debounced push from the
  // previous user can land under the NEXT user's token — writing one person's
  // theme into another's account. The in-memory "keys this user touched" set
  // has to go the same way, or it suppresses the next user's hydration.
  stopPreferenceSync();
  // Stops connector polling and clears every user-scoped store, in that order.
  // Derived from one table rather than the ad-hoc four-store list that used to
  // live in userAuth.logout — see resetUserScopedData in store/state.js.
  return store.dispatch('resetUserScopedData');
}

/**
 * Watch the session state and run the transitions.
 *
 * `sessionState` is the honest signal — it is granted only by the backend that
 * serves this app's data (see userAuth.verifySession) and revoked only by a
 * definitive rejection or an explicit logout. Watching it means no sign-in path
 * has to remember to do anything.
 *
 * @returns {Function} unwatch, for tests and teardown
 */
export function watchSession(store, opts = {}) {
  return store.watch(
    (state) => state.userAuth.sessionState,
    (next, prev) => {
      if (next === prev) return;
      if (next === 'valid') {
        startSession(store, { ...opts, reason: prev === 'unknown' ? 'session verified' : 'signed in' });
      } else if (prev === 'valid') {
        // Only a session that actually STARTED needs ending. unknown -> invalid
        // at boot (no token, or a token the backend rejected) never loaded
        // anything, and firing a teardown there would clear a store the user
        // may legitimately be looking at while signed out.
        endSession(store, { reason: `session ${next}` });
      }
    },
  );
}

/**
 * Adopt a cached signed license if it belongs to THIS session and is still
 * valid; otherwise discard it and report that a fresh one is needed.
 *
 * Lifted verbatim from main.js. It is session-scoped, not boot-scoped: a login
 * can equally well find a usable cached license for the same subject, and
 * before this move it could only ever be consulted on a page load.
 *
 * @returns {boolean} whether validateLicense still needs to run
 */
function hydrateCachedLicense(store) {
  const token = store.state.userAuth.token;
  let cached;
  try {
    cached = localStorage.getItem('signedLicense');
  } catch {
    return true; // storage unavailable; just revalidate
  }
  if (!cached) return true;

  try {
    const parsed = JSON.parse(cached);
    const expiresAt = parsed?.license?.expiresAt;
    const now = Math.floor(Date.now() / 1000);

    // Unexpired is necessary but NOT sufficient. A license is issued to a
    // subject, and the app fetches an anonymous one whenever no token is
    // present yet. That license is genuine, signed, and good for 7 days — it
    // just grants the free tier to nobody in particular. Caching it past login
    // is what makes a paid account render as Community Core until it expires.
    const belongsToThisSession = licenseMatchesSubject(parsed, token);

    if (expiresAt && expiresAt > now + 300 && belongsToThisSession) {
      store.commit('userAuth/SET_SIGNED_LICENSE', parsed);
      console.log('[session] using cached license (still valid)');
      return false;
    }
    if (!belongsToThisSession) {
      console.log(
        `[session] cached license was issued to "${licenseSubject(parsed)}" but this ` +
          `session is "${authSubject(token)}" — revalidating.`,
      );
      localStorage.removeItem('signedLicense');
    }
  } catch {
    localStorage.removeItem('signedLicense');
  }
  return true;
}

function startLicenseRefresh(store) {
  stopLicenseRefresh();
  licenseRefreshTimer = setInterval(() => {
    store.dispatch('userAuth/refreshLicenseIfNeeded').catch((error) => {
      console.error('[session] periodic license refresh failed:', error);
    });
  }, LICENSE_REFRESH_INTERVAL);
}

export function stopLicenseRefresh() {
  if (licenseRefreshTimer) {
    clearInterval(licenseRefreshTimer);
    licenseRefreshTimer = null;
  }
}

/** Test seam: forget all module-local session scope. */
export function __resetSessionScopeForTests() {
  inFlight = null;
  stopLicenseRefresh();
}
