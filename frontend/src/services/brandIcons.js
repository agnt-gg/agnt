/**
 * The brand icon for a plugin or a sign-in, from the icons AGNT ships (src/assets/icons).
 *
 * A brand's mark is the file named by its sign-in id (services/iconNames.js), so this only decides
 * which id or name applies, in order: the plugin's own brand (`<id>-plugin` is the `<id>` brand),
 * the manifest icon when it names a shipped file, its sign-in's brand, the nearest shipped icon for a
 * generic glyph ("calendar", "globe"), and only then the generic fallback.
 */
import { canonicalIconName } from './iconNames.js';

const files = import.meta.glob('/src/assets/icons/*.svg');
export const SHIPPED_ICONS = new Set(Object.keys(files).map((path) => path.split('/').pop().replace(/\.svg$/, '')));

/** Plugins whose name is not `<brand id>-plugin`. */
const PLUGIN_BRAND = Object.freeze({
  'elevenlabs-media': 'elevenlabs',
});

/** Generic glyph names manifests use (Font Awesome / Lucide style) mapped to the nearest shipped icon. */
const GLYPH = Object.freeze({
  globe: 'web', wifi: 'web', search: 'web', flask: 'magic', 'flask-conical': 'magic', sparkles: 'magic', brain: 'agent',
  'person-standing': 'agent', bolt: 'flow-2', hammer: 'create', 'pen-ruler': 'create', 'gauge-high': 'dashboard',
  'building-shield': 'dashboard', wallet: 'finance', 'dollar-sign': 'finance', graph: 'database', mic: 'speaker',
  gamepad: 'dice', 'scale-balanced': 'check', 'shield-check': 'check', 'shield-halved': 'check', 'shield-alt': 'check',
  cube: 'grid', hexagon: 'grid', 'code-branch': 'code', message: 'chat', 'message-circle': 'chat', 'message-square': 'chat',
  calendar: 'clock', 'file-lines': 'document', film: 'video', music: 'speaker', envelope: 'inbox', 'chart-line': 'dashboard',
  rocket: 'magic', plug: 'connect',
});
const bare = (name) => String(name || '').replace(/^fa[srb]?\s+/, '').replace(/^fa-/, '').trim();

/** The shipped icon a name or id resolves to, or null. */
export function shippedIcon(name) {
  if (typeof name !== 'string' || !name) return null;
  if (SHIPPED_ICONS.has(name)) return name;
  const canonical = canonicalIconName(name);
  return SHIPPED_ICONS.has(canonical) ? canonical : null;
}

/** The brand icon for a sign-in id (google, slack, notion, github…), else its declared icon, or null. */
export function providerIcon(providerId, declared = '') {
  return shippedIcon(String(providerId || '').trim().toLowerCase()) || shippedIcon(declared) || null;
}

/** Template helpers: a sign-in's brand icon (else the declared icon, else fallback), and a plugin's. */
export const brandIcon = (providerId, declared = '', fallback = 'connect') => providerIcon(providerId, declared) || fallback;
export const brandApp = (plugin, providerId = '') => pluginIcon(plugin, { providers: providerId ? [String(providerId).toLowerCase()] : [] });

/** The plugin's own brand: an exception, or `<id>-plugin` naming a shipped brand. */
function ownBrand(name) {
  if (PLUGIN_BRAND[name]) return shippedIcon(PLUGIN_BRAND[name]);
  return name.endsWith('-plugin') ? shippedIcon(name.slice(0, -'-plugin'.length)) : null;
}

/** The brand icon for a plugin row: its own brand, shipped manifest icon, its sign-in's brand, a glyph, else fallback. */
export function pluginIcon(plugin, { providers = [], fallback = 'puzzle-piece' } = {}) {
  const name = String(plugin?.name || '').toLowerCase();
  return ownBrand(name)
    || shippedIcon(plugin?.icon)
    || providers.map((id) => providerIcon(id)).find(Boolean)
    || shippedIcon(GLYPH[bare(plugin?.icon)])
    || shippedIcon(bare(plugin?.icon))
    || (String(plugin?.kind || '').toLowerCase() === 'pack' ? 'agent' : fallback);
}
