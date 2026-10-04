import { describe, it, expect } from 'vitest';
import { buildAppCards, findAppCard, describeApps, primaryProvider, suggestedPlugins, appDisplayName, APP_STATUS } from './appCards.js';

// Shaped like the real /plugins/installed, /auth/providers and
// /users/connection-health payloads on the machine this was built against.
const tool = (type, authProvider) => ({ type, schema: { title: type, ...(authProvider ? { authProvider } : {}) } });
const INSTALLED = [
  { name: 'gmail-plugin', displayName: 'Gmail', icon: 'gmail', tools: [tool('gmail-api', 'google')] },
  { name: 'google-sheets-plugin', displayName: 'Google Sheets', tools: [tool('google-sheets-api', 'google'), tool('google-sheets-new-row', 'google')] },
  { name: 'dropbox-plugin', displayName: 'Dropbox', tools: [tool('dropbox-api', 'dropbox')] },
  { name: 'figma-bridge', displayName: 'Figma Bridge', icon: 'pen-ruler', tools: [tool('figma-bridge-send'), tool('figma-bridge-read')] },
  { name: 'seedance-plugin', displayName: 'Seedance', tools: [tool('seedance-generate', 'openrouter')] },
  { name: 'shopify-plugin', displayName: 'Shopify', tools: [tool('shopify-api', 'shopify')] },
  { name: 'quickbooks-plugin', displayName: 'QuickBooks', tools: [tool('quickbooks-api', 'quickbooks')] },
];
const CATALOGUE = [
  { id: 'google', name: 'Google', icon: 'google', connection_type: 'oauth' },
  { id: 'dropbox', name: 'Dropbox', icon: 'dropbox', connectionType: 'oauth' },
  { id: 'shopify', name: 'Shopify', connection_type: 'apikey' },
  { id: 'quickbooks', name: 'QuickBooks', connection_type: 'oauth' },
  { id: 'stripe', name: 'Stripe', connection_type: 'apikey' },
  { id: 'notion', name: 'Notion', connection_type: 'oauth' },
  { id: 'openai', name: 'OpenAI', connection_type: 'apikey' },
  { id: 'openrouter', name: 'OpenRouter', connection_type: 'apikey' },
  { id: 'claude-code', name: 'Claude Code', connectionType: 'cli' },
];
const CONNECTED = ['google', 'dropbox', 'quickbooks', 'stripe', 'openai', 'openrouter'];
const HEALTH = [
  { provider: 'google', status: 'healthy' },
  { provider: 'quickbooks', status: 'error' },
];
const WIDGETS = [{ id: 'cw_figma', name: 'Figma Bridge', source_plugin: 'figma-bridge' }, { id: 'cw_mine', name: 'Mine' }];
const SKILLS = [{ id: 'sk_figma', name: 'figma-bridge', source_plugin: 'figma-bridge' }];
// What callers pass from store/app/aiProvider.js (AI_PROVIDERS_WITH_API).
const AI_IDS = ['anthropic', 'openai', 'openrouter', 'claude-code', 'gemini'];

const build = (extra = {}, query = '') =>
  buildAppCards(
    { installed: INSTALLED, catalogue: CATALOGUE, connectedApps: CONNECTED, health: HEALTH, widgets: WIDGETS, skills: SKILLS, aiProviderIds: AI_IDS, ...extra },
    query,
  );

describe('buildAppCards', () => {
  it('folds every plugin that shares a sign-in into ONE card named after the service', () => {
    const google = findAppCard(build(), 'google');
    expect(google.kind).toBe('account');
    expect(google.name).toBe('Google');
    expect(google.apps.map((a) => a.displayName)).toEqual(['Gmail', 'Google Sheets']);
    expect(google.counts.tools).toBe(3);
    expect(google.status).toBe(APP_STATUS.READY);
  });

  it('a plugin with no sign-in is its own card, ready, with what it ships counted', () => {
    const figma = findAppCard(build(), 'app:figma-bridge');
    expect(figma).toMatchObject({ kind: 'app', providerId: null, name: 'Figma Bridge', status: APP_STATUS.READY });
    expect(figma.counts).toEqual({ tools: 2, widgets: 1, skills: 1 });
    expect(figma.apps[0].widgets).toEqual([{ id: 'cw_figma', name: 'Figma Bridge' }]);
  });

  it('status is Connect when the sign-in is missing and Reconnect when it is failing', () => {
    const { yours } = build();
    expect(findAppCard({ yours }, 'shopify').status).toBe(APP_STATUS.CONNECT);
    expect(findAppCard({ yours }, 'quickbooks').status).toBe(APP_STATUS.RECONNECT);
  });

  it('things that need you come first, then alphabetical', () => {
    const order = build().yours.map((c) => c.id);
    expect(order.slice(0, 2)).toEqual(['quickbooks', 'shopify']);
    const ready = build().yours.filter((c) => c.status === APP_STATUS.READY).map((c) => c.name);
    expect(ready).toEqual([...ready].sort((a, b) => a.localeCompare(b)));
  });

  it('a sign-in with no plugin is still yours (used through Custom API)', () => {
    const stripe = findAppCard(build(), 'stripe');
    expect(stripe).toMatchObject({ kind: 'account', status: APP_STATUS.READY, apps: [] });
    expect(build().discover.some((c) => c.id === 'stripe')).toBe(false);
  });

  it('AI model providers never become cards — they live in Settings › AI Models', () => {
    const all = [...build().yours, ...build().discover].map((c) => c.id);
    for (const id of ['openai', 'openrouter', 'agnt', 'claude-code']) expect(all).not.toContain(id);
  });

  it('a plugin that bills through a model key keeps its own name and says so', () => {
    const seedance = findAppCard(build(), 'app:seedance-plugin');
    expect(seedance).toMatchObject({ kind: 'app', name: 'Seedance', providerId: 'openrouter', usesModelKey: true, status: APP_STATUS.READY });
    expect(findAppCard(build({ connectedApps: ['google'] }), 'app:seedance-plugin').status).toBe(APP_STATUS.CONNECT);
  });

  it('Discover lists services you could connect that are not yours yet', () => {
    expect(build().discover.map((c) => c.id)).toEqual(['notion']);
    expect(build().discover[0].status).toBe(APP_STATUS.CONNECT);
  });

  it('search matches the service, and the apps inside it', () => {
    expect(build({}, 'sheets').yours.map((c) => c.id)).toEqual(['google']);
    expect(build({}, 'figma').yours.map((c) => c.id)).toEqual(['app:figma-bridge']);
  });

  it('suggests uninstalled plugins for a sign-in by declaration or tag — never by a near-miss', () => {
    const available = [
      { name: 'google-docs-plugin', displayName: 'Google Docs', tags: ['google', 'docs'] },
      { name: 'google-drive-plugin', displayName: 'Google Drive', tools: [tool('drive', 'google')] },
      { name: 'gmail-plugin', displayName: 'Gmail', tags: ['google'] }, // installed already
      { name: 'googlemaps-plugin', displayName: 'Maps', tags: ['googlemaps'] }, // not 'google'
    ];
    expect(findAppCard(build({ available }), 'google').suggested.map((s) => s.name)).toEqual(['google-docs-plugin', 'google-drive-plugin']);
    // App cards (no shared sign-in) never carry suggestions.
    expect(findAppCard(build({ available }), 'app:figma-bridge').suggested).toEqual([]);
  });

  it('tolerates empty and malformed input', () => {
    expect(buildAppCards()).toEqual({ yours: [], discover: [] });
    expect(buildAppCards({ installed: [null, { tools: 'x' }], catalogue: 'nope', connectedApps: null })).toEqual({ yours: [], discover: [] });
  });

  it('a catalogue-less one-plugin sign-in reads as the plugin, not as a raw id', () => {
    const cards = buildAppCards({ installed: [{ name: 'atlas-cloud', displayName: 'Atlas Cloud', tools: [tool('atlas', 'atlas-cloud')] }], connectedApps: ['atlas-cloud'] });
    expect(findAppCard(cards, 'atlas-cloud').name).toBe('Atlas Cloud');
  });
});

describe('primaryProvider', () => {
  const models = new Set(['openrouter']);
  it('prefers an app sign-in over a model key, and groups only app sign-ins', () => {
    expect(primaryProvider({ tools: [tool('a', 'openrouter'), tool('b', 'Bankr')] }, models)).toEqual({ providerId: 'bankr', grouped: true });
    expect(primaryProvider({ tools: [tool('a', 'openrouter')] }, models)).toEqual({ providerId: 'openrouter', grouped: false });
    expect(primaryProvider({ tools: [tool('a')] }, models)).toEqual({ providerId: null, grouped: false });
  });

  it("AGNT's own account is never an app sign-in, even with no registry passed", () => {
    expect(primaryProvider({ tools: [tool('a', 'agnt')] })).toEqual({ providerId: 'agnt', grouped: false });
  });
});

describe('appDisplayName', () => {
  it('never shows the word plugin', () => {
    expect(appDisplayName({ name: 'plaid-plugin', displayName: 'Plaid Plugin' })).toBe('Plaid');
    expect(appDisplayName({ name: 'multi-source-randomizer-plugin' })).toBe('Multi Source Randomizer');
    expect(appDisplayName({ name: 'x', displayName: 'Plugin' })).toBe('Plugin');
    expect(appDisplayName({ name: 'figma-bridge', displayName: 'Figma Bridge' })).toBe('Figma Bridge');
  });
});

describe('suggestedPlugins', () => {
  it('returns nothing without a provider', () => {
    expect(suggestedPlugins([{ name: 'x', tags: [''] }], new Set(), '')).toEqual([]);
  });
});

describe('describeApps', () => {
  it('names the apps a disconnect stops, briefly', () => {
    const card = (n) => ({ apps: Array.from({ length: n }, (_, i) => ({ displayName: `App${i + 1}` })) });
    expect(describeApps(card(1))).toBe('App1');
    expect(describeApps(card(2))).toBe('App1 and App2');
    expect(describeApps(card(3))).toBe('App1, App2 and App3');
    expect(describeApps(card(8))).toBe('App1, App2, App3 and 5 more');
    expect(describeApps(null)).toBe('');
  });
});
