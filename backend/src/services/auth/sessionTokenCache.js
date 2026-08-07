/**
 * The last cloud session token this install has seen verified.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Several things this backend does on the user's behalf run with NO REQUEST IN
 * SCOPE, and therefore no way to prove who they are to api.agnt.gg:
 *
 *   - EmailReceiver / WebhookReceiver poll every 10 seconds from a timer
 *   - AuthManager.getValidAccessToken is called from workflow nodes and plugins
 *   - the send-email action and the orchestrator's send_email tool
 *
 * Every one of those calls the remote API with no Authorization header, which
 * is precisely why those endpoints had to stay open to anonymous callers — and
 * why one of them could be asked for any user's OAuth token. The server cannot
 * start requiring a credential until the client is able to present one.
 *
 * `getUserTokenFromSession` already existed, but it needs a `req`. A timer has
 * no `req`. This module is the missing piece: the same token, remembered.
 *
 * ---------------------------------------------------------------------------
 * WHY A SINGLE SLOT IS CORRECT HERE, AND WHERE IT WOULD NOT BE
 * ---------------------------------------------------------------------------
 * This is the DESKTOP backend. It serves exactly one human — the one running
 * the app — and its own database has a single user row. Background pollers
 * poll on behalf of that person and nobody else, so "the current user's token"
 * is a well-defined thing.
 *
 * That assumption is load-bearing, so it is asserted rather than left implicit:
 * if a SECOND distinct user id is ever seen, the cache empties itself and stays
 * empty. A wrong token is far worse than no token — it would attribute one
 * user's polling to another — and multi-user is exactly the scenario where
 * this file must be replaced by a per-request credential rather than quietly
 * carrying on.
 *
 * Nothing is persisted. The token lives in memory only, and a restart simply
 * means the next authenticated request from the UI re-populates it.
 */

/**
 * This module performs NO I/O. It is a slot with a safety rule, and it is on the
 * hot path of every authenticated request — anything that reaches the network
 * belongs at the call site, not here.
 */

/** @type {{token: string, userId: string, seenAt: number} | null} */
let current = null;

/** Set once a conflict is detected; disables the cache for the process. */
let poisoned = false;

/**
 * Tokens are 30-day, but a cached one should not outlive the user's presence by
 * much: if the app has sat unused for a day, the next poll can wait for the UI
 * to prove someone is there. Long enough to cover an idle overnight, short
 * enough that a stale token is not used indefinitely.
 */
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

/**
 * Remember a token that has ALREADY been verified by the caller.
 *
 * @param {string} token   the raw JWT, no "Bearer " prefix
 * @param {string} userId  the subject the caller verified it against
 */
export function rememberSessionToken(token, userId) {
  if (poisoned) return;
  if (typeof token !== 'string' || token.length === 0 || !userId) return;

  if (current && current.userId !== userId) {
    // Two identities on one desktop backend. The single-slot assumption above
    // does not hold, so stop guessing rather than attribute work to the wrong
    // person. Loud, because it means this module needs replacing, not tuning.
    console.error(
      `[sessionTokenCache] two user ids seen on one install (${current.userId} then ${userId}). ` +
        `Disabling the cache: background calls will go unauthenticated rather than use the wrong identity.`
    );
    current = null;
    poisoned = true;
    return;
  }

  current = { token, userId, seenAt: Date.now() };
}

/** The remembered token, or null. Never throws. */
export function getSessionToken() {
  if (poisoned || !current) return null;
  if (Date.now() - current.seenAt > MAX_AGE_MS) {
    current = null;
    return null;
  }
  return current.token;
}

/** The user the remembered token belongs to, or null. */
export function getSessionUserId() {
  if (poisoned || !current) return null;
  return current.userId;
}

/**
 * Authorization header for a background call, or an empty object.
 *
 * Returning `{}` rather than a header with an empty value is deliberate: a
 * literal `Authorization: Bearer undefined` is how the webhook receiver's
 * comparison bug turned a missing credential into a valid password. An absent
 * header is unambiguous; a malformed one invites something to try to parse it.
 */
export function authHeader() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Forget everything. Used on sign-out and by tests. */
export function clearSessionToken() {
  current = null;
}

/** Test seam: also clears the poison latch. */
export function __resetSessionTokenCacheForTests() {
  current = null;
  poisoned = false;
}
