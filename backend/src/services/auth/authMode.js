/**
 * HOW THIS INSTALL DECIDES A TOKEN IS GENUINE.
 *
 * One variable, read in one place. Two modules need the answer and each
 * imports the other for something else, so the parse lives here rather than
 * in either of them.
 *
 *   local          (default)  jwt.verify against JWT_SECRET. Correct only when
 *                             this process holds the issuer's signing key —
 *                             which every desktop install does, and which is
 *                             why the key shipped in the first place.
 *
 *   verify-remote             this process holds a PRIVATE JWT_SECRET that
 *                             verifies nothing, and asks api.agnt.gg whether
 *                             each token is genuine. For any install that is
 *                             reachable from a network: hosted tenants, and
 *                             every container image.
 *
 * Nothing on a desktop install sets this variable, so verify-remote is also
 * the signal that an install is a network install — see
 * services/auth/tenantOwnership.js for what follows from that.
 */

export const AUTH_MODE_ENV = 'AGNT_AUTH_MODE';
export const AUTH_MODE_VERIFY_REMOTE = 'verify-remote';

/**
 * True when this install should ask the issuer rather than verify locally.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isRemoteVerifyMode(env = process.env) {
  return String(env[AUTH_MODE_ENV] || '').trim().toLowerCase() === AUTH_MODE_VERIFY_REMOTE;
}
