import crypto from 'crypto';

/**
 * Ask the token's ISSUER whether it is genuine, instead of checking it here.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * This backend does not mint tokens — `jwt.sign` appears nowhere outside tests.
 * Every JWT it sees was issued by api.agnt.gg and signed with a SHARED secret,
 * so `jwt.verify(token, JWT_SECRET)` is only possible if this install holds the
 * issuer's signing key. utils/tokenProof.js states the consequence plainly:
 * committing that key "was the forced consequence of that design, not
 * carelessness."
 *
 * On a desktop install that is survivable: the port is loopback-only, so the
 * published key buys an attacker nothing without local access. A HOSTED tenant
 * has no such boundary. `https://<slug>.t1.agnt.gg` is reachable by everyone,
 * the signing key is public, and AGNT executes arbitrary code by design — so a
 * forged session is remote code execution.
 *
 * ---------------------------------------------------------------------------
 * THE FIX: STOP HOLDING A KEY YOU CANNOT PROTECT
 * ---------------------------------------------------------------------------
 * `GET {REMOTE_URL}/users/auth/status` already answers exactly the question
 * that matters, and answers it with material this process does not have:
 *
 *   1. the signature, against the issuer's own JWT_SECRET;
 *   2. the PROOF CLAIM, an HMAC over the payload keyed by TOKEN_PROOF_SECRET —
 *      which is server-only and has never been distributed to any client;
 *   3. that the user still exists.
 *
 * Item 2 is the one that cannot be replicated here at any price. So delegating
 * is not a workaround for missing a key; it is asking the only party able to
 * give a real answer.
 *
 * Once a tenant delegates, it needs no shared secret at all — which makes a
 * random per-tenant JWT_SECRET correct rather than fatal, because the only
 * tokens it ever verifies locally are ones it minted itself.
 *
 * ---------------------------------------------------------------------------
 * ⚠ THE PRECONDITION, MEASURED 2026-08-20 — READ BEFORE TRUSTING THIS
 * ---------------------------------------------------------------------------
 * Delegation is exactly as strong as the issuer's check, and no stronger.
 *
 * Right now `checkTokenProof` runs in SHADOW mode on api.agnt.gg: it computes
 * the proof, counts the outcome, and accepts regardless. Verified against
 * production — a token forged with the published secret and a rewritten email
 * came back `isAuthenticated: true`.
 *
 *   shadow  → issuer accepts forgeries. Delegation is NO STRONGER than a local
 *             verify. It is still worth doing (see below), but it is not yet a
 *             security control and must not be described as one.
 *   enforce → issuer refuses any token without a valid proof claim, which an
 *             attacker cannot compute. Delegation becomes strictly stronger
 *             than local verification, and the tenant's exposure closes.
 *
 * WHY BUILD IT BEFORE THE FLIP. Because this is the mechanism by which the flip
 * REACHES tenants. A tenant that verifies locally with the shared key keeps
 * accepting forgeries forever no matter what the cloud does; a tenant that
 * delegates is protected the instant the sentinel is touched, with no rebuild
 * and no redeploy. Until then the edge gate carries the load.
 *
 * Flip: `touch /var/www/api.agnt.gg/.token-proof-enforce` — no restart, `rm` to
 * roll back. Scheduled for 2026-09-04, when the last pre-proof 30-day token has
 * expired and the flip costs nothing.
 */

/** Positive answers are cached briefly: long enough to matter, short enough to revoke. */
const POSITIVE_TTL_MS = 5 * 60 * 1000;

/**
 * Negatives are cached too, and that is deliberate. Without it, a client
 * looping on a bad token turns this install into a traffic amplifier against
 * the issuer. Kept short so a user who genuinely re-logs in is not stuck.
 */
const NEGATIVE_TTL_MS = 30 * 1000;

/**
 * How long a PREVIOUSLY VALID answer may be served after the issuer becomes
 * unreachable.
 *
 * This is the same reasoning as planEntitlements' fail-open: a transient
 * network fault must not log out every user of a running instance. It is
 * bounded, and it only ever extends an answer the issuer already gave — a
 * token never seen before is refused, so an outage can never be used to
 * manufacture a session.
 */
const STALE_GRACE_MS = 30 * 60 * 1000;

/** Bounded so a token-spraying attacker cannot grow this without limit. */
const MAX_ENTRIES = 5000;

const cache = new Map();

const stats = { hits: 0, misses: 0, remoteOk: 0, remoteDeny: 0, remoteFail: 0, servedStale: 0 };

/**
 * Cache key. The raw token is NEVER stored — a process dump or a heap snapshot
 * of this map must not yield usable credentials.
 */
function keyFor(token) {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function evictIfFull() {
  if (cache.size < MAX_ENTRIES) return;
  // Oldest insertion first: Map preserves insertion order, so the first key is
  // the least recently added. Cheap, and good enough for a TTL cache.
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

/** True when this install should ask the issuer rather than verify locally. */
export function isRemoteVerifyMode() {
  return String(process.env.AGNT_AUTH_MODE || '').trim().toLowerCase() === 'verify-remote';
}

/**
 * Is this token genuine, according to the party that issued it?
 *
 * NEVER THROWS. An auth path that can throw becomes an outage, and the caller
 * already has a correct action for `{ ok: false }`.
 *
 * @param {string} token
 * @returns {Promise<{ok: boolean, user: object|null, source: string}>}
 */
export async function verifyViaIssuer(token) {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, user: null, source: 'empty' };
  }

  const key = keyFor(token);
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && now < hit.expiresAt) {
    stats.hits += 1;
    return { ok: hit.ok, user: hit.user, source: 'cache' };
  }
  stats.misses += 1;

  const remote = String(process.env.REMOTE_URL || 'https://api.agnt.gg').replace(/\/+$/, '');

  let answer = null;
  try {
    // A hosted tenant serves interactive requests; a hung auth call is a hung
    // page. Bounded, and a timeout falls through to the grace path below.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      response = await fetch(`${remote}/users/auth/status`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // Any non-2xx is an UNKNOWN, not a denial. The issuer being rate-limited or
    // briefly broken must not be read as "this user is an impostor" — that is
    // how a bad afternoon at the API becomes a mass logout.
    if (!response.ok) throw new Error(`issuer returned HTTP ${response.status}`);

    answer = await response.json();
  } catch (error) {
    stats.remoteFail += 1;

    // GRACE: extend an answer the issuer already gave, never invent one.
    if (hit && hit.ok && now < hit.expiresAt + STALE_GRACE_MS) {
      stats.servedStale += 1;
      return { ok: true, user: hit.user, source: 'stale-grace' };
    }
    return { ok: false, user: null, source: `unreachable: ${error.message}` };
  }

  const ok = answer?.isAuthenticated === true && !!answer?.user;
  const user = ok ? answer.user : null;
  ok ? (stats.remoteOk += 1) : (stats.remoteDeny += 1);

  evictIfFull();
  cache.set(key, { ok, user, expiresAt: now + (ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });

  return { ok, user, source: 'issuer' };
}

/**
 * Has THIS EXACT TOKEN already been confirmed genuine by the issuer?
 *
 * ---------------------------------------------------------------------------
 * WHY A SYNCHRONOUS READ EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * A token is verified in three places in this backend, and two of them cannot
 * await anything:
 *
 *   routes/Middleware.js        async  — every REST route
 *   utils/authGuard.js          SYNC   — media, files, images, pairing, SSE
 *   utils/socketIdentity.js     SYNC   — the websocket handshake
 *
 * The first attempt at this traded the cloud token for a locally-minted one so
 * all three could verify locally. That worked, and broke something worse: the
 * frontend keeps ONE token in localStorage and uses it against TWO authorities
 * — this backend AND api.agnt.gg. Swapping it left every direct-to-cloud call
 * (credits, subscription, referrals, license, marketplace, connected apps)
 * holding a token the cloud cannot verify. The user stayed signed in and lost
 * half the app.
 *
 * So the client keeps the cloud token, and the two synchronous sites read the
 * answer the asynchronous one already obtained.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A MEMO OF AN AUTHORITATIVE ANSWER, NOT A TRUST DECISION
 * ---------------------------------------------------------------------------
 * An entry exists only because `verifyViaIssuer` got `isAuthenticated: true`
 * from api.agnt.gg for that exact token string, and it expires on the same TTL.
 * Nothing here can create a positive; it can only report one. A token this
 * process has never seen returns null, exactly as it should.
 *
 * The identity returned is the ISSUER'S, not a local decode of the payload —
 * so a tampered claim cannot travel through this path even in principle.
 *
 * ORDERING. The cache is warm because the page cannot render without first
 * calling GET /api/users/auth/status, which runs through Middleware. A media or
 * socket request that somehow arrives first simply gets today's 401 and is
 * retried after the session verifies — no worse than the current behaviour.
 *
 * @param {string} token
 * @returns {object|null} the issuer-confirmed user, or null
 */
export function verifiedUserSync(token) {
  if (typeof token !== 'string' || !token) return null;
  const hit = cache.get(keyFor(token));
  if (!hit || !hit.ok || Date.now() >= hit.expiresAt) return null;
  return hit.user || null;
}

/**
 * Drop a token's cached answer.
 *
 * Called on sign-out so the 5-minute positive TTL does not keep a session alive
 * on this instance after the user ended it.
 */
export function forgetToken(token) {
  if (typeof token === 'string' && token) cache.delete(keyFor(token));
}

export function verifierStats() {
  return { ...stats, entries: cache.size, mode: isRemoteVerifyMode() ? 'verify-remote' : 'local' };
}

/** Test seam. */
export function __resetVerifierForTests() {
  cache.clear();
  for (const k of Object.keys(stats)) stats[k] = 0;
}
