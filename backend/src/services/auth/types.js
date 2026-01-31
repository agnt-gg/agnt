/**
 * Auth Types - JSDoc type definitions for authentication system
 *
 * These types document the structure of auth-related data.
 */

/**
 * @typedef {'anthropic' | 'openai-codex'} Provider
 */

/**
 * @typedef {'oauth'} AuthType
 */

/**
 * @typedef {Object} AuthProfile
 * @property {string} id - Unique identifier (UUID)
 * @property {Provider} provider - Provider name
 * @property {AuthType} type - Authentication type (always 'oauth')
 * @property {string} accessToken - Current access token
 * @property {string} refreshToken - Refresh token for renewal
 * @property {number} expiresAt - Unix timestamp in milliseconds
 * @property {string} [email] - User email from /userinfo
 * @property {string} [accountId] - Provider account ID
 * @property {string[]} scopes - Granted OAuth scopes
 * @property {string} [subscriptionType] - e.g., "max", "pro", "free"
 * @property {string} [rateLimitTier] - e.g., "default_claude_max_5x"
 * @property {number} createdAt - When first authenticated (ms timestamp)
 * @property {number} updatedAt - Last token refresh (ms timestamp)
 */

/**
 * @typedef {Object} AuthProfileStore
 * @property {number} version - Schema version (currently 1)
 * @property {Object.<string, AuthProfile>} profiles - Map of profile ID to profile
 * @property {Object.<string, string[]>} order - Profile IDs in order by provider
 * @property {Object.<string, string>} lastGood - Last working profile ID by provider
 */

/**
 * @typedef {Object} OAuthSession
 * @property {string} state - Random state for CSRF protection
 * @property {string} verifier - PKCE verifier (not sent over network)
 * @property {string} challenge - PKCE challenge (sent in auth URL)
 * @property {string} redirectUri - Callback URL
 * @property {Provider} provider - Target provider
 * @property {number} createdAt - Session start timestamp (ms)
 */

/**
 * @typedef {'NO_CREDENTIALS' | 'TOKEN_EXPIRED' | 'REFRESH_FAILED' | 'NETWORK_ERROR' | 'INVALID_TOKEN'} AuthErrorCode
 */

/**
 * @typedef {'setup' | 'reauth' | 'retry' | 'contact_support'} RecoveryAction
 */

/**
 * @typedef {Object} AuthErrorDetails
 * @property {AuthErrorCode} code - Error code
 * @property {string} message - User-friendly message
 * @property {RecoveryAction} recovery - Suggested recovery action
 * @property {string} [details] - Technical details for logging
 */

/**
 * Create a new AuthProfile object
 * @param {Partial<AuthProfile>} data - Profile data
 * @returns {AuthProfile}
 */
export function createAuthProfile(data) {
  const now = Date.now();
  return {
    id: data.id || crypto.randomUUID(),
    provider: data.provider,
    type: 'oauth',
    accessToken: data.accessToken || '',
    refreshToken: data.refreshToken || '',
    expiresAt: data.expiresAt || 0,
    email: data.email || null,
    accountId: data.accountId || null,
    scopes: data.scopes || [],
    subscriptionType: data.subscriptionType || null,
    rateLimitTier: data.rateLimitTier || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

/**
 * Create an empty AuthProfileStore
 * @returns {AuthProfileStore}
 */
export function createEmptyStore() {
  return {
    version: 1,
    profiles: {},
    order: {},
    lastGood: {},
  };
}

/**
 * Check if a profile's token is expired (with buffer)
 * @param {AuthProfile} profile - The profile to check
 * @param {number} [bufferMs=300000] - Buffer in milliseconds (default 5 minutes)
 * @returns {boolean}
 */
export function isTokenExpired(profile, bufferMs = 300000) {
  if (!profile || !profile.expiresAt) {
    return true;
  }
  return Date.now() >= (profile.expiresAt - bufferMs);
}

export default {
  createAuthProfile,
  createEmptyStore,
  isTokenExpired,
};
