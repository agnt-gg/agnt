// Which shipped icon a plugin or a sign-in is drawn with: one file per brand, named by its id.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { brandIcon, pluginIcon, providerIcon, shippedIcon, SHIPPED_ICONS } from './brandIcons.js';
import { ICON_ALIASES, canonicalIconName } from './iconNames.js';

const ICON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/icons');

// Every sign-in in the catalogue (auth server /auth/providers, 2026-11-21).
const CATALOGUE_IDS = [
  'deepseek', 'discord', 'gemini', 'firecrawl', 'togetherai', 'agnt', 'grokai', 'groq', 'linkedin', 'jira', 'unsplash',
  'openai', 'anthropic', 'stripe', 'mailchimp', 'airtable', 'apple', 'asana', 'microsoft', 'salesforce', 'aws', 'zoom',
  'atlassian', 'hubspot', 'canva', 'tableau', 'zendesk', 'intercom', 'trello', 'obsidian', 'quickbooks', 'evernote',
  'facebook', 'figma', 'metamask', 'todoist', 'monday', 'clickup', 'analytics', 'xero', 'cerebras', 'zai', 'kimi',
  'minimax', 'bankr', 'elevenlabs', 'kimi-code', 'atlas-cloud', 'chutes', 'telegram', 'dropbox', 'github', 'slack',
  'notion', 'zapier', 'google', 'ebay', 'calendly', 'twitter', 'photon', 'kaggle', 'npm', 'antigravity', 'claude-code',
  'openai-codex', 'digital-ocean', 'hetzner-robot', 'simplefin', 'namecheap', 'coinbase-cdp', 'typesafe', 'stripe-test',
  'agnt-backup-key-escrow', 'photon-dashboard', 'rapidapi', 'viggle', 'hunter', 'cartesia',
];
// The sign-ins the business plugins bring with them.
const BUSINESS_IDS = [
  'airtable', 'asana', 'brevo', 'clickup', 'freshdesk', 'ga4', 'hubspot', 'intercom', 'jotform', 'klaviyo', 'linear',
  'mailchimp', 'microsoft365', 'monday', 'pandadoc', 'pipedrive', 'posthog', 'quickbooks', 'searchconsole', 'shopify',
  'twilio', 'typeform', 'xero', 'zendesk',
];
const markup = (name) => mount(SvgIcon, { props: { name } }).html();

describe('one file per brand, named by its id', () => {
  it('no icon carries a prefix or a colour variant', () => {
    const names = readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg'));
    expect(names.filter((f) => /^business-|-color\.svg$/.test(f))).toEqual([]);
  });

  it('every alias points at a shipped file', () => {
    for (const [from, to] of Object.entries(ICON_ALIASES)) expect(SHIPPED_ICONS.has(to), `${from} -> ${to}`).toBe(true);
  });

  it.each([...new Set([...CATALOGUE_IDS, ...BUSINESS_IDS])])('sign-in %s has a shipped icon', (id) => {
    expect(providerIcon(id)).not.toBeNull();
  });

  it('a brand that has a file is that file', () => {
    for (const id of ['twilio', 'linear', 'hubspot', 'microsoft365', 'searchconsole', 'kaggle']) expect(providerIcon(id)).toBe(id);
    expect(providerIcon('ga4')).toBe('google-analytics');
    expect(providerIcon('hetzner-robot')).toBe('hetzner');
    expect(providerIcon('coinbase-cdp')).toBe('coinbase');
  });

  it('every attributed brand file ships, and every Simple Icons file it lists is credited once', () => {
    const credits = JSON.parse(readFileSync(resolve(ICON_DIR, 'brand-icons-attribution.json'), 'utf8'));
    const providers = credits.map((entry) => entry.provider);
    expect(new Set(providers).size).toBe(providers.length);
    for (const id of providers) expect(SHIPPED_ICONS.has(id), id).toBe(true);
  });
});

describe('names written before the rename still draw their mark', () => {
  it.each(BUSINESS_IDS)('business-%s', (id) => {
    const name = `business-${id}`;
    expect(shippedIcon(name)).toBe(canonicalIconName(id));
    expect(markup(name)).toBe(markup(canonicalIconName(id)));
    expect(markup(name)).not.toBe(markup('puzzle-piece'));
  });

  it('gmail-color and youtube-color', () => {
    expect(markup('gmail-color')).toBe(markup('gmail'));
    expect(markup('youtube-color')).toBe(markup('youtube'));
  });

  it('a list that hands over the raw id or old name gets the brand (Twilio, Linear)', () => {
    expect(brandIcon('twilio', 'business-twilio')).toBe('twilio');
    expect(brandIcon('linear', '')).toBe('linear');
  });
});

describe('plugins', () => {
  it.each([
    [{ name: 'twilio-plugin', icon: 'business-twilio' }, 'twilio'],
    [{ name: 'ga4-plugin', icon: 'business-ga4' }, 'google-analytics'],
    [{ name: 'google-sheets-plugin', icon: 'table' }, 'google-sheets'],
    [{ name: 'google-calendar-plugin', icon: 'calendar' }, 'google-calendar'],
    [{ name: 'gmail-plugin', icon: 'gmail' }, 'gmail'],
    [{ name: 'youtube-plugin', icon: 'youtube' }, 'youtube'],
    [{ name: 'elevenlabs-plugin', icon: 'mic' }, 'elevenlabs'],
    [{ name: 'elevenlabs-media', icon: 'music' }, 'elevenlabs'],
    [{ name: 'cartesia-plugin', icon: 'mic' }, 'cartesia'],
    [{ name: 'firecrawl-plugin', icon: 'data:image/jpeg;base64,AAAA' }, 'fire'],
    [{ name: 'polymarket-plugin', icon: 'polymarket' }, 'finance'],
    [{ name: 'hunter-plugin', icon: 'envelope' }, 'inbox'],
  ])('%o is drawn with %s', (plugin, icon) => {
    expect(pluginIcon(plugin)).toBe(icon);
  });

  it('a plugin named <id>-plugin with no brand file keeps its manifest icon', () => {
    expect(pluginIcon({ name: 'dice-roller-plugin', icon: 'dice' })).toBe('dice');
    expect(pluginIcon({ name: 'openweathermap-api-plugin', icon: 'weather' })).toBe('weather');
  });

  it.each([
    ['film', 'video'], ['music', 'speaker'], ['envelope', 'inbox'], ['chart-line', 'dashboard'], ['rocket', 'magic'], ['fas fa-plug', 'connect'],
  ])('a manifest glyph %s maps to %s, not the puzzle piece', (glyph, icon) => {
    expect(pluginIcon({ name: 'some-tool', icon: glyph })).toBe(icon);
  });
});
