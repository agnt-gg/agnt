/**
 * The real brand icon for a plugin or a sign-in, from the icons AGNT ships (src/assets/icons).
 *
 * A plugin's manifest `icon` is often a generic glyph ("calendar", "file-lines") or an emoji, so the
 * Apps page would show a calendar outline for Google Calendar. This resolves, in order: a known
 * plugin's brand mark, the manifest icon when AGNT ships it, the sign-in's brand mark
 * (business-<id> or <id>), and only then the generic fallback.
 */
const files = import.meta.glob('/src/assets/icons/*.svg');
export const SHIPPED_ICONS = new Set(Object.keys(files).map((path) => path.split('/').pop().replace(/\.svg$/, '')));

/** Plugins whose manifest names a generic glyph but whose brand mark AGNT ships. */
const PLUGIN_BRAND = Object.freeze({
  'gmail-plugin': 'gmail',
  'google-calendar-plugin': 'google-calendar',
  'google-docs-plugin': 'google-docs',
  'google-sheets-plugin': 'google-sheets',
  'google-meet-plugin': 'google-meet',
  'google-drive-plugin': 'google-drive',
  'google-slides-plugin': 'google-slides',
  'youtube-plugin': 'youtube',
  'ga4-plugin': 'business-ga4',
  'searchconsole-plugin': 'business-searchconsole',
});

/** Sign-in ids whose brand file has a different name. */
const PROVIDER_BRAND = Object.freeze({ microsoft365: 'business-microsoft365', microsoft: 'microsoft', ga4: 'business-ga4' });

const shipped = (name) => (typeof name === 'string' && SHIPPED_ICONS.has(name) ? name : null);

/** The brand icon for a sign-in id (google, slack, notion, github…), or null. */
export function providerIcon(providerId, declared = '') {
  const id = String(providerId || '').trim().toLowerCase();
  return shipped(PROVIDER_BRAND[id]) || shipped(id) || shipped(`business-${id}`) || shipped(declared) || null;
}

/** Template helpers: a sign-in's brand icon (else the declared icon, else fallback), and a plugin's. */
export const brandIcon = (providerId, declared = '', fallback = 'connect') => providerIcon(providerId, declared) || fallback;
export const brandApp = (plugin, providerId = '') => pluginIcon(plugin, { providers: providerId ? [String(providerId).toLowerCase()] : [] });

/** The brand icon for a plugin row: known brand, shipped manifest icon, its sign-in's brand, else fallback. */
export function pluginIcon(plugin, { providers = [], fallback = 'puzzle-piece' } = {}) {
  const name = String(plugin?.name || '').toLowerCase();
  return shipped(PLUGIN_BRAND[name])
    || shipped(plugin?.icon)
    || providers.map((id) => providerIcon(id)).find(Boolean)
    || fallback;
}
