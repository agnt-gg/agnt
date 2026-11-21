// Which shipped icon a plugin or a sign-in is drawn with.
import { describe, it, expect } from 'vitest';
import { brandIcon, pluginIcon, providerIcon, SHIPPED_ICONS } from './brandIcons.js';

describe('brand icons', () => {
  it('a sign-in whose mark ships only as business-<id> gets it (Twilio, Linear)', () => {
    expect(SHIPPED_ICONS.has('twilio')).toBe(false);
    expect(providerIcon('twilio')).toBe('business-twilio');
    expect(providerIcon('linear')).toBe('business-linear');
    // A list that hands the raw manifest icon or id to SvgIcon drew a puzzle piece; brandIcon is the one lookup.
    expect(brandIcon('twilio', 'twilio')).toBe('business-twilio');
    expect(brandIcon('linear', '')).toBe('business-linear');
  });

  it.each([
    [{ name: 'elevenlabs-media', icon: 'music' }, 'elevenlabs'],
    [{ name: 'elevenlabs-plugin', icon: 'mic' }, 'elevenlabs'],
    [{ name: 'cartesia-plugin', icon: 'mic' }, 'cartesia'],
    [{ name: 'firecrawl-plugin', icon: 'data:image/jpeg;base64,AAAA' }, 'fire'],
    [{ name: 'twilio-plugin', icon: 'business-twilio' }, 'business-twilio'],
    [{ name: 'linear-plugin', icon: 'business-linear' }, 'business-linear'],
  ])('%o is drawn with its brand mark', (plugin, icon) => {
    expect(pluginIcon(plugin)).toBe(icon);
  });

  it.each([
    ['film', 'video'],
    ['music', 'speaker'],
    ['envelope', 'inbox'],
    ['chart-line', 'dashboard'],
    ['rocket', 'magic'],
  ])('a manifest glyph %s maps to a shipped icon, not the puzzle piece', (glyph, icon) => {
    expect(pluginIcon({ name: 'some-plugin', icon: glyph })).toBe(icon);
  });

  it('every mapped icon ships', () => {
    for (const name of ['elevenlabs', 'cartesia', 'fire', 'video', 'speaker', 'inbox', 'dashboard', 'magic']) expect(SHIPPED_ICONS.has(name), name).toBe(true);
  });
});
