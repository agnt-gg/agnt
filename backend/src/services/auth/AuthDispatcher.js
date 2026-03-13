/**
 * AuthDispatcher — thin mapping layer from authScheme → auth manager + capabilities.
 *
 * Local providers (CLI tools) are handled entirely on localhost with filesystem credentials.
 * Remote providers proxy to agnt.gg for token management.
 */

import { getProviderConfig, getAllProviderConfigs } from '../ai/providerConfigs.js';
import ClaudeCodeAuthManager from './ClaudeCodeAuthManager.js';
import CodexAuthManager from './CodexAuthManager.js';
import GeminiCliAuthManager from './GeminiCliAuthManager.js';

// ─────────────────────────── SCHEME MAP ───────────────────────────

const AUTH_SCHEME_MAP = {
  // LOCAL — handled entirely on localhost, filesystem credentials, NO remote calls
  'claude-code': {
    manager: ClaudeCodeAuthManager,
    local: true,
    caps: ['status', 'connect-token', 'disconnect', 'refresh', 'oauth-pkce'],
  },
  'codex': {
    manager: CodexAuthManager,
    local: true,
    caps: ['status', 'disconnect', 'device-auth'],
  },
  'gemini-cli': {
    manager: GeminiCliAuthManager,
    local: true,
    caps: ['status', 'connect-apikey', 'disconnect', 'refresh', 'oauth-loopback', 'set-auth-method', 'gcp-project'],
  },

  // REMOTE — proxied to agnt.gg for token management
  'bearer': {
    manager: null,
    local: false,
    remote: true,
    caps: ['status', 'connect-apikey', 'disconnect'],
  },
  'api-key': {
    manager: null,
    local: false,
    remote: true,
    caps: ['status', 'connect-apikey', 'disconnect'],
  },
  'query-param': {
    manager: null,
    local: false,
    remote: true,
    caps: ['status', 'connect-apikey', 'disconnect'],
  },
};

// ─────────────────────────── EXPORTS ───────────────────────────

/**
 * Look up provider in providerConfigs, return { manager, local, remote, caps, config }.
 * Returns null if provider not found.
 */
export function getAuthEntry(providerId) {
  const config = getProviderConfig(providerId);
  if (!config) return null;

  const schemeEntry = AUTH_SCHEME_MAP[config.authScheme];
  if (!schemeEntry) return null;

  return { ...schemeEntry, config };
}

/**
 * Return capabilities array + metadata for a provider.
 */
export function getCapabilities(providerId) {
  const entry = getAuthEntry(providerId);
  if (!entry) return null;

  return {
    providerId,
    providerName: entry.config.name,
    local: entry.local || false,
    remote: entry.remote || false,
    capabilities: entry.caps,
  };
}

/**
 * Return provider keys where local: true.
 */
export function getCliProviderIds() {
  const configs = getAllProviderConfigs();
  return configs
    .filter((c) => {
      const scheme = AUTH_SCHEME_MAP[c.authScheme];
      return scheme && scheme.local === true;
    })
    .map((c) => c.key);
}

/**
 * True if the provider uses local/filesystem-backed auth.
 */
export function isLocalProvider(providerId) {
  const entry = getAuthEntry(providerId);
  return entry?.local === true;
}
