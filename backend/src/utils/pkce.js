/**
 * PKCE (Proof Key for Code Exchange) Generator
 *
 * Implements PKCE for OAuth 2.0 security as per RFC 7636.
 * Used to prevent authorization code interception attacks.
 */

import crypto from 'crypto';

/**
 * Generate a PKCE verifier and challenge pair
 * @returns {{ verifier: string, challenge: string }}
 */
export function generatePkce() {
  // Generate a cryptographically random verifier (32 bytes = 256 bits)
  const verifier = crypto.randomBytes(32).toString('base64url');

  // Create challenge by SHA256 hashing the verifier and base64url encoding
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');

  return { verifier, challenge };
}

/**
 * Generate just a PKCE code verifier
 * @returns {string}
 */
export function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a PKCE code challenge from a verifier
 * @param {string} verifier - The code verifier
 * @returns {string} - The code challenge (S256)
 */
export function generateCodeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

/**
 * Verify that a verifier matches a challenge
 * @param {string} verifier - The code verifier
 * @param {string} challenge - The code challenge to verify against
 * @returns {boolean}
 */
export function verifyPkce(verifier, challenge) {
  const computedChallenge = generateCodeChallenge(verifier);
  return computedChallenge === challenge;
}

/**
 * Generate a random state parameter for CSRF protection
 * @returns {string}
 */
export function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

export default {
  generatePkce,
  generateCodeVerifier,
  generateCodeChallenge,
  verifyPkce,
  generateState,
};
