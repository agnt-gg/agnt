/**
 * Auth Services Index
 *
 * Provides unified access to authentication managers for different providers.
 */

import ClaudeCodeAuthManager from './ClaudeCodeAuthManager.js';
import CodexAuthManager from './CodexAuthManager.js';
import { authProfileStore } from './AuthProfileStore.js';
import { createAuthProfile, isTokenExpired } from './types.js';

/**
 * Supported providers
 */
export const PROVIDERS = {
  ANTHROPIC: 'anthropic',
  OPENAI_CODEX: 'openai-codex',
};

/**
 * Get credentials for a specific provider
 * Uses the appropriate auth manager based on provider type.
 *
 * @param {string} provider - Provider name ('anthropic' or 'openai-codex')
 * @returns {Promise<import('./types.js').AuthProfile | null>}
 */
export async function getCredentialsForProvider(provider) {
  switch (provider) {
    case PROVIDERS.ANTHROPIC:
    case 'claude':
    case 'claude-code': {
      const creds = await ClaudeCodeAuthManager.getCredentials();
      if (!creds) return null;

      return createAuthProfile({
        id: `claude-${creds.source}`,
        provider: PROVIDERS.ANTHROPIC,
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: creds.expiresAt,
        scopes: creds.scopes,
        subscriptionType: creds.subscriptionType,
        rateLimitTier: creds.rateLimitTier,
      });
    }

    case PROVIDERS.OPENAI_CODEX:
    case 'codex':
    case 'openai': {
      const token = CodexAuthManager.getAccessToken();
      const refreshToken = CodexAuthManager.getRefreshToken();
      if (!token) return null;

      // Codex doesn't always have explicit expiry, estimate from last_refresh
      const authStatus = await CodexAuthManager.checkApiUsable();

      return createAuthProfile({
        id: `codex-${authStatus.source || 'unknown'}`,
        provider: PROVIDERS.OPENAI_CODEX,
        accessToken: token,
        refreshToken: refreshToken,
        expiresAt: Date.now() + (60 * 60 * 1000), // Assume 1 hour if unknown
      });
    }

    default:
      console.warn(`[Auth] Unknown provider: ${provider}`);
      return null;
  }
}

/**
 * Check if credentials are available for a provider
 * @param {string} provider - Provider name
 * @returns {Promise<boolean>}
 */
export async function hasCredentialsForProvider(provider) {
  const creds = await getCredentialsForProvider(provider);
  return creds !== null && !!creds.accessToken;
}

/**
 * Get the appropriate auth manager for a provider
 * @param {string} provider - Provider name
 * @returns {object | null}
 */
export function getAuthManagerForProvider(provider) {
  switch (provider) {
    case PROVIDERS.ANTHROPIC:
    case 'claude':
    case 'claude-code':
      return ClaudeCodeAuthManager;

    case PROVIDERS.OPENAI_CODEX:
    case 'codex':
    case 'openai':
      return CodexAuthManager;

    default:
      return null;
  }
}

/**
 * Check API usability for a provider
 * @param {string} provider - Provider name
 * @returns {Promise<object>}
 */
export async function checkProviderStatus(provider) {
  const manager = getAuthManagerForProvider(provider);
  if (!manager) {
    return {
      available: false,
      apiUsable: false,
      error: `Unknown provider: ${provider}`,
    };
  }

  return manager.checkApiUsable();
}

/**
 * Get all available providers with their status
 * @returns {Promise<object[]>}
 */
export async function getAllProviderStatus() {
  const results = [];

  for (const provider of Object.values(PROVIDERS)) {
    const status = await checkProviderStatus(provider);
    results.push({
      provider,
      ...status,
    });
  }

  return results;
}

// Re-export individual managers and utilities
export { ClaudeCodeAuthManager, CodexAuthManager, authProfileStore };
export { createAuthProfile, isTokenExpired } from './types.js';

export default {
  PROVIDERS,
  getCredentialsForProvider,
  hasCredentialsForProvider,
  getAuthManagerForProvider,
  checkProviderStatus,
  getAllProviderStatus,
  ClaudeCodeAuthManager,
  CodexAuthManager,
  authProfileStore,
};
