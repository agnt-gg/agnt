import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { getAllSessionEntries, rememberSessionToken } from './sessionTokenCache.js';
import { isApiKey } from './apiKey.js';

/**
 * Keeps every session this install holds alive past its 30-day expiry.
 *
 * WHY: automations authenticate to api.agnt.gg with the session token the user
 * signed in with. Nothing renewed it, so on day 30 every credentialed workflow,
 * email trigger and webhook on the install stopped until a human signed in
 * again. This trades a still-valid token for a fresh one well before it expires
 * (POST /users/auth/session/renew on api.agnt.gg).
 *
 * The renewed token goes through rememberSessionToken, so the existing
 * machinery carries it everywhere it is needed: it supersedes the old one (it
 * expires later), the workflow process gets it over IPC, and the window adopts
 * it from the next response (see renewedTokenHeader.js).
 *
 * Failure never removes a credential. A refused or unreachable renewal leaves
 * the current token in place until its own expiry and is retried next tick; a
 * refusal is logged loudly, because it means automations WILL stop on a known
 * date unless someone signs in.
 *
 * Runs in the main process only (started from server.js).
 */

/** Renew once fewer than this many ms remain. A week of retries before anything stops. */
export const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/** How often to look. Costs no network unless a token is inside the window. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

/** First look shortly after boot, once the window has presented its token. */
const FIRST_CHECK_AFTER_MS = 60 * 1000;

const REQUEST_TIMEOUT_MS = 15000;

const remoteUrl = () => String(process.env.REMOTE_URL || 'https://api.agnt.gg').replace(/\/+$/, '');

/** Short, non-reversible label so logs can say WHICH token without saying what it is. */
const fingerprint = (token) => createHash('sha256').update(token).digest('hex').slice(0, 8);

function decodedExpiryMs(token) {
  const exp = jwt.decode(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}

async function defaultPost(token) {
  const response = await fetch(`${remoteUrl()}/users/auth/session/renew`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/**
 * Verify a renewed token the same way the auth middleware verifies a request:
 * locally with this install's key, or by the issuer on installs that cannot.
 * @returns {Promise<object|null>} decoded claims, or null when not verifiable
 */
async function defaultVerify(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const { isRemoteVerifyMode, verifyViaIssuer } = await import('./remoteTokenVerifier.js');
    if (!isRemoteVerifyMode()) return null;
    const remote = await verifyViaIssuer(token);
    if (!remote?.ok) return null;
    return { id: remote.user?.id ?? remote.user?.userId, exp: jwt.decode(token)?.exp };
  }
}

/** Refusals are logged once per token, not once per hourly tick. */
const reportedRefusals = new Set();

function reportRefusalOnce(token, userId, status, reason, expiresAtMs) {
  const key = `${fingerprint(token)}:${status}`;
  if (reportedRefusals.has(key)) return;
  if (reportedRefusals.size >= 64) reportedRefusals.clear();
  reportedRefusals.add(key);
  const when = expiresAtMs ? new Date(expiresAtMs).toISOString() : 'its expiry';
  if (status === 404) {
    console.warn(`[sessionRenewal] api.agnt.gg does not offer session renewal yet; will retry. Session ${fingerprint(token)} expires ${when}.`);
    return;
  }
  console.error(
    `[sessionRenewal] api.agnt.gg REFUSED to renew the AGNT session for user ${userId} ` +
      `(status=${status} reason=${reason || 'unknown'}, token ${fingerprint(token)}). ` +
      `Background automations for this account will stop at ${when} unless the user signs in again.`
  );
}

/**
 * Renew every held session that expires within RENEW_WITHIN_MS.
 *
 * @param {{now?: number, post?: (token: string) => Promise<{status: number, body: any}>, verify?: (token: string) => Promise<object|null>}} [deps]
 * @returns {Promise<Array<{userId: string, outcome: string}>>}
 */
export async function renewExpiringSessions({ now = Date.now(), post = defaultPost, verify = defaultVerify } = {}) {
  const outcomes = [];
  for (const { token, userId } of getAllSessionEntries()) {
    if (isApiKey(token)) continue; // never expires
    const expiresAtMs = decodedExpiryMs(token);
    if (expiresAtMs === null) continue; // not a JWT we can reason about
    if (expiresAtMs - now > RENEW_WITHIN_MS) continue;

    let response;
    try {
      response = await post(token);
    } catch (error) {
      console.warn(`[sessionRenewal] could not reach api.agnt.gg (${error?.message}); will retry.`);
      outcomes.push({ userId, outcome: 'unreachable' });
      continue;
    }

    const renewed = response?.status === 200 ? response.body?.token : null;
    if (typeof renewed !== 'string' || renewed.length === 0) {
      if (response?.status >= 500) {
        console.warn(`[sessionRenewal] api.agnt.gg answered ${response.status}; will retry.`);
      } else {
        reportRefusalOnce(token, userId, response?.status, response?.body?.reason, expiresAtMs);
      }
      outcomes.push({ userId, outcome: `refused:${response?.status}` });
      continue;
    }

    const claims = await verify(renewed);
    const subject = claims ? String(claims.id ?? claims.userId ?? '') : '';
    const renewedExpiryMs = typeof claims?.exp === 'number' ? claims.exp * 1000 : null;
    if (!claims || subject !== String(userId) || renewedExpiryMs === null || renewedExpiryMs <= expiresAtMs) {
      // Never adopt something we cannot vouch for, for the wrong account, or
      // that would shorten the session. Keep the current token.
      console.error(`[sessionRenewal] discarded an unusable renewal for user ${userId} (token ${fingerprint(renewed)}).`);
      outcomes.push({ userId, outcome: 'discarded' });
      continue;
    }

    rememberSessionToken(renewed, userId);
    console.log(
      `[sessionRenewal] renewed session for user ${userId}: ${fingerprint(token)} -> ${fingerprint(renewed)}, ` +
        `now expires ${new Date(renewedExpiryMs).toISOString()}`
    );
    outcomes.push({ userId, outcome: 'renewed' });
  }
  return outcomes;
}

/**
 * Start the hourly check. Idempotent; returns a stop function. The timers are
 * unref'd so they never keep a quitting process alive, and runs never overlap.
 */
let running = null;

export function startSessionRenewal({ firstCheckAfterMs = FIRST_CHECK_AFTER_MS, everyMs = CHECK_EVERY_MS, run = renewExpiringSessions } = {}) {
  if (running) return running.stop;
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await run();
    } catch (error) {
      console.error('[sessionRenewal] check failed:', error?.message);
    } finally {
      inFlight = false;
    }
  };
  const first = setTimeout(tick, firstCheckAfterMs);
  const interval = setInterval(tick, everyMs);
  first.unref?.();
  interval.unref?.();
  const stop = () => {
    clearTimeout(first);
    clearInterval(interval);
    running = null;
  };
  running = { stop };
  return stop;
}

/** Test seam. */
export function __resetSessionRenewalForTests() {
  running?.stop();
  running = null;
  reportedRefusals.clear();
}
