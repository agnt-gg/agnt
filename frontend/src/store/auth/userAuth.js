import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';
import LicenseValidator from '@/services/LicenseValidator.js';
import { withFreshness } from '../_utils/withFreshness.js';
import { setMediaCookie, clearMediaCookie } from '@/services/mediaAuth.js';
import { useAppVersion } from '@/composables/useAppVersion.js';
import { TTL } from '../_utils/freshnessConfig.js';
import { authSubject, licenseMatchesSubject, licenseSubject } from './licenseIdentity.js';
// `export { userFromJwt } from './jwt.js'` below re-exports the binding but does
// NOT introduce it into this module's scope, and it is called internally.
import { userFromJwt } from './jwt.js';

// All fetch* actions in this module are wrapped with `withFreshness` so the
// second call within the per-action TTL is a no-op. Pass `{ forceRefresh: true }`
// to bypass — required after writes that change the underlying data.

/**
 * Classify an axios error into a structured auth failure record so the router
 * guard can tell the user why their session is no longer trusted, and admins
 * can grep logs by reason. Distinguishes:
 *
 *   - http_401 / http_403 / http_5xx / http_<N>  — server responded
 *   - plan_denied                                 — 403, but about ENTITLEMENT
 *   - timeout                                     — request aborted at the timeout
 *   - network_error                               — request never reached the server
 *   - unknown                                     — anything else
 *
 * The caller decides whether each reason warrants clearing the local token.
 * Definitive client-side rejections (401/403/unauthenticated_response/no_token)
 * should clear; transient failures (5xx/network/timeout) should NOT.
 *
 * ---------------------------------------------------------------------------
 * WHY 403 IS NOT ONE THING
 * ---------------------------------------------------------------------------
 * `http_403` is in DEFINITIVE_AUTH_REJECTIONS because it has always meant
 * "this account is forbidden" — suspended, disabled — and clearing the token is
 * the right answer to that.
 *
 * The server now also returns 403 for a second, unrelated reason: the caller is
 * perfectly authenticated but their PLAN does not include the feature. Routing
 * that down the same path would be catastrophic in a specific way: a free user
 * hits a paid endpoint, gets 403, is logged out, logs back in, and hits it
 * again — an infinite login loop that logging in cannot fix, which is exactly
 * the failure mode that a JWT_SECRET rotation would have caused and that we
 * have already been bitten by once.
 *
 * So entitlement denials are classified separately. They are NOT an auth
 * failure, they are a product state, and the UI should render an upgrade
 * prompt. The distinguishing marker is the server's own response shape
 * (`requiredFeature`), not the status code — see gatedFeature in the API's
 * routes/Middleware.js.
 */

/** A 403 that is about entitlement, not identity. Never clears the session. */
function isPlanDenial(response) {
  const data = response?.data;
  if (!data || typeof data !== 'object') return false;
  return Boolean(data.requiredFeature) || data.error === 'Feature not available' || data.error === 'Upgrade required';
}

export function classifyAuthError(error) {
  const timestamp = Date.now();
  if (error?.response) {
    const status = error.response.status;
    const detail = error.response.data?.error || null;
    if (status === 401) return { reason: 'http_401', status, detail, timestamp };
    if (status === 403 && isPlanDenial(error.response)) {
      return {
        reason: 'plan_denied',
        status,
        detail,
        requiredFeature: error.response.data?.requiredFeature || null,
        timestamp,
      };
    }
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

// Implemented in ./jwt.js so identity helpers can read a token's subject
// without a circular import back through this store module. Re-exported here
// because existing call sites (and specs) import it from userAuth.js.
export { userFromJwt } from './jwt.js';

/**
 * Degraded-mode feature derivation: when no verified license is available,
 * derive a feature grant from the subscription the server attested via
 * GET /users/subscription/status.
 *
 * Why this exists: `isPremium` was deliberately loosened to trust the
 * subscription so a failed license validation can't lock paid users out —
 * but the per-feature gates (webhooks, emailServer, apiAccess…) still
 * required a valid license, so the two sources could disagree and the
 * license-gated pages went dark while the app simultaneously reported the
 * user as premium. This extends the same principle to the feature gates.
 *
 * Deliberately conservative:
 *   - free / unknown plans get NOTHING from the fallback (strictness intact)
 *   - only features the subscription payload actually attests are granted;
 *     anything absent (e.g. `plugins`) stays false rather than being invented
 *   - shapes are normalized to the license form ({ enabled, … }) so callers
 *     like useLicense's hasWebhooks work identically in both modes
 *
 * @param {object|null} subscription - raw /users/subscription/status payload
 * @param {string|null} planType
 * @param {string} featureName
 * @returns {boolean|object} false, or a license-shaped feature grant
 */
export function featureFromSubscription(subscription, planType, featureName) {
  if (!subscription || !planType || planType === 'free') return false;
  const f = subscription.features || {};
  switch (featureName) {
    case 'webhooks':
      return f.webhooks ? { enabled: true, interval: f.webhookInterval ?? null } : false;
    case 'emailServer':
      return f.emailServer ? { enabled: true, interval: f.emailInterval ?? null } : false;
    case 'cloudSync':
      return f.cloudSync ? { enabled: true, interval: f.syncInterval ?? null } : false;
    case 'apiAccess':
      return f.apiAccess ? { enabled: true, tier: planType } : false;
    case 'multiUser':
      return f.multiUser ? { enabled: true, maxSeats: f.maxUsers ?? 1 } : false;
    default: {
      // Boolean passthrough for flat flags (whiteLabel, sla, coreFeatures…).
      // Absent keys — notably `plugins`, which the subscription payload does
      // not carry — must NOT be synthesized from the plan tier.
      const v = f[featureName];
      return typeof v === 'boolean' ? v : false;
    }
  }
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
  // DELIBERATELY ABSENT: 'plan_denied'. It is a 403, but it means "your plan
  // does not include this", not "your credential is bad". Adding it here would
  // log out every free user who touches a paid endpoint, and re-logging in
  // would return them to the same 403 — an unbreakable loop.
]);

export function isDefinitiveAuthRejection(reason) {
  return DEFINITIVE_AUTH_REJECTIONS.has(reason);
}

/**
 * The three states a session can be in, and the ONE that renders the app.
 *
 * ---------------------------------------------------------------------------
 * WHY A TRISTATE AND NOT A BOOLEAN
 * ---------------------------------------------------------------------------
 * `isAuthenticated` used to be `!!state.token` — a string in localStorage.
 * Nothing had verified it, and the server that could verify it was a DIFFERENT
 * server from the one serving the data. So an expired, revoked or simply
 * unverifiable token rendered a complete, populated app.
 *
 * Two states cannot express the situation honestly, because "not confirmed
 * valid" and "confirmed invalid" demand opposite responses:
 *
 *   VALID    the backend serving this data confirmed the session  -> render
 *   INVALID  it definitively rejected it (401/403)                -> log out
 *   UNKNOWN  we could not get an answer (offline, 5xx, timeout)   -> neither
 *
 * Collapsing UNKNOWN into VALID is the original bug. Collapsing it into
 * INVALID logs people out over a blip. So it is its own state, and it renders
 * nothing while destroying nothing.
 *
 * THE ASYMMETRY IS THE POINT: only a positive confirmation grants a session,
 * only a definitive rejection destroys one. Silence does neither.
 */
export const SESSION = Object.freeze({
  UNKNOWN: 'unknown',
  VALID: 'valid',
  INVALID: 'invalid',
});

/**
 * In-flight verification, shared by concurrent callers.
 *
 * Boot and the router guard both want an answer at the same instant on every
 * launch, and a burst of 401s can ask several more. This is NOT a cache — it
 * holds only a promise that has not settled yet, so every caller still gets a
 * live answer; they just share the one round trip. A real TTL cache here would
 * be a gate that keeps saying "valid" after the session died.
 */
let inFlightVerify = null;

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

    // Has the backend that serves this app's data confirmed the session?
    // See SESSION above. Starts UNKNOWN on every load — deliberately NOT
    // derived from the presence of a token, because a token you have not
    // checked is exactly what this state exists to stop trusting.
    sessionState: SESSION.UNKNOWN,
  },
  mutations: {
    SET_SESSION_STATE(state, next) {
      state.sessionState = next;
    },
    SET_TOKEN(state, token) {
      const subjectChanged = authSubject(state.token) !== authSubject(token);
      state.token = token;
      localStorage.setItem('token', token);

      // A token that has just arrived has not been verified by anything yet.
      // Saying otherwise here is how "I have a token" became "I am signed in":
      // the client would have granted itself a session and only found out it
      // was wrong when every subsequent request 401'd. verifySession promotes
      // this to VALID once the backend actually confirms it.
      state.sessionState = SESSION.UNKNOWN;

      // The session now belongs to someone else. Any license held from the
      // previous subject — including the anonymous one the app fetches before
      // login — describes that subject's entitlements, not this one's. Drop it
      // so the next validateLicense is a real request instead of a cache hit.
      if (subjectChanged && state.signedLicense && !licenseMatchesSubject(state.signedLicense, token)) {
        state.signedLicense = null;
        state.planFeatures = {};
        state.licenseStatus = 'unknown';
        localStorage.removeItem('signedLicense');
      }

      // /api/local-file requires a credential, and browser-issued subresource
      // requests (<img>, <video>, <iframe>, and relative URLs inside served
      // HTML) cannot set an Authorization header. The cookie is the only
      // carrier that reaches them. See services/mediaAuth.js.
      setMediaCookie(token);

      // Sync with backend when token is set
      if (token) {
        syncTokenWithBackend(token);
      }
    },
    CLEAR_TOKEN(state) {
      state.token = null;
      localStorage.removeItem('token');
      clearMediaCookie();
      // No credential, therefore no session. Enforced HERE rather than at the
      // call sites so the invariant cannot be lost by a future caller that
      // forgets — there is no reachable state with a valid session and no
      // token, and this is the only place a token is dropped.
      state.sessionState = SESSION.INVALID;
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
        // A license carries the subject it was issued to. Applying one that
        // belongs to somebody else is how a paid account renders as free:
        // the anonymous license fetched before login is cryptographically
        // valid, so nothing downstream questions it, and its planType 'free'
        // silently overwrites the 'enterprise' that fetchSubscription just
        // established. Refuse it rather than cache a confident wrong answer.
        if (!licenseMatchesSubject(signedLicense, state.token)) {
          console.warn(
            `\u26a0\ufe0f Ignoring license issued to "${licenseSubject(signedLicense)}" — ` +
            `current session is "${authSubject(state.token)}". Will revalidate.`
          );
          state.signedLicense = null;
          state.licenseStatus = 'unknown';
          localStorage.removeItem('signedLicense');
          return;
        }

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
    /**
     * Ask the backend that serves this app's data whether the session is real.
     *
     * This is THE gate. Everything else about auth in this module is profile
     * decoration; this is the only thing that may promote a session to VALID.
     *
     * -----------------------------------------------------------------------
     * WHY BASE_URL AND NOT REMOTE_URL
     * -----------------------------------------------------------------------
     * BASE_URL is, by construction, the backend this window is talking to —
     * localhost in a normal desktop launch, the remote origin when the user
     * chose a remote backend. It is the server that answers with the agents,
     * conversations and outputs on screen.
     *
     * Asking THAT server makes the gate and the data one decision. Asking
     * api.agnt.gg instead — which is what this used to do — made them two, and
     * they could disagree in both directions: a session the data server would
     * reject still rendered a full app, and a network hiccup at a server that
     * holds none of your data could bounce you out of it.
     *
     * It also removes the reason the JWT fallback existed. The old code could
     * not reach its auth server while the app was running, so it decoded the
     * token itself and called that good enough. This server cannot be
     * unreachable while the app is up: if it were, there would be no app — the
     * Electron shell shows the connection page instead.
     *
     * DELIBERATELY NOT wrapped in withFreshness. Every other fetch here is
     * cached by TTL; a security gate answered from a cache is a gate that says
     * "valid" for a session that was revoked a minute ago. The guard only calls
     * this when the session is not already VALID, so the steady-state cost is
     * zero, and the cost when it does run is one loopback round trip.
     *
     * @returns {Promise<'valid'|'invalid'|'unknown'>} the resulting state
     */
    async verifySession({ commit, state }) {
      if (!state.token) {
        commit('SET_AUTH_FAILURE', { reason: 'no_token', timestamp: Date.now() });
        commit('SET_SESSION_STATE', SESSION.INVALID);
        return SESSION.INVALID;
      }
      if (inFlightVerify) return inFlightVerify;

      inFlightVerify = (async () => {
        try {
          const response = await axios.get(`${API_CONFIG.BASE_URL}/users/auth/status`, {
            headers: { Authorization: `Bearer ${state.token}` },
            withCredentials: true,
            timeout: 10000,
          });

          if (response.data?.isAuthenticated && response.data.user) {
            // THE TOKEN EXCHANGE.
            //
            // A hosted backend cannot hold the cloud's signing key (it is
            // public, and that backend is on the open internet), so it verified
            // this token by ASKING api.agnt.gg and handed back one it signed
            // itself. Adopting it is what makes the rest of the app work: media
            // URLs, file routes and the websocket handshake all verify
            // synchronously against the backend's own secret and cannot wait on
            // a remote call. Staying on the cloud token would leave the user
            // signed in with dead sockets and broken images.
            //
            // Desktop never sends one, so this is inert there.
            //
            // Committed BEFORE the session state: SET_TOKEN resets it to
            // UNKNOWN by design, so promoting to VALID has to come after.
            if (response.data.localToken) {
              commit('SET_TOKEN', response.data.localToken);
            }

            commit('SET_USER', response.data.user);
            commit('CLEAR_AUTH_FAILURE');
            commit('SET_SESSION_STATE', SESSION.VALID);
            return SESSION.VALID;
          }

          // A 200 that does not actually confirm anyone. Treated as a refusal,
          // not as an outage: the server answered, and the answer was no.
          commit('SET_AUTH_FAILURE', {
            reason: 'unauthenticated_response',
            status: response.status,
            detail: response.data?.error || null,
            timestamp: Date.now(),
          });
          commit('SET_SESSION_STATE', SESSION.INVALID);
          return SESSION.INVALID;
        } catch (error) {
          const failure = classifyAuthError(error);
          commit('SET_AUTH_FAILURE', failure);

          // The asymmetry, in three lines. A definitive rejection ends the
          // session. Anything else — 5xx, timeout, the backend still booting —
          // leaves it UNKNOWN: not trusted, so nothing renders, but not
          // destroyed either, so a blip does not cost the user their sign-in.
          const rejected = failure.reason === 'http_401' || failure.reason === 'http_403';
          commit('SET_SESSION_STATE', rejected ? SESSION.INVALID : SESSION.UNKNOWN);
          if (!rejected) {
            console.warn(`[userAuth] session unverified (${failure.reason}) — not granting, not clearing`);
          }
          return rejected ? SESSION.INVALID : SESSION.UNKNOWN;
        }
      })();

      try {
        return await inFlightVerify;
      } finally {
        // Cleared unconditionally: if this leaked on a rejection, the gate
        // would answer every future call from a settled promise — a cache,
        // and a permanent one.
        inFlightVerify = null;
      }
    },

    /**
     * Hand this token to the local backend's session store.
     *
     * The backend keeps a server-side session alongside the bearer token; some
     * routes (and the media cookie path) read from it. Three login paths each
     * called this by hand from LoginSection.vue, one of them without awaiting
     * it — which is the usual outcome when a step belongs to "a session has
     * started" but lives in a component. It now runs once, from startSession.
     */
    async syncTokenWithBackend({ state }) {
      if (!state.token) return { ok: false, reason: 'no_token' };
      try {
        const response = await axios.post(
          `${API_CONFIG.BASE_URL}/users/sync-token`,
          {},
          {
            headers: { Authorization: `Bearer ${state.token}` },
            withCredentials: true,
          },
        );
        return { ok: Boolean(response.data?.success) };
      } catch (error) {
        // Non-fatal: the bearer token still authenticates every API call. Only
        // the server-side session convenience is missing.
        console.warn('[userAuth] token sync with local backend failed:', error?.message);
        return { ok: false, reason: 'request_failed' };
      }
    },

    /**
     * Remote PROFILE fetch — name, email, pseudonym, and (via fetchSubscription)
     * plan tier. Talks to api.agnt.gg.
     *
     * NOT a session gate, and it must never become one again. It used to be:
     * the router asked this whether to let you in, and when api.agnt.gg could
     * not be reached it answered out of `userFromJwt` — a DECODE, not a verify
     * — so an unchecked token produced a fully rendered app. The fallback below
     * is still here and still useful, but what it now populates is a display
     * name, not an entitlement. verifySession decides who is signed in.
     *
     * A definitive 401/403 here is still meaningful: this is the server that
     * ISSUED the token, so if it disowns it the credential is dead everywhere,
     * and the session ends. That is the one direction this action may still
     * move the gate — revocation only, never a grant.
     */
    fetchUserData: withFreshness('userAuth.fetchUserData', async ({ commit, state, dispatch }) => {
      if (!state.token) {
        commit('SET_AUTH_FAILURE', { reason: 'no_token', timestamp: Date.now() });
        return;
      }

      // TRANSIENT failures only. The remote auth server being unreachable is
      // not evidence that the token is bad, so a locally-decoded user keeps a
      // paired phone working through an outage or an offline page load.
      //
      // The failure record is deliberately NOT cleared. It is the only
      // diagnostic that explains a degraded session, the router guard reads it,
      // and erasing it turns "server rejected you" into a UI that looks signed
      // in while every API call 401s -- silent wrongness instead of a clean
      // bounce. Keeping it costs nothing: the guard only redirects when there
      // is no user at all, so a transient failure still lets the user through.
      const applyJwtFallback = (reason) => {
        const localUser = userFromJwt(state.token);
        if (!localUser) return false;
        commit('SET_USER', localUser);
        console.warn(`[userAuth] using JWT local user after ${reason}`);
        return true;
      };

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
          // The server answered, and the answer was "no". That is a definitive
          // rejection -- 'unauthenticated_response' is in
          // DEFINITIVE_AUTH_REJECTIONS -- not an outage, so there is nothing
          // here to ride out with a local token.
          //
          // Pairing does not create a session the remote cannot see: /claim
          // hands the phone the initiator's OWN remote-issued token precisely
          // so it has the same capabilities as the desktop (see
          // PairingRoutes.js). If the remote rejects that token it is dead for
          // the desktop too, and the honest response is a clean bounce.
          commit('SET_USER', null);
          commit('SET_AUTH_FAILURE', {
            reason: 'unauthenticated_response',
            status: response.status,
            detail: response.data?.error || null,
            timestamp: Date.now(),
          });
          commit('SET_SESSION_STATE', SESSION.INVALID);
          console.error('Auth status returned but no user data:', response.data);
        }
      } catch (error) {
        const failure = classifyAuthError(error);
        // Always record why. Whether the session survives is a separate
        // question from whether we can explain it, and conflating the two is
        // what made a revoked session look like a working one.
        commit('SET_AUTH_FAILURE', failure);
        // Network/timeout/5xx: restore a local JWT user so a paired phone
        // survives full page loads. Definitive 401/403 get no fallback.
        const definitive = failure.reason === 'http_401' || failure.reason === 'http_403';
        if (definitive) {
          // The issuer disowned the credential. It is dead for every server
          // that trusts it, including the local one, so end the session here
          // rather than wait for the next request to discover it.
          commit('SET_SESSION_STATE', SESSION.INVALID);
        }
        if (definitive || !applyJwtFallback(failure.reason)) {
          console.error(`Error fetching user data (${failure.reason}):`, error);
        }
      }
    }, {
      staleAfter: TTL.userAuthFetchUserData,
      // Scope the cache to the session it was fetched for. A TTL answers "is
      // this data old?", which is the wrong question for a value describing a
      // PERSON: after a logout and a sign-in as someone else, the cached value
      // is not stale, it is somebody else's. See withFreshness.
      identity: (ctx) => authSubject(ctx.state.token),
    }),
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
    }, {
      staleAfter: TTL.userAuthFetchPseudonym,
      identity: (ctx) => authSubject(ctx.state.token),
    }),
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

          // Prove the credential to the backend that will actually serve this
          // user's data BEFORE claiming they are signed in. One loopback round
          // trip, and it converts the whole class of "logged in but every
          // request 401s" (mismatched JWT_SECRET, clock skew, a backend that
          // never got the token) into an honest failure at the login screen.
          const sessionState = await dispatch('verifySession');
          if (sessionState !== SESSION.VALID) {
            return {
              success: false,
              error: 'Signed in, but this computer\u2019s AGNT backend rejected the session. Restart AGNT and try again.',
            };
          }

          // If this is a new user, reset onboarding so they see it
          if (response.data.isNewUser) {
            commit('RESET_ONBOARDING');
          }

          // Nothing else is loaded here on purpose. verifySession above moved
          // sessionState to 'valid', and sessionBoot's watcher takes it from
          // there: subscription, license, pseudonym, initializeStore, provider
          // polling, user settings, run resumption. This path used to do four
          // of those by hand while the two Google paths did two and neither
          // did initializeStore — which is precisely why it is no longer any
          // individual sign-in path's job to remember.
          return { success: true, isNewUser: response.data.isNewUser };
        }
        return { success: false, error: 'Verification failed' };
      } catch (error) {
        const errorMessage = error.response?.data?.error || 'Failed to verify code. Please try again.';
        return { success: false, error: errorMessage };
      }
    },
    async devLogin({ commit }) {
      if (process.env.NODE_ENV === 'development') {
        const mockToken = 'dev-' + Math.random().toString(36).substring(2);
        const mockUser = {
          name: 'Dev User',
          email: 'dev@local.test',
        };
        commit('SET_TOKEN', mockToken);
        commit('SET_USER', mockUser);
        // A dev token cannot be verified by the backend, so grant the session
        // explicitly. This is the ONLY place that sets 'valid' without a server
        // confirmation, it is behind a NODE_ENV check, and it exists so the dev
        // path exercises the same session-start sequence as every real login.
        commit('SET_SESSION_STATE', SESSION.VALID);
        // No data loading here — the session watcher does it, same as every
        // other sign-in path.
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
    }, {
      staleAfter: TTL.userAuthFetchSubscription,
      // 5 minutes is short, but "which plan is this account on" is exactly the
      // kind of answer that must never survive a change of account.
      identity: (ctx) => authSubject(ctx.state.token),
    }),
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
      // getAppVersion() is an IPC call and therefore a Promise. Calling it
      // without await sent the Promise itself, which serialised as the string
      // "[object Object]" -- 92 of 191 installs reported that as their version,
      // and the other 99 reported the hardcoded '1.0.0' fallback because a
      // browser has no window.electron. Neither was a real version, so version
      // telemetry was 100% dead while looking populated.
      //
      // useAppVersion() awaits the IPC call, falls back to the backend's
      // /api/version for non-Electron installs, and only then yields '0.0.0' --
      // a sentinel that reads as "unknown" rather than impersonating a release.
      const { fetchVersion } = useAppVersion();
      const appVersion = await fetchVersion();

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
    }, {
      staleAfter: TTL.userAuthValidateLicense,
      // Scope the 1-hour cache to the session it was fetched for. Without
      // this, the unauthenticated validateLicense that main.js fires at boot
      // parks an anonymous license in the cache, and the post-login
      // validateLicense below is silently answered from it.
      identity: (ctx) => authSubject(ctx.state.token),
    }),

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
      // CLEAR_TOKEN already forces sessionState to INVALID; the explicit commit
      // here states the intent at the call site rather than relying on a side
      // effect two mutations away.
      commit('SET_SESSION_STATE', SESSION.INVALID);
      commit('CLEAR_TOKEN');
      commit('SET_USER', null);
      commit('SET_PSEUDONYM', null);
      commit('CLEAR_SUBSCRIPTION');
      commit('CLEAR_LICENSE');
      // Clear onboarding status on logout so new users see onboarding
      commit('RESET_ONBOARDING');

      // Feature stores are DELIBERATELY not cleared here any more.
      //
      // This used to name four of them (agents, workflows, tools, goals) while
      // `initializeStore` fills twelve, so the other eight kept the previous
      // user's data and their `lastFetched` timestamps — which then made the
      // NEXT user's fetch short-circuit. A list of stores maintained inside the
      // auth module was always going to fall behind the list of stores the app
      // actually loads.
      //
      // Clearing is now driven by the session ENDING rather than by this one
      // way of ending it: sessionBoot's watcher sees sessionState leave 'valid'
      // — whether from here, from a 401 caught by the axios interceptor, or
      // from a backend that rejected the token at boot — and dispatches
      // resetUserScopedData, which is derived from the module table in
      // store/state.js.
    },
  },
  getters: {
    /**
     * Signed in means CONFIRMED signed in.
     *
     * This was `!!state.token` — the presence of a string in localStorage,
     * which nothing had verified and which the app could not verify against
     * the server that held its data. Every consumer of this getter (the
     * sidebar, the canvas toolbar, screen navigation, the login panel) was
     * therefore gating on "a token exists", and an expired or revoked one
     * rendered the entire app.
     *
     * Reading sessionState instead means the answer comes from the backend
     * that serves the data — and, crucially, that UNKNOWN renders nothing.
     * See SESSION above.
     */
    isAuthenticated: (state) => state.sessionState === SESSION.VALID,
    sessionState: (state) => state.sessionState,
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
      const license = state.signedLicense?.license;

      // Primary path: a verified license is the authoritative, stricter
      // instrument — when present it decides, including deciding "disabled".
      if (getters.hasValidLicense && license && license.features) {
        const feature = license.features[featureName];

        // Handle boolean features
        if (typeof feature === 'boolean') return feature;

        // Handle object features
        if (typeof feature === 'object' && feature !== null) {
          return feature.enabled ? feature : false;
        }

        return false;
      }

      // Degraded mode: no verified license (validation failed, cache dropped,
      // or not yet fetched). Fall back to what the subscription attests so a
      // paid account's gates don't go dark while isPremium still reads true.
      return featureFromSubscription(state.subscription, state.planType, featureName);
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
