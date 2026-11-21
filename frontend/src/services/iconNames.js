/**
 * The names of the icons AGNT ships (src/assets/icons).
 *
 * A brand's mark is one file named by its sign-in id: twilio.svg, hubspot.svg.
 * An id whose mark has another name is listed in ICON_ALIASES, the one place
 * that says so. Plugins and listings written before the rename named their
 * icons business-<id>, gmail-color or youtube-color; those still resolve.
 */

/** Ids and old names whose shipped file has a different name. */
export const ICON_ALIASES = Object.freeze({
  // Same brand, another id.
  ga4: 'google-analytics',
  analytics: 'google-analytics',
  gemini: 'google',
  togetherai: 'together-ai',
  grokai: 'grok-ai',
  'claude-code': 'claude',
  'openai-codex': 'openai',
  'stripe-test': 'stripe',
  photon: 'apple',
  'photon-dashboard': 'apple',
  'hetzner-robot': 'hetzner',
  'coinbase-cdp': 'coinbase',
  firecrawl: 'fire',
  openweathermap: 'weather',
  // Earlier file names.
  'gmail-color': 'gmail',
  'youtube-color': 'youtube',
  // No published mark: the nearest shipped icon.
  agnt: 'custom',
  'agnt-backup-key-escrow': 'custom',
  simplefin: 'finance',
  polymarket: 'finance',
  hunter: 'inbox',
  rapidapi: 'api',
  typesafe: 'code',
  viggle: 'video',
});

const LEGACY_PREFIX = 'business-';

/** The shipped file name for an icon name or sign-in id ('' for none). Pure: it does not check the file exists. */
export function canonicalIconName(name) {
  let key = String(name || '').trim().toLowerCase();
  if (key.startsWith(LEGACY_PREFIX)) key = key.slice(LEGACY_PREFIX.length);
  return ICON_ALIASES[key] || key;
}
