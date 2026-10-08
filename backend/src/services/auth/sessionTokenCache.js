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
 * ONE ENTRY PER ACCOUNT, NEVER A SHARED SLOT
 * ---------------------------------------------------------------------------
 * This used to be a single slot that, on seeing a second user id, emptied
 * itself and stayed empty until restart. That was safe while a desktop served
 * one human. It stopped being true when the same install began switching
 * between accounts (the Focused/mobile shell signs in as either): the first
 * switch silently disabled every server-stored connection for BOTH accounts,
 * reported only as "No valid token available".
 *
 * So entries are keyed by user id. A caller that knows whom it acts for asks
 * for THAT account's token and gets it or nothing — never another account's.
 * A wrong token is still far worse than no token; keying by user is what makes
 * "no token" the only failure mode.
 *
 * Callers with no user in scope (install-wide services, plan checks) get the
 * ACTIVE account: the one that most recently authenticated a request, which is
 * whoever is signed in right now.
 *
 * Nothing is persisted. The token lives in memory only, and a restart simply
 * means the next authenticated request from the UI re-populates it.
 *
 * ---------------------------------------------------------------------------
 * THE CACHE IS PER-PROCESS, AND THE POLLERS ARE NOT IN THIS PROCESS
 * ---------------------------------------------------------------------------
 * This was built to serve the receivers named at the top of this file — and it
 * did not, for two days, because of a boundary nobody wrote down:
 *
 *   rememberSessionToken()  is called ONLY from routes/Middleware.js,
 *                           i.e. inside an Express handler, i.e. the MAIN process
 *   WebhookReceiver         polls only when IS_WORKFLOW_PROCESS === 'true',
 *                           i.e. inside the FORKED CHILD
 *   this module             is in-memory, so the child gets its own empty copy
 *
 * The child imports Middleware but never executes it (it serves no HTTP), so
 * `authHeader()` there returned `{}` forever. Every background call went out
 * anonymous no matter how many clients updated, and the adoption counter the
 * whole staged rollout depends on could not move off zero.
 *
 * The fix is `subscribe()` below: the main process forwards each new token over
 * the IPC channel the bridge already owns, and the child calls
 * rememberSessionToken() with it. See workflow/WorkflowProcessBridge.js and
 * workflow/WorkflowProcess.js — and sessionTokenCache.ipc.test.js, which forks
 * a real child rather than trusting that those two agree.
 */

/**
 * This module performs NO I/O. It is a slot with a safety rule, and it is on the
 * hot path of every authenticated request — anything that reaches the network
 * belongs at the call site, not here. `subscribe()` is a synchronous callback
 * registry, not a transport: the bridge does the sending.
 *
 * `crypto` is the one import allowed, and only for a fingerprint used in log
 * lines. It is pure CPU with no I/O surface, which is the property the guard
 * test in sessionTokenCache.test.js actually cares about.
 */
import { createHash } from 'crypto';
import { isApiKey } from './apiKey.js';
import { credentialUserId } from './tenantOwnership.js';

/** @typedef {{token: string, userId: string, seenAt: number, expiresAt: number|null}} SessionEntry */

/** @type {Map<string, SessionEntry>} keyed by user id */
const entries = new Map();

/** The account that most recently authenticated a request, or null. */
let activeUserId = null;

/**
 * Accounts switched between on one install are a handful. The cap only exists
 * because this map is written from the request path, and nothing reachable
 * from there may grow without a limit. The least recently seen goes first.
 */
const MAX_ACCOUNTS = 8;

/** @type {Set<(entry: {token: string, userId: string}) => void>} */
const subscribers = new Set();

/**
 * Tokens are 30-day, but a cached one should not outlive the user's presence by
 * much: if the app has sat unused for a day, the next poll can wait for the UI
 * to prove someone is there. Long enough to cover an idle overnight, short
 * enough that a stale token is not used indefinitely.
 */
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

/**
 * Observe tokens as they arrive, so another module can forward them somewhere
 * this process cannot reach on its own — specifically, across the fork.
 *
 * FIRES ON CHANGE ONLY. `rememberSessionToken` runs on EVERY authenticated
 * request, so notifying unconditionally would push an IPC message per request
 * (hundreds a minute) to re-send a token the child already has. Subscribers
 * therefore see a token exactly when it becomes new, which is also the only
 * moment anyone downstream needs to act.
 *
 * @param {(entry: {token: string, userId: string}) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

/**
 * The `exp` claim in epoch ms, or null when there is no readable one.
 *
 * This DECODES; it does not verify — which is safe HERE and nowhere else. The
 * only caller is rememberSessionToken, whose stated contract is that the caller
 * has ALREADY verified the signature. Read `exp` off an unverified token and it
 * becomes attacker-controlled: a forged far-future expiry would be a way to pin
 * this slot to a credential of the attacker's choosing.
 *
 * @param {string} token
 * @returns {number|null}
 */
function tokenExpiryMs(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    // Not a JWT, or not one we can read. Never throw — this runs inside the
    // authenticated request path.
    return null;
  }
}

/**
 * Should `incomingToken` displace the credential already held?
 *
 * @param {string} incomingToken
 * @param {{token: string, expiresAt: number|null}} incumbent
 * @returns {boolean}
 */
function supersedes(incomingToken, incumbent) {
  // An incumbent that has already expired is worthless, so anything replaces
  // it. Without this, a lifetime that legitimately SHORTENS (an issuer moving
  // from 30-day to 7-day tokens) would pin the slot to a dead credential and
  // the rule below would never let the live one in.
  if (incumbent.expiresAt !== null && incumbent.expiresAt <= Date.now()) return true;

  // An API key never expires, so the expiry rule below cannot rank it.
  // A live sign-in token is preferred: it is what the signed-in app holds,
  // and signing out ends it. A key fills the slot only when no live token
  // does (a headless install driven by a bot), a sign-in token always
  // takes the slot back, and a new key replaces an old one.
  if (isApiKey(incomingToken)) return isApiKey(incumbent.token);
  if (isApiKey(incumbent.token)) return true;

  const incomingExpiry = tokenExpiryMs(incomingToken);

  // Unreadable on either side: fall back to the previous newest-wins behaviour
  // rather than refuse a credential we cannot reason about. Real JWTs always
  // carry `exp`; this path exists for tests and for anything that is not a JWT.
  if (incomingExpiry === null || incumbent.expiresAt === null) return true;

  // Strictly later only. "Adopt on tie" is precisely the coin-flip that
  // produces the churn this rule exists to stop.
  return incomingExpiry > incumbent.expiresAt;
}

/** @param {number|null} ms */
function iso(ms) {
  return ms === null ? 'unknown' : new Date(ms).toISOString();
}

/**
 * A short, stable, non-reversible label for a credential, so a log line can say
 * WHICH token without ever saying what it is. The token itself is never logged.
 */
function fingerprint(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

/**
 * Name a superseded credential once, not once per request.
 *
 * This is the diagnostic that identifies the second source: the fingerprint
 * separates "one client whose token rotated" from "two clients each holding a
 * different valid credential", and the expiries say which one is behind.
 */
const reportedSuperseded = new Set();

function reportSupersededOnce(token, incumbent) {
  const fp = fingerprint(token);
  if (reportedSuperseded.has(fp)) return;
  // Bounded on purpose: nothing reachable from a request path may grow without
  // a limit.
  if (reportedSuperseded.size >= 32) reportedSuperseded.clear();
  reportedSuperseded.add(fp);

  console.warn(
    `[sessionTokenCache] ignoring a shorter-lived token for the same user ` +
      `(offered ${fp} exp=${iso(tokenExpiryMs(token))}, keeping ` +
      `${fingerprint(incumbent.token)} exp=${iso(incumbent.expiresAt)}). ` +
      `Something is presenting a superseded credential.`
  );
}

function notify(entry) {
  // The line that makes this subsystem diagnosable from a log file alone.
  //
  // `subscribers` must be exactly 1 in the main process (the bridge) and 0 in
  // the forked child. Any other number means the module graph is being
  // evaluated more than once and every change is being sent N times — which is
  // indistinguishable from token churn if you only count IPC messages.
  // Fingerprint and expiry, never the token.
  console.log(
    `[sessionTokenCache] token changed: fp=${fingerprint(entry.token)} ` +
      `exp=${iso(entry.expiresAt)} subscribers=${subscribers.size}`
  );

  for (const listener of subscribers) {
    try {
      listener({ token: entry.token, userId: entry.userId });
    } catch (error) {
      // A subscriber must never be able to break authentication. This runs
      // inside the request path; a throw here would 500 a valid login.
      console.warn('[sessionTokenCache] subscriber threw:', error?.message);
    }
  }
}

/**
 * Remember a token that has ALREADY been verified by the caller.
 *
 * @param {string} token   the raw JWT, no "Bearer " prefix
 * @param {string} userId  the subject the caller verified it against
 */
export function rememberSessionToken(token, userId) {
  if (typeof token !== 'string' || token.length === 0 || !userId) return;
  userId = String(userId);
  const switchedAccount = activeUserId !== userId;
  activeUserId = userId;
  const current = entries.get(userId);

  // The same credential as last time. Refresh the liveness stamp and stop —
  // this is the overwhelmingly common path, so it stays one lookup and one
  // comparison with no parsing and no hashing.
  if (current && current.token === token) {
    current.seenAt = Date.now();
    // Switching back to an account already held changes no token, but it does
    // change who the active account is. Forward it so the workflow child's
    // install-wide callers follow the switch. Fires per switch, not per request.
    if (switchedAccount) notify(current);
    return;
  }

  // A DIFFERENT token for the SAME user. Newest-writer-wins reads as harmless
  // and is not: when two clients each hold a valid credential (a second window,
  // a paired device, a stale storage copy), every request from each one flips
  // the slot back, fires the change, and re-pushes across the fork — forever.
  // Measured on a live install: 623 changes in 11 unattended hours, one every
  // ~65s, matching two 60s UI pollers.
  //
  // The noise is the least of it. Background callers have no request in scope,
  // so they use whichever credential landed last. That is nondeterministic
  // today, and becomes an intermittent outage the moment the loser expires
  // while still winning half the races.
  //
  // So: never move to a credential that dies sooner than the one already held.
  // The slot becomes stable under alternation, and background work always holds
  // the longest-lived proof of the user's session.
  if (current && !supersedes(token, current)) {
    // A key deferring to a live sign-in token is the designed order, not a
    // superseded credential, so it is not reported.
    if (!isApiKey(token)) reportSupersededOnce(token, current);
    return;
  }

  const entry = { token, userId, seenAt: Date.now(), expiresAt: tokenExpiryMs(token) };
  entries.set(userId, entry);
  evictBeyondCap();
  notify(entry);
}

function evictBeyondCap() {
  while (entries.size > MAX_ACCOUNTS) {
    let oldest = null;
    for (const entry of entries.values()) {
      if (entry.userId !== activeUserId && (!oldest || entry.seenAt < oldest.seenAt)) oldest = entry;
    }
    if (!oldest) return;
    entries.delete(oldest.userId);
  }
}

// ---------------------------------------------------------------------------
// THE INSTANCE KEY: WHAT A HOSTED INSTANCE PRESENTS WHEN NOBODY IS SIGNED IN
// ---------------------------------------------------------------------------
// A hosted instance is woken by the fleet to collect a webhook or an email,
// with no browser anywhere near it. The session token above only arrives with
// a signed-in request, so after every wake or rollout the pollers had nothing
// to present and collected nothing. The fleet now hands each instance its own
// credential (agnt_ik_..., issued by api.agnt.gg, bound to this tenant and its
// owner, rotated on every recreate, dead when the tenant is suspended). It is
// a FALLBACK: a live signed-in token still wins, being the user's own.
// Desktops have no instance key and behave exactly as before.
const INSTANCE_KEY_PATTERN = /^agnt_ik_[0-9a-f]{64}$/;

function instanceCredential() {
  const key = process.env.AGNT_INSTANCE_KEY;
  const owner = process.env.AGNT_TENANT_OWNER;
  if (!process.env.AGNT_TENANT_SLUG || !owner || !INSTANCE_KEY_PATTERN.test(key || '')) return null;
  return { token: key, userId: owner };
}

/**
 * The token to present for `userId`, else this hosted instance's key when
 * `userId` is its owner, else null. Never throws.
 *
 * With no `userId`, acts for the ACTIVE account (see top of file). A caller
 * that knows whom it acts for must pass it: that is what guarantees it can
 * never be handed another account's credential.
 *
 * @param {string} [userId]
 */
export function getSessionToken(userId) {
  // A team workspace's work (its workflows, schedules, agents) acts for the instance owner.
  if (userId != null) userId = credentialUserId(String(userId));
  const target = userId == null ? defaultUserId() : String(userId);
  const remembered = target ? liveEntry(target)?.token : null;
  if (remembered) return remembered;
  const instance = instanceCredential();
  if (!instance) return null;
  return userId == null || String(userId) === instance.userId ? instance.token : null;
}

/** @returns {SessionEntry|null} the entry for `userId` if still usable; drops it otherwise. */
function liveEntry(userId) {
  const entry = entries.get(userId);
  if (!entry) return null;

  // The token's OWN expiry, not merely how long since we last saw it. `seenAt`
  // is refreshed by every authenticated request, so a token that expires while
  // the user is actively clicking would otherwise be handed to background
  // callers indefinitely — the MAX_AGE window below can only ever help once the
  // user STOPS using the app, which is the opposite of when this bites.
  const expired = entry.expiresAt !== null && Date.now() >= entry.expiresAt;
  if (expired || Date.now() - entry.seenAt > MAX_AGE_MS) {
    entries.delete(userId);
    return null;
  }
  return entry;
}

/**
 * Whom install-wide work acts for. A hosted instance belongs to its tenant
 * owner, so a member signing in never redirects the owner's pollers; a desktop
 * follows whichever account is signed in.
 */
function defaultUserId() {
  const owner = process.env.AGNT_TENANT_SLUG ? process.env.AGNT_TENANT_OWNER : null;
  return owner || activeUserId;
}

/** The user getSessionToken() with no argument acts for, or null. */
export function getSessionUserId() {
  const target = defaultUserId();
  if (target && liveEntry(target)) return target;
  return instanceCredential()?.userId ?? null;
}

/**
 * Every usable entry, least recently seen first, so replaying them in order
 * (a respawned workflow child) leaves the active account active.
 *
 * @returns {Array<{token: string, userId: string}>}
 */
export function getAllSessionEntries() {
  const live = [...entries.keys()].map(liveEntry).filter(Boolean);
  live.sort((a, b) => a.seenAt - b.seenAt);
  const active = live.findIndex((e) => e.userId === activeUserId);
  if (active >= 0) live.push(live.splice(active, 1)[0]);
  return live.map(({ token, userId }) => ({ token, userId }));
}

/**
 * Authorization header for a background call, or an empty object.
 *
 * Returning `{}` rather than a header with an empty value is deliberate: a
 * literal `Authorization: Bearer undefined` is how the webhook receiver's
 * comparison bug turned a missing credential into a valid password. An absent
 * header is unambiguous; a malformed one invites something to try to parse it.
 */
export function authHeader(userId) {
  const token = getSessionToken(userId);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Forget one account's token, or every account's when called with none. */
export function clearSessionToken(userId) {
  if (userId == null) {
    entries.clear();
    activeUserId = null;
    return;
  }
  entries.delete(String(userId));
  if (activeUserId === String(userId)) activeUserId = null;
}

/** Test seam: also clears every subscriber and the report dedupe. */
export function __resetSessionTokenCacheForTests() {
  entries.clear();
  activeUserId = null;
  subscribers.clear();
  reportedSuperseded.clear();
}
