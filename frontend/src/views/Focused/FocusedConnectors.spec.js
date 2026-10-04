import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const dispatch = vi.fn(() => Promise.resolve());
const state = reactive({ appAuth: { allProviders: [], connectionHealth: null }, apps: { installedAt: 1 } });
const getters = reactive({
  'appAuth/connectedApps': [],
  'apps/installed': [],
  'apps/available': [],
  'widgetDefinitions/allDefinitions': [],
  'skills/allSkills': [],
});
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }) }));
import FocusedConnectors from './FocusedConnectors.vue';

const nav = { go: vi.fn(), ask: vi.fn(), studio: vi.fn(), toast: vi.fn(), confirm: vi.fn() };
const tool = (type, authProvider) => ({ type, schema: { title: type, ...(authProvider ? { authProvider } : {}) } });

// The remote catalogue's real shape: snake_case.
const catalogue = Array.from({ length: 15 }, (_, i) => ({
  id: `app${String(i).padStart(2, '0')}`,
  name: `App ${String(i).padStart(2, '0')}`,
  connection_type: 'oauth',
  instructions: `Does thing ${i}`,
}));
const google = { id: 'google', name: 'Google', connection_type: 'oauth' };
const INSTALLED = [
  { name: 'gmail-plugin', displayName: 'Gmail', tools: [tool('gmail-api', 'google')] },
  { name: 'google-sheets-plugin', displayName: 'Google Sheets', tools: [tool('sheets', 'google')] },
  { name: 'figma-bridge', displayName: 'Figma Bridge', tools: [tool('figma-send'), tool('figma-read')] },
];

function mountPage(opts = {}) {
  return mount(FocusedConnectors, {
    ...opts,
    props: { item: null },
    global: { provide: { focusedNav: nav }, stubs: { FocusedConnectorLogo: true, FocusedConnection: true } },
  });
}
const tabLabels = (w) => w.findAll('.focused-tab').map((t) => [t.text(), t.classes('active')]);
const cardTexts = (w) => w.findAll('.focused-connector-card').map((c) => c.text());

beforeEach(() => {
  vi.clearAllMocks();
  state.appAuth.allProviders = catalogue;
  state.appAuth.connectionHealth = null;
  getters['appAuth/connectedApps'] = [];
  getters['apps/installed'] = [];
});

describe('Focused Apps', () => {
  it('is titled Apps, with Yours and Discover, and never says plugin or connector', () => {
    const w = mountPage();
    expect(w.find('h1').text()).toBe('Apps');
    expect(w.findAll('.focused-tab').map((t) => t.text())).toEqual(['Yours', 'Discover']);
    expect(w.text()).not.toMatch(/plugin|connector/i);
    w.unmount();
  });

  it('one sign-in is one card, listing every app it turns on', () => {
    state.appAuth.allProviders = [google, ...catalogue];
    getters['apps/installed'] = INSTALLED;
    getters['appAuth/connectedApps'] = ['google'];
    const w = mountPage();
    expect(tabLabels(w)[0]).toEqual(['Yours', true]);
    const texts = cardTexts(w);
    expect(texts.filter((t) => t.includes('Gmail'))).toHaveLength(1);
    const card = texts.find((t) => t.startsWith('Google'));
    expect(card).toContain('Gmail, Google Sheets');
    expect(card).toContain('2 apps · Ready');
    // An app with no sign-in is its own ready card.
    expect(texts.find((t) => t.startsWith('Figma Bridge'))).toContain('2 tools · Ready');
    w.unmount();
  });

  it('says what needs you: a missing sign-in, and one that stopped working', () => {
    state.appAuth.allProviders = [google, { id: 'shopify', name: 'Shopify', connection_type: 'apikey' }];
    getters['apps/installed'] = [...INSTALLED, { name: 'shopify-plugin', displayName: 'Shopify', tools: [tool('shopify', 'shopify')] }];
    getters['appAuth/connectedApps'] = ['google'];
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'error' }] };
    const w = mountPage();
    expect(w.find('.focused-apps-attention').text()).toBe('1 sign-in stopped working · 1 app needs a sign-in');
    // Needing you sorts first.
    expect(cardTexts(w)[0]).toContain('Google');
    expect(w.findAll('.focused-connector-state')[0].classes()).toContain('warn');
    w.unmount();
  });

  it('a card opens its own page, by sign-in or by app', async () => {
    state.appAuth.allProviders = [google];
    getters['apps/installed'] = INSTALLED;
    getters['appAuth/connectedApps'] = ['google'];
    const w = mountPage();
    const cards = w.findAll('.focused-connector-card');
    await cards.find((c) => c.text().startsWith('Figma')).trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'app:figma-bridge' });
    await cards.find((c) => c.text().startsWith('Google')).trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'google' });
    w.unmount();
  });

  it('opens on Discover when nothing is yours, capped with Show all', async () => {
    const w = mountPage();
    expect(tabLabels(w)).toEqual([['Yours', false], ['Discover', true]]);
    expect(w.findAll('.focused-connector-card')).toHaveLength(12);
    expect(w.find('.focused-market-section-head .focused-count').text()).toBe('15');
    await w.find('.focused-market-section-head .focused-link').trigger('click');
    expect(w.findAll('.focused-connector-card')).toHaveLength(15);
    w.unmount();
  });

  it('Add shows every service to pick from, here, never the chat', async () => {
    getters['appAuth/connectedApps'] = ['app03'];
    const w = mountPage({ attachTo: document.body });
    await w.find('.focused-primary').trigger('click');
    await flushPromises();
    expect(nav.ask).not.toHaveBeenCalled();
    expect(tabLabels(w)[1]).toEqual(['Discover', true]);
    expect(w.findAll('.focused-connector-card')).toHaveLength(14); // uncapped; app03 is already yours
    expect(document.activeElement).toBe(w.find('input[type="search"]').element);
    w.unmount();
  });

  it('search finds a service by what it says, and says when nothing matches', async () => {
    const w = mountPage();
    await w.find('input[type="search"]').setValue('thing 14');
    expect(cardTexts(w)).toEqual([expect.stringContaining('App 14')]);
    await w.find('input[type="search"]').setValue('zzz');
    expect(w.text()).toContain('No apps match');
    w.unmount();
  });

  it('Yours with nothing connected points to Discover', async () => {
    const w = mountPage();
    await w.findAll('.focused-tab')[0].trigger('click');
    expect(w.text()).toContain('Nothing connected yet.');
    await w.find('.focused-empty .focused-link').trigger('click');
    expect(tabLabels(w)[1]).toEqual(['Discover', true]);
    w.unmount();
  });

  it('loads what the page needs through the stores, never the API', () => {
    const w = mountPage();
    const actions = dispatch.mock.calls.map(([name]) => name);
    expect(actions).toEqual(expect.arrayContaining(['apps/fetchInstalled', 'apps/fetchAvailable', 'appAuth/fetchConnectedApps']));
    w.unmount();
  });
});
