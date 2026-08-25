/**
 * WHICH ORIGINS MAY COMPLETE AN OAUTH CONNECTION.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * Three `message` handlers act on an `oauth-callback` payload by POSTing the
 * forwarded `code` to `${REMOTE_URL}/auth/callback` **with the current user's
 * bearer token**. Whoever can reach those handlers can therefore have an OAuth
 * authorization code of their choosing redeemed against the victim's account.
 *
 * Two of them guarded that with:
 *
 *   allowedOrigins.some((origin) =>
 *     event.origin === origin || event.origin.includes('localhost'))
 *
 * The second term never references the callback's own `origin` parameter, so
 * it is a constant OR'd into every iteration — in effect an unconditional
 * substring test on the sender's origin. Every one of these is admitted:
 *
 *   https://localhost.evil.com     https://evil-localhost.io
 *   http://localhostage.com        https://notlocalhost.xyz
 *
 * all of them registrable by anyone. The third handler (Connectors.vue) had no
 * origin check at all, so `https://evil.com` reached it directly.
 *
 * The consequence is account grafting, not token theft: the ATTACKER'S Google
 * / Gmail / Drive account gets linked under the VICTIM'S AGNT user, and the
 * victim's later "read my email" or "save this to Drive" runs operate on the
 * attacker's account. Nothing on screen indicates it happened.
 *
 * Cross-origin *sending* is permitted by design and cannot be prevented — the
 * receiver's origin check IS the trust boundary. It has to be exact.
 *
 * ---------------------------------------------------------------------------
 * WHY LOOPBACK IS MATCHED ON HOSTNAME, AND ONLY IN A LOOPBACK APP
 * ---------------------------------------------------------------------------
 * Development genuinely needs it: the Vite dev server and the backend sit on
 * different loopback ports, so an exact-origin allowlist alone would break the
 * OAuth flow for anyone running from source.
 *
 * That need is met by parsing the origin and comparing its HOSTNAME against a
 * fixed set. `new URL('https://localhost.evil.com').hostname` is
 * `'localhost.evil.com'`, which is not `'localhost'` — the substring hole
 * closes without costing developers anything.
 *
 * The allowance is further conditioned on the APP ITSELF being served from a
 * loopback host. A hosted tenant therefore never accepts a loopback sender,
 * so a developer convenience cannot become a production trust rule.
 */

import { API_CONFIG } from '@/tt.config.js';

/**
 * Hosts that mean "this machine". Compared exactly, never by substring.
 * WHATWG `URL` normalises an IPv6 literal to bracketed form in `hostname`.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The literal string an opaque origin serialises to — a sandboxed iframe, a
 * `data:` document, some `file:` contexts. It identifies nobody, so it can
 * never be a match, not even against an app that is itself opaque.
 */
const OPAQUE_ORIGIN = 'null';

function hostnameOf(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin) {
  const hostname = hostnameOf(origin);
  return hostname !== null && LOOPBACK_HOSTS.has(hostname);
}

/**
 * May a `message` from this origin be allowed to complete an OAuth connection?
 *
 * @param {string} eventOrigin  the `event.origin` of the received message
 * @param {Window} [win]        injectable for tests
 * @param {string} [remoteUrl]  injectable for tests; the AGNT API base URL
 * @returns {boolean}
 */
export function isTrustedOAuthMessageOrigin(
  eventOrigin,
  win = globalThis.window,
  remoteUrl = API_CONFIG?.REMOTE_URL,
) {
  // An absent or opaque origin identifies nobody. Unlike the popup handover in
  // utils/googleAuthPopup.js there is no second signal to fall back on here, so
  // this refuses rather than abstains.
  if (typeof eventOrigin !== 'string') return false;
  if (eventOrigin === '' || eventOrigin === OPAQUE_ORIGIN) return false;

  const appOrigin = win?.location?.origin;

  // The app talking to itself: the in-popup callback page on our own origin.
  if (appOrigin && eventOrigin === appOrigin) return true;

  // The AGNT API, whose callback page forwards the raw code in the Electron
  // path. Compared as a parsed origin so a trailing path in the configured
  // URL cannot cause a miss.
  const remoteOrigin = originOf(remoteUrl);
  if (remoteOrigin && eventOrigin === remoteOrigin) return true;

  // Any loopback port, but only while we are ourselves on loopback.
  if (appOrigin && isLoopbackOrigin(appOrigin) && isLoopbackOrigin(eventOrigin)) return true;

  return false;
}
