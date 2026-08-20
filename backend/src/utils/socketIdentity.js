/**
 * Socket identity resolution.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Socket.IO `authenticate` handler used to trust a client-supplied
 * `userId` verbatim:
 *
 *     socket.on('authenticate', ({ userId }) => socket.join(`user:${userId}`));
 *
 * Every realtime fan-out in AGNT targets `user:<id>` rooms — chat token
 * deltas, tool start/end, goal iterations, autonomous messages, security
 * events. So any client that could open a socket could join any other
 * user's room by guessing an id, and read their entire session live. The
 * same unverified `socket.userId` also gated `steer` / `clear_steer` /
 * `tutorial:scan_response`, making it a write primitive too.
 *
 * On a single-tenant desktop install that is inert — there is only ever
 * one user and the socket is on localhost. The moment AGNT is multi-user
 * (cloud, or a team sharing one backend) it is a live cross-tenant leak,
 * so this must be settled BEFORE any team feature ships, not after.
 *
 * DESIGN
 * ------
 * Identity comes from the bearer token, never from the payload. This is a
 * pure function so the policy is unit-testable without booting a server.
 *
 * Verification deliberately mirrors the HTTP layer (routes/Middleware.js)
 * exactly, so the socket is never weaker NOR stronger than the REST API:
 *
 *   - TRUST_REMOTE_AUTH=true → decode (tokens are signed by the remote
 *     issuer, api.agnt.gg; the local backend has no key to verify them).
 *     We still enforce `exp`, which the HTTP path does not — a decoded
 *     token is not a blank cheque.
 *   - otherwise → jwt.verify against JWT_SECRET.
 *
 * STRICT VS LENIENT
 * -----------------
 * A stale frontend bundle sends no token. Hard-failing those would break
 * realtime for desktop users mid-upgrade, so the policy is environment
 * aware:
 *
 *   strict  (token REQUIRED) — cloud / hosted: NODE_ENV=production or
 *                              TRUST_REMOTE_AUTH=true
 *   lenient (legacy claim accepted, flagged unverified) — local desktop
 *
 * `SOCKET_AUTH_STRICT=true|false` overrides the inference either way.
 * Lenient never applies to a *supplied* token: a present-but-invalid
 * token is always a rejection, in every mode. Lenient only covers the
 * "old client, no token at all" case.
 */

import jwt from 'jsonwebtoken';

import { verifiedUserSync } from '../services/auth/remoteTokenVerifier.js';

/** Reasons a resolution can fail. Exported so tests + callers share one vocabulary. */
export const SocketAuthFailure = {
  INVALID_TOKEN: 'invalid_token',
  EXPIRED_TOKEN: 'expired_token',
  TOKEN_REQUIRED: 'token_required',
  NO_IDENTITY: 'no_identity',
};

/** How the identity was established. `unverified_claim` is legacy-lenient only. */
export const SocketIdentitySource = {
  TOKEN: 'token',
  UNVERIFIED_CLAIM: 'unverified_claim',
};

const PLACEHOLDER_TOKENS = new Set(['null', 'undefined', '']);

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Pull the user id out of a decoded JWT payload.
 * Mirrors Middleware.extractUserId — remote and local issuers disagree on
 * the field name, so all four are accepted.
 */
export function extractUserId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return (
    cleanString(payload.id) ||
    cleanString(payload.userId) ||
    cleanString(payload.user_id) ||
    cleanString(payload.sub) ||
    null
  );
}

/**
 * True when a token is mandatory. Explicit env flag wins; otherwise infer
 * from deployment shape (hosted/cloud ⇒ strict).
 */
export function isStrictSocketAuth(env = process.env) {
  if (env.SOCKET_AUTH_STRICT === 'true') return true;
  if (env.SOCKET_AUTH_STRICT === 'false') return false;
  return env.NODE_ENV === 'production' || env.TRUST_REMOTE_AUTH === 'true';
}

/**
 * Verify a token and return its user id, or a failure reason.
 * @returns {{ userId: string } | { error: string }}
 */
function verifyToken(token, env) {
  const trustRemote = env.TRUST_REMOTE_AUTH === 'true';

  // Local-issued tokens verify against our own secret. Try this first in
  // every mode: a locally-signed token is strictly better evidence than a
  // decoded one, and hosted installs can still mint local tokens.
  if (env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      const userId = extractUserId(decoded);
      if (userId) return { userId };
    } catch (err) {
      // An expired LOCAL token is expired, full stop — never fall through
      // to decode, or `exp` would be trivially bypassable.
      if (err?.name === 'TokenExpiredError') return { error: SocketAuthFailure.EXPIRED_TOKEN };
      // Otherwise fall through: it may be a remote-issued token.
    }
  }

  // A HOSTED INSTALL HOLDS NO COPY OF THE ISSUER'S SIGNING KEY, by design, so a
  // genuine cloud token cannot pass the verify above. Read the answer the HTTP
  // middleware already obtained from api.agnt.gg for this exact token.
  //
  // Placed before the trustRemote branch because it is STRICTLY STRONGER than
  // it: that branch decodes without checking anything, this one requires the
  // issuer to have said yes.
  const confirmed = verifiedUserSync(token);
  if (confirmed) {
    const userId = extractUserId(confirmed);
    if (userId) return { userId };
  }

  if (!trustRemote) return { error: SocketAuthFailure.INVALID_TOKEN };

  // Hosted mode: the issuer is remote and we hold no verification key, so
  // we decode — same trust model the HTTP middleware already uses. We do
  // enforce expiry here, which is strictly stronger than the HTTP path.
  let decoded = null;
  try {
    decoded = jwt.decode(token);
  } catch {
    return { error: SocketAuthFailure.INVALID_TOKEN };
  }
  const userId = extractUserId(decoded);
  if (!userId) return { error: SocketAuthFailure.INVALID_TOKEN };

  if (typeof decoded.exp === 'number' && decoded.exp * 1000 <= Date.now()) {
    return { error: SocketAuthFailure.EXPIRED_TOKEN };
  }

  return { userId };
}

/**
 * Resolve the authenticated identity for a socket.
 *
 * @param {{ userId?: string, token?: string }} payload  raw `authenticate` payload
 * @param {object} env                                   defaults to process.env
 * @returns {{ ok: true, userId: string, source: string, verified: boolean }
 *          | { ok: false, reason: string }}
 */
export function resolveSocketIdentity(payload = {}, env = process.env) {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const token = cleanString(raw.token);
  const claimedUserId = cleanString(raw.userId);

  // A supplied token is always authoritative — and always fatal if bad,
  // in strict AND lenient mode. Never fall back to the claim, or an
  // attacker would just send a garbage token to downgrade to legacy.
  if (token && !PLACEHOLDER_TOKENS.has(token)) {
    const result = verifyToken(token, env);
    if (result.error) return { ok: false, reason: result.error };
    return { ok: true, userId: result.userId, source: SocketIdentitySource.TOKEN, verified: true };
  }

  if (isStrictSocketAuth(env)) {
    return { ok: false, reason: SocketAuthFailure.TOKEN_REQUIRED };
  }

  // Lenient: pre-upgrade client on a local desktop install.
  if (claimedUserId) {
    return {
      ok: true,
      userId: claimedUserId,
      source: SocketIdentitySource.UNVERIFIED_CLAIM,
      verified: false,
    };
  }

  return { ok: false, reason: SocketAuthFailure.NO_IDENTITY };
}

export default { resolveSocketIdentity, isStrictSocketAuth, extractUserId, SocketAuthFailure, SocketIdentitySource };
