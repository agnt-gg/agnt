/**
 * THE HANDOVER POINT BETWEEN THE USER'S REAL BROWSER AND THE DESKTOP APP.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Signing in with Google used to open a `window.open` popup, which Electron
 * satisfies with a BrowserWindow of its own. That window is a fresh Chromium
 * profile with no cookies, so a user who is already signed into Google gets a
 * blank login form and has to type credentials they should never have been
 * asked for.
 *
 * The fix is the one RFC 8252 prescribes for native apps: send them to their
 * REAL browser, where the session already exists, and take the answer back on
 * a loopback address. That is what this store holds — the short window during
 * which a sign-in is in flight and an answer is expected.
 *
 * ---------------------------------------------------------------------------
 * THE NONCE IS THE CREDENTIAL, SO IT IS TREATED LIKE ONE
 * ---------------------------------------------------------------------------
 * The endpoints that use this store cannot require a session: the whole point
 * is that the user does not have one yet. So the nonce is the only thing
 * standing between a local process and someone's session token, and it gets
 * every property that implies:
 *
 *   - 256 bits from `crypto.randomBytes`, never `Math.random`.
 *   - Single use. Claiming deletes it, so a second claim gets nothing.
 *   - Short lived. Five minutes is far longer than a sign-in takes and far
 *     shorter than a machine is left unattended.
 *   - Write once. A completed handoff cannot be overwritten, so a process that
 *     learns a nonce cannot swap the token out from under the user.
 *   - Capped in number, so a caller cannot grow this without bound.
 *
 * In-memory by design. A pending sign-in does not survive a restart, and
 * should not: the browser tab that would answer it is gone too.
 */

import crypto from 'crypto';

/** Long enough that guessing is not a strategy. */
const NONCE_BYTES = 32;

/** A sign-in that has not completed in this long is abandoned, not slow. */
export const HANDOFF_TTL_MS = 5 * 60 * 1000;

/**
 * A user cannot be signing in more times than this at once. The cap exists so
 * that a local process cannot turn "start a sign-in" into unbounded memory.
 */
export const MAX_PENDING_HANDOFFS = 16;

/** nonce -> { createdAt, token }  (token null until the browser answers) */
const pending = new Map();

function sweepExpired(now = Date.now()) {
  for (const [nonce, entry] of pending) {
    if (now - entry.createdAt > HANDOFF_TTL_MS) pending.delete(nonce);
  }
}

/**
 * Begin a sign-in and return the nonce that identifies it.
 *
 * @returns {string} hex nonce
 */
export function createHandoff() {
  sweepExpired();

  // Sweeping first means a caller only hits this if that many sign-ins really
  // are in flight right now. Dropping the OLDEST is right: it is the one the
  // user has most likely abandoned.
  while (pending.size >= MAX_PENDING_HANDOFFS) {
    const oldest = pending.keys().next().value;
    pending.delete(oldest);
  }

  const nonce = crypto.randomBytes(NONCE_BYTES).toString('hex');
  pending.set(nonce, { createdAt: Date.now(), token: null });
  return nonce;
}

/**
 * Record the token the browser came back with.
 *
 * @returns {boolean} whether a sign-in was actually waiting for this
 */
export function completeHandoff(nonce, token) {
  sweepExpired();

  if (typeof nonce !== 'string' || typeof token !== 'string' || token === '') return false;

  const entry = pending.get(nonce);
  if (!entry) return false;

  // Write once. Without this, anything that learned the nonce could replace a
  // delivered token before the app claims it, and the app would adopt the
  // replacement without a way to tell.
  if (entry.token !== null) return false;

  entry.token = token;
  return true;
}

/**
 * Take the token, if it has arrived. Single use.
 *
 * Three outcomes the caller must distinguish, because they mean different
 * things to a user watching a spinner:
 *
 *   { status: 'pending' }  still waiting on the browser
 *   { status: 'ready' }    here it is, and it is now forgotten
 *   { status: 'unknown' }  never existed, already claimed, or expired
 */
export function claimHandoff(nonce) {
  sweepExpired();

  if (typeof nonce !== 'string') return { status: 'unknown' };

  const entry = pending.get(nonce);
  if (!entry) return { status: 'unknown' };

  if (entry.token === null) return { status: 'pending' };

  pending.delete(nonce);
  return { status: 'ready', token: entry.token };
}

/** Test seam. Not used in production code. */
export function __resetHandoffsForTests() {
  pending.clear();
}

/** Test seam: how many sign-ins are in flight. */
export function __pendingCountForTests() {
  return pending.size;
}
