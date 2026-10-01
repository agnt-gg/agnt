import { getConnection } from '../ai/connectionRuntime.js';
const messageConnection = getConnection('claude-code');
const responseConnection = getConnection('openai-codex');
const projectConnection = getConnection('gemini-cli');
const catalogConnection = getConnection('antigravity');
/**
 * AuthDispatcher — thin mapping layer from authScheme → auth manager + capabilities.
 *
 * Local providers (CLI tools) are handled entirely on localhost with filesystem credentials.
 * Remote providers proxy to agnt.gg for token management.
 */

import { getProviderConfig, getAllProviderConfigs } from '../ai/providerConfigs.js';
import GrokBuildAuthManager from './GrokBuildAuthManager.js';
import CursorCliAuthManager from './CursorCliAuthManager.js';
import { getPluginAuthProvider } from '../../plugins/pluginAuth.js';

// ─────────────────────────── SCHEME MAP ───────────────────────────

const AUTH_SCHEME_MAP = {
  // LOCAL — handled entirely on localhost, filesystem credentials, NO remote calls
  'claude-code': {
    manager: messageConnection,
    local: true,
    caps: ['status', 'connect-token', 'disconnect', 'refresh', 'oauth-pkce'],
  },
  'codex': {
    manager: responseConnection,
    local: true,
    caps: ['status', 'disconnect', 'device-auth', 'refresh'],
  },
  'gemini-cli': {
    manager: projectConnection,
    local: true,
    caps: ['status', 'connect-apikey', 'disconnect', 'refresh', 'oauth-loopback', 'set-auth-method', 'gcp-project'],
  },
  'antigravity': {
    manager: catalogConnection,
    local: true,
    caps: ['status', 'disconnect', 'refresh', 'oauth-loopback', 'gcp-project'],
  },
  'grok-build': {
    manager: GrokBuildAuthManager,
    local: true,
    caps: ['status', 'disconnect', 'device-auth', 'refresh'],
  },
  'cursor-cli': {
    manager: CursorCliAuthManager,
    local: true,
    caps: ['status', 'disconnect', 'device-auth', 'refresh'],
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
  // Built-in providers always win: a plugin cannot redefine how an AI
  // provider or CLI authenticates by declaring the same id.
  if (!config) return getPluginAuthEntry(providerId);

  const schemeEntry = AUTH_SCHEME_MAP[config.authScheme];
  if (!schemeEntry) return null;

  return { ...schemeEntry, config };
}

/**
 * A provider a plugin declared in its manifest. Its credentials are stored in
 * this install (api_keys / oauth_tokens), never remotely, so it takes the
 * routes' non-local branch for connect/disconnect and the `plugin` flag for the
 * OAuth routes.
 */
function getPluginAuthEntry(providerId) {
  const provider = getPluginAuthProvider(providerId);
  if (!provider) return null;
  const caps = provider.type === 'oauth2' ? ['status', 'oauth-plugin', 'disconnect'] : ['status', 'connect-apikey', 'disconnect'];
  return {
    manager: null,
    local: false,
    remote: false,
    plugin: true,
    caps,
    provider,
    config: { key: provider.id, name: provider.name, authScheme: `plugin-${provider.type}` },
  };
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
    plugin: entry.plugin || false,
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
