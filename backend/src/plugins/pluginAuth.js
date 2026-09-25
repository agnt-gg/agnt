/**
 * Auth providers declared by plugins.
 *
 * A plugin that talks to an external service declares how to connect to it in
 * its manifest, next to the tools that need the connection:
 *
 *   "auth": [{
 *     "id": "pipedrive",                 // what tools name in `authProvider`
 *     "name": "Pipedrive",
 *     "icon": "business-pipedrive",
 *     "type": "apikey",                  // or "oauth2"
 *     "keyLabel": "API token",
 *     "instructions": "Settings → Personal preferences → API",
 *     "helpUrl": "https://…",
 *     // oauth2 only:
 *     "authorizationUrl": "https://…", "tokenUrl": "https://…",
 *     "scopes": ["…"], "scopeSeparator": " ", "pkce": true,
 *     "clientId": "…",                   // optional public client; omitted = user supplies one
 *     "authorizationParams": { "access_type": "offline" }
 *   }]
 *
 * This module has NO imports on purpose. AuthDispatcher and AuthManager read it,
 * and PluginManager (which reaches AuthManager through ToolConfig) feeds it, so
 * any import here would close a cycle. PluginManager binds its loaded-plugin
 * list once; everything below is derived from that list on every call, so an
 * install, reload or uninstall is reflected immediately with no state to sync.
 */

const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TYPES = new Set(['apikey', 'oauth2']);

let readLoadedPlugins = () => [];

/** PluginManager calls this once with a function returning its loaded plugins. */
export function bindPluginSource(fn) {
  readLoadedPlugins = typeof fn === 'function' ? fn : () => [];
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function text(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/**
 * Validate one manifest declaration. Returns { provider } or { error }. Never
 * throws: one bad declaration must not take the plugin's other providers down.
 */
export function normalizeAuthDeclaration(declaration, pluginName) {
  if (!declaration || typeof declaration !== 'object') return { error: 'auth entry must be an object' };
  const id = String(declaration.id || '').trim().toLowerCase();
  if (!PROVIDER_ID.test(id)) return { error: `auth id "${declaration.id}" must match ${PROVIDER_ID}` };
  const type = String(declaration.type || '').toLowerCase();
  if (!TYPES.has(type)) return { error: `auth "${id}": type must be "apikey" or "oauth2"` };

  const provider = {
    id,
    name: text(declaration.name, 80) || id,
    icon: text(declaration.icon, 80) || 'puzzle-piece',
    type,
    connectionType: type === 'oauth2' ? 'oauth' : 'apikey',
    instructions: text(declaration.instructions, 2000),
    helpUrl: declaration.helpUrl ? httpsUrl(declaration.helpUrl) || undefined : undefined,
    keyLabel: text(declaration.keyLabel, 80) || (type === 'apikey' ? 'API key' : undefined),
    plugin: pluginName,
  };

  if (type === 'oauth2') {
    const authorizationUrl = httpsUrl(declaration.authorizationUrl);
    const tokenUrl = httpsUrl(declaration.tokenUrl);
    if (!authorizationUrl || !tokenUrl) return { error: `auth "${id}": oauth2 needs https authorizationUrl and tokenUrl` };
    const scopes = Array.isArray(declaration.scopes) ? declaration.scopes.filter((s) => typeof s === 'string' && s.trim()) : [];
    const params = declaration.authorizationParams && typeof declaration.authorizationParams === 'object' ? declaration.authorizationParams : {};
    provider.oauth = {
      authorizationUrl,
      tokenUrl,
      scopes,
      scopeSeparator: typeof declaration.scopeSeparator === 'string' ? declaration.scopeSeparator : ' ',
      pkce: declaration.pkce !== false,
      clientId: text(declaration.clientId, 300),
      // Only string pairs, and never the parameters the flow itself owns.
      authorizationParams: Object.fromEntries(
        Object.entries(params).filter(
          ([key, value]) =>
            typeof value === 'string' && !['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'scope'].includes(key)
        )
      ),
    };
  }
  return { provider };
}

/**
 * Every valid provider declared by a loaded, enabled plugin. When two plugins
 * declare the same id the first loaded wins and the clash is reported, so the
 * outcome is deterministic and visible rather than last-writer-wins.
 */
export function listPluginAuthProviders() {
  const byId = new Map();
  const problems = [];
  for (const plugin of readLoadedPlugins() || []) {
    const manifest = plugin?.manifest;
    const pluginName = manifest?.name || plugin?.name;
    if (!manifest || manifest.auth === undefined) continue;
    if (!Array.isArray(manifest.auth)) {
      problems.push(`${pluginName}: manifest.auth must be an array`);
      continue;
    }
    for (const declaration of manifest.auth) {
      const { provider, error } = normalizeAuthDeclaration(declaration, pluginName);
      if (error) problems.push(`${pluginName}: ${error}`);
      else if (byId.has(provider.id)) problems.push(`${pluginName}: auth "${provider.id}" already declared by ${byId.get(provider.id).plugin}`);
      else byId.set(provider.id, provider);
    }
  }
  return { providers: [...byId.values()], problems };
}

export function getPluginAuthProvider(providerId) {
  const id = String(providerId || '').toLowerCase();
  return listPluginAuthProviders().providers.find((provider) => provider.id === id) || null;
}

/** The shape the Connections UI lists, with nothing secret or flow-internal in it. */
export function publicProviderView(provider) {
  return {
    id: provider.id,
    name: provider.name,
    icon: provider.icon,
    categories: ['Plugins'],
    connectionType: provider.connectionType,
    instructions: provider.instructions,
    helpUrl: provider.helpUrl,
    keyLabel: provider.keyLabel,
    needsClientCredentials: provider.type === 'oauth2' && !provider.oauth.clientId,
    pluginProvided: true,
    plugin: provider.plugin,
  };
}
