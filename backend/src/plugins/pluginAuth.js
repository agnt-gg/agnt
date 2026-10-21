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
 * Its only import is the plugin validation core, which imports nothing but
 * Node built-ins: AuthDispatcher and AuthManager read this module, and
 * PluginManager (which reaches AuthManager through ToolConfig) feeds it, so an
 * app import here would close a cycle. The core owns how a declaration is
 * read, so the runtime, the build, the install check and the marketplace's
 * publish gate cannot disagree about it. PluginManager binds its loaded-plugin
 * list once; everything below is derived from that list on every call, so an
 * install, reload or uninstall is reflected immediately with no state to sync.
 */

import { normalizeAuthDeclaration } from '../../plugins/lib/validate-core.js';

export { normalizeAuthDeclaration };

let readLoadedPlugins = () => [];

/** PluginManager calls this once with a function returning its loaded plugins. */
export function bindPluginSource(fn) {
  readLoadedPlugins = typeof fn === 'function' ? fn : () => [];
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
