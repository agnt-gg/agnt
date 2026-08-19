import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { resolveSecret } from '../../utils/secretResolver.js';

/**
 * The credential a worker node presents to the primary.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JWT_SECRET, AND WHY THAT IS NOT A DETAIL
 * ---------------------------------------------------------------------------
 * AGNT already had one symmetric JWT secret, and it was published to a public
 * repository for 197 days. The root cause was structural, not careless: the
 * desktop VERIFIES tokens the cloud SIGNS, and symmetric verification is only
 * possible if the verifier holds the signing key — so shipping the key was
 * forced by the design. utils/tokenProof.js documents that at length.
 *
 * Cluster tokens do not have that problem, because the primary is both the
 * issuer and the verifier. One process, one key, never distributed. Symmetric
 * is genuinely correct here, and it is correct for a reason that must not be
 * confused with "symmetric was fine last time".
 *
 * What would recreate the old defect is REUSING JWT_SECRET. That key already
 * travels between machines; minting cluster grants with it would mean a leak
 * of either credential compromised both, and it would let a stolen user token
 * be replayed as a node token. So this is its own secret, resolved through the
 * same per-install cascade (env -> keyfile -> generate).
 *
 * ---------------------------------------------------------------------------
 * THREE VERIFICATION RULES, EACH CLOSING A KNOWN ATTACK
 * ---------------------------------------------------------------------------
 *   1. `algorithms: ['HS256']` is passed EXPLICITLY. Without an allowlist,
 *      jsonwebtoken will honour the `alg` header the token itself carries —
 *      including `none`. The algorithm is our decision, never the caller's.
 *   2. `audience` is verified. A user session token and a node grant are both
 *      JWTs signed by this install; without an audience check the only thing
 *      separating them is which secret was used, and one refactor away from
 *      sharing a secret that becomes nothing at all.
 *   3. `nodeId` is IN the token. If a worker self-reported its id in the
 *      request body, any node could renew or release another node's claims by
 *      naming it. Identity is granted by the primary, not asserted by the
 *      claimant.
 */

/** Distinguishes a node grant from every other JWT this install may see. */
const AUDIENCE = 'agnt-cluster-node';

/** Informational, and a useful thing to see in a decoded token. */
const ISSUER = 'agnt-primary';

/** The one algorithm this module signs and accepts. */
const ALGORITHM = 'HS256';

/** Long-lived by design: rotating a worker's grant is a manual, rare act. */
const DEFAULT_TTL_DAYS = 90;

function clusterSecret() {
  // 'ephemeral' rather than the resolver's default 'throw': nothing is
  // encrypted at rest with this key, so a read-only volume should cost a fleet
  // re-enrolment, not a refusal to boot. The primary is an ordinary AGNT
  // install and must not gain a new way to fail.
  return resolveSecret('CLUSTER_SECRET', { onPersistFailure: 'ephemeral' });
}

/**
 * Mint a grant for one worker node.
 *
 * The node id is generated HERE. That is the point: it is the primary handing
 * out an identity, not a worker choosing one.
 *
 * @param {object} params
 * @param {string} params.userId        whose work this node may claim
 * @param {string} [params.label]       human-readable, cosmetic only
 * @param {number} [params.ttlDays]
 * @returns {{ token: string, nodeId: string, expiresAt: number }}
 */
export function mintNodeToken({ userId, label = '', ttlDays = DEFAULT_TTL_DAYS } = {}) {
  if (!userId) throw new Error('mintNodeToken requires a userId — a grant with no owner can claim nothing');

  const nodeId = `node_${crypto.randomBytes(12).toString('hex')}`;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlDays * 86400;

  const token = jwt.sign(
    { nodeId, userId, label: String(label).slice(0, 120), iat: issuedAt, exp: expiresAt },
    clusterSecret(),
    { algorithm: ALGORITHM, audience: AUDIENCE, issuer: ISSUER }
  );

  return { token, nodeId, expiresAt: expiresAt * 1000 };
}

/**
 * Verify a presented grant.
 *
 * Returns null for every failure — expired, wrong audience, wrong algorithm,
 * bad signature, malformed. The caller's only correct response to null is 401,
 * so distinguishing the reasons here would only build a probing oracle.
 *
 * @param {string|null|undefined} token
 * @returns {{ nodeId: string, userId: string, label: string, exp: number }|null}
 */
export function verifyNodeToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const decoded = jwt.verify(token, clusterSecret(), {
      algorithms: [ALGORITHM],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    // Belt and braces: a token that verifies but carries no identity is not a
    // usable grant, and treating it as one would mean a claim owned by
    // `undefined`.
    if (!decoded?.nodeId || !decoded?.userId) return null;
    return { nodeId: decoded.nodeId, userId: decoded.userId, label: decoded.label || '', exp: decoded.exp };
  } catch {
    return null;
  }
}

/** Pull a bearer token without caring about header casing. */
export function presentedToken(req) {
  const header = req?.headers?.authorization || '';
  const [scheme, value] = String(header).split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  return value || null;
}

export const CLUSTER_TOKEN_AUDIENCE = AUDIENCE;
