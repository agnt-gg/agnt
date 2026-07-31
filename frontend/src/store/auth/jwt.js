/**
 * JWT payload reading — pure, dependency-free.
 *
 * Lives in its own module (rather than inside userAuth.js) so that identity
 * helpers can read a token's subject without importing the store module that
 * imports them back. Re-exported from userAuth.js so existing import sites
 * keep working; this file is the single implementation.
 *
 * Nothing here verifies a signature. These values are used to identify a
 * session locally (routing, cache scoping), never to authorize anything —
 * the server re-derives identity from the token on every request.
 */

/**
 * Best-effort user from a JWT payload (no signature check — token already held
 * locally after login/pairing). Used when remote /users/auth/status is unreachable
 * or does not recognize the token (common for device-paired local sessions on /m).
 * @param {string|null|undefined} token
 * @returns {{ id: string, email: string|null, name: string, authMethod: string }|null}
 */
export function userFromJwt(token) {
  if (!token || typeof token !== 'string' || token.split('.').length < 2) return null;
  try {
    // JWT segments are base64url and often unpadded; atob (Safari/iOS) is strict.
    let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const json =
      typeof atob === 'function'
        ? new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
        : Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    // A token past its own expiry is not a session. AGNT session tokens are
    // minted by the remote auth server and carry `exp` (payload shape:
    // id, userId, email, auth_type, iat, exp — 30-day lifetime), and an
    // expired one outlives its usefulness in localStorage, so without this
    // check a month-old token would still synthesize a logged-in user.
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
    const id = payload.id || payload.sub || payload.userId;
    const email = payload.email || null;
    if (!id && !email) return null;
    return {
      id: id || 'local',
      email,
      name: payload.name || (email ? String(email).split('@')[0] : 'User'),
      authMethod: payload.authMethod || 'jwt',
    };
  } catch {
    return null;
  }
}

export default { userFromJwt };
