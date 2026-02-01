/**
 * TokenRefreshManager - Centralized token refresh logic
 *
 * Handles automatic token refresh for all providers with:
 * - Expiry checking with 5-minute buffer
 * - Exponential backoff for failed refreshes
 * - Mutex lock to prevent concurrent refresh attempts
 */

import axios from 'axios';
import { createAuthLogger } from '../../utils/auth-logger.js';
import ClaudeCodeAuthManager from './ClaudeCodeAuthManager.js';
import CodexAuthManager from './CodexAuthManager.js';

const logger = createAuthLogger('token-refresh');

// Token refresh buffer - refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// OAuth endpoints
const CLAUDE_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OPENAI_TOKEN_URL = 'https://api.openai.com/oauth/token';

// Exponential backoff settings
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;
const MAX_RETRY_COUNT = 5;

class TokenRefreshManager {
  constructor() {
    // Track failures per profile for exponential backoff
    this._failureCounts = new Map();
    this._lastFailureTimes = new Map();

    // Mutex locks to prevent concurrent refresh
    this._refreshLocks = new Map();

    // Pending refresh promises (for deduplication)
    this._pendingRefreshes = new Map();
  }

  /**
   * Check if a token is expired (with buffer)
   * @param {object} credentials - Credentials object with expiresAt
   * @param {number} [bufferMs=REFRESH_BUFFER_MS] - Buffer in milliseconds
   * @returns {boolean}
   */
  isTokenExpired(credentials, bufferMs = REFRESH_BUFFER_MS) {
    if (!credentials?.expiresAt) {
      return true; // Assume expired if no expiry info
    }
    return Date.now() >= (credentials.expiresAt - bufferMs);
  }

  /**
   * Get a valid access token, refreshing if needed
   * @param {string} provider - Provider name ('anthropic' or 'openai-codex')
   * @param {object} credentials - Current credentials
   * @param {boolean} [forceRefresh=false] - Force refresh even if token appears valid
   * @returns {Promise<{ accessToken: string, refreshed: boolean }>}
   */
  async getValidAccessToken(provider, credentials, forceRefresh = false) {
    if (!credentials?.accessToken) {
      throw new TokenRefreshError('NO_CREDENTIALS', 'No credentials available', 'setup');
    }

    // Check if token is still valid (unless force refresh is requested)
    if (!forceRefresh && !this.isTokenExpired(credentials)) {
      return { accessToken: credentials.accessToken, refreshed: false };
    }

    // Token is expired, expiring soon, or force refresh requested - refresh it
    const refreshedCreds = await this._refreshWithLock(provider, credentials);
    return { accessToken: refreshedCreds.accessToken, refreshed: true };
  }

  /**
   * Refresh token with mutex lock to prevent concurrent refreshes
   * @private
   */
  async _refreshWithLock(provider, credentials) {
    const lockKey = `${provider}:${credentials.accessToken?.slice(0, 8) || 'unknown'}`;

    // Check if there's already a pending refresh for this credential
    if (this._pendingRefreshes.has(lockKey)) {
      logger.logEvent('token_refresh', { provider, status: 'waiting_for_pending' });
      return this._pendingRefreshes.get(lockKey);
    }

    // Check backoff
    const backoffMs = this._getBackoffDelay(lockKey);
    if (backoffMs > 0) {
      const error = new TokenRefreshError(
        'REFRESH_COOLDOWN',
        `Token refresh in cooldown. Try again in ${Math.ceil(backoffMs / 1000)}s`,
        'retry'
      );
      throw error;
    }

    // Create refresh promise
    const refreshPromise = this._doRefresh(provider, credentials, lockKey);
    this._pendingRefreshes.set(lockKey, refreshPromise);

    try {
      const result = await refreshPromise;
      return result;
    } finally {
      this._pendingRefreshes.delete(lockKey);
    }
  }

  /**
   * Perform the actual token refresh
   * @private
   */
  async _doRefresh(provider, credentials, lockKey) {
    if (!credentials.refreshToken) {
      throw new TokenRefreshError(
        'NO_REFRESH_TOKEN',
        'No refresh token available. Please re-authenticate.',
        'reauth'
      );
    }

    logger.logEvent('token_refresh', { provider, status: 'starting' });

    try {
      let newCredentials;

      switch (provider) {
        case 'anthropic':
        case 'claude':
        case 'claude-code':
          newCredentials = await this._refreshClaudeToken(credentials);
          break;

        case 'openai-codex':
        case 'codex':
        case 'openai':
          newCredentials = await this._refreshOpenAIToken(credentials);
          break;

        default:
          throw new TokenRefreshError(
            'UNKNOWN_PROVIDER',
            `Unknown provider: ${provider}`,
            'contact_support'
          );
      }

      // Save refreshed credentials
      await this._saveRefreshedCredentials(provider, newCredentials);

      // Reset failure count on success
      this._failureCounts.delete(lockKey);
      this._lastFailureTimes.delete(lockKey);

      logger.tokenRefresh(true, { provider });

      return newCredentials;
    } catch (error) {
      // Track failure for backoff
      this._recordFailure(lockKey);

      logger.tokenRefresh(false, {
        provider,
        error: error.message,
        failureCount: this._failureCounts.get(lockKey) || 1,
      });

      if (error instanceof TokenRefreshError) {
        throw error;
      }

      throw new TokenRefreshError(
        'REFRESH_FAILED',
        `Token refresh failed: ${error.message}`,
        'reauth'
      );
    }
  }

  /**
   * Refresh Claude/Anthropic token
   * @private
   */
  async _refreshClaudeToken(credentials) {
    const clientId = process.env.CLAUDE_OAUTH_CLIENT_ID || process.env.CLAUDE_CODE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.CLAUDE_OAUTH_CLIENT_SECRET;

    if (!clientId) {
      throw new TokenRefreshError(
        'MISSING_CONFIG',
        'Claude OAuth client ID not configured',
        'contact_support'
      );
    }

    const response = await axios.post(
      CLAUDE_TOKEN_URL,
      {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret || undefined,
        refresh_token: credentials.refreshToken,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const data = response.data;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || credentials.refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000) - REFRESH_BUFFER_MS,
      scopes: data.scope ? data.scope.split(' ') : credentials.scopes,
      subscriptionType: credentials.subscriptionType,
      rateLimitTier: credentials.rateLimitTier,
    };
  }

  /**
   * Refresh OpenAI/Codex token
   * @private
   */
  async _refreshOpenAIToken(credentials) {
    const clientId = process.env.OPENAI_OAUTH_CLIENT_ID;
    const clientSecret = process.env.OPENAI_OAUTH_CLIENT_SECRET;

    if (!clientId) {
      throw new TokenRefreshError(
        'MISSING_CONFIG',
        'OpenAI OAuth client ID not configured',
        'contact_support'
      );
    }

    const response = await axios.post(
      OPENAI_TOKEN_URL,
      {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret || undefined,
        refresh_token: credentials.refreshToken,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const data = response.data;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || credentials.refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000) - REFRESH_BUFFER_MS,
    };
  }

  /**
   * Save refreshed credentials to both Keychain and JSON
   * @private
   */
  async _saveRefreshedCredentials(provider, credentials) {
    switch (provider) {
      case 'anthropic':
      case 'claude':
      case 'claude-code':
        await ClaudeCodeAuthManager.writeCredentials({
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken,
          expiresAt: credentials.expiresAt,
          scopes: credentials.scopes,
          subscriptionType: credentials.subscriptionType,
          rateLimitTier: credentials.rateLimitTier,
        });
        break;

      case 'openai-codex':
      case 'codex':
      case 'openai':
        // Codex uses different storage format - update via CodexAuthManager
        // For now, we rely on the CLI to handle this
        console.log('[TokenRefresh] Codex token refresh - credentials updated in memory');
        break;
    }
  }

  /**
   * Get current backoff delay for a lock key
   * @private
   */
  _getBackoffDelay(lockKey) {
    const failureCount = this._failureCounts.get(lockKey) || 0;
    const lastFailureTime = this._lastFailureTimes.get(lockKey) || 0;

    if (failureCount === 0) {
      return 0;
    }

    const backoffMs = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, failureCount - 1),
      MAX_BACKOFF_MS
    );

    const elapsed = Date.now() - lastFailureTime;
    return Math.max(0, backoffMs - elapsed);
  }

  /**
   * Record a failure for exponential backoff
   * @private
   */
  _recordFailure(lockKey) {
    const currentCount = this._failureCounts.get(lockKey) || 0;
    const newCount = Math.min(currentCount + 1, MAX_RETRY_COUNT);

    this._failureCounts.set(lockKey, newCount);
    this._lastFailureTimes.set(lockKey, Date.now());
  }

  /**
   * Reset backoff state for a provider
   * @param {string} provider
   */
  resetBackoff(provider) {
    // Clear all entries for this provider
    for (const [key] of this._failureCounts) {
      if (key.startsWith(`${provider}:`)) {
        this._failureCounts.delete(key);
        this._lastFailureTimes.delete(key);
      }
    }
  }
}

/**
 * Custom error class for token refresh failures
 */
export class TokenRefreshError extends Error {
  /**
   * @param {string} code - Error code
   * @param {string} message - User-friendly message
   * @param {'setup' | 'reauth' | 'retry' | 'contact_support'} recovery - Suggested action
   */
  constructor(code, message, recovery) {
    super(message);
    this.name = 'TokenRefreshError';
    this.code = code;
    this.recovery = recovery;
  }
}

// Export singleton instance
export const tokenRefreshManager = new TokenRefreshManager();
export default tokenRefreshManager;
