/**
 * The plugin library: three views of things you have, one way into the Forge.
 *
 * WHY THIS EXISTS
 * ---------------
 * The screen used to offer five peer tabs — Installed, Marketplace, Build
 * Plugin, Pack Studio, Publish — mixing browsing with making. Browsing is now
 * Installed / Discover / My builds; making is the Forge, opened by one
 * button; Publish is a sheet over the plugin it publishes. These tests pin
 * that shape and the publish sheet's honesty about what it checked.
 * (The update chips and consent flow are pinned in Plugins.updates.spec.js.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api', REMOTE_URL: 'http://remote' } }));
vi.mock('./PluginBuilder.vue', () => ({ default: { name: 'PluginBuilder', template: '<div class="forge-stub" />' } }));
vi.mock('./PackStudio.vue', () => ({ default: { name: 'PackStudio', template: '<div class="pack-stub" />' } }));

const store = {
  getters: {},
  state: {},
  dispatch: vi.fn().mockResolvedValue(undefined),
};
vi.mock('vuex', () => ({ useStore: () => store }));

let requested;
vi.mock('@/utils/apiFetch.js', () => ({
  apiFetch: vi.fn(async (url, options = {}) => {
    if (url.endsWith('/plugins/installed')) return { ok: true, json: async () => ({ success: true, plugins: installed }) };
    if (url.endsWith('/plugins/marketplace')) return { ok: true, json: async () => ({ success: true, plugins: marketplace }) };
    requested.push({ url, method: options.method || 'GET' });
    if (url.includes('/plugins/inspect/')) {
      return { ok: true, json: async () => ({ success: true, integrityState: 'verified', trustTier: 'community', detected: {}, valid: true }) };
    }
    if (url.includes('/plugins/update-status')) return { ok: true, json: async () => ({ success: true, status: null }) };
    return { ok: true, json: async () => ({ success: true }) };
  }),
}));

import Plugins from './Plugins.vue';

const showModal = vi.fn();
const SimpleModalStub = { name: 'SimpleModal', template: '<div />', methods: { showModal } };

let installed;
let marketplace;

function mountScreen(activeTab = 'installed') {
  store.getters['connectors/activeTab'] = activeTab;
  return mount(Plugins, {
    global: {
      stubs: { SimpleModal: SimpleModalStub, Teleport: true, SvgIcon: true, Tooltip: true },
      directives: { tooltip: {} },
    },
  });
}

const buttonByText = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text));
const dispatched = (action) => store.dispatch.mock.calls.filter(([name]) => name === action).map(([, payload]) => payload);

beforeEach(() => {
  installed = [
    { name: 'weather', version: '1.4.0', description: 'w', tools: [{ type: 'weather-now' }] },
    { name: 'notion-sync', version: '0.4.0', description: 'Notion pages', tools: [{ type: 'notion-search' }, { type: 'notion-page' }] },
  ];
  marketplace = [
    { name: 'slack', version: '2.1.0', description: 'Slack messages', category: 'communication' },
    { name: 'sheets', version: '1.0.0', description: 'Sheets', category: 'data' },
  ];
  // Nothing on this screen may reach the network unauthenticated.
  global.fetch = vi.fn(async () => {
    throw new Error('unexpected bare fetch');
  });

  requested = [];
  store.state = {
    marketplace: { myPublishedItems: [] },
    pluginBuilder: { builtPluginNames: ['notion-sync'], generatedManifest: null },
  };
  store.getters = {
    'connectors/activeTab': 'installed',
    'connectors/selectedPlugin': null,
    'connectors/refreshTrigger': 0,
    'userAuth/stripeConnected': false,
    'marketplace/filteredMarketplaceItems': [{ asset_type: 'plugin', asset_id: 'x' }],
    'pluginBuilder/hasUninstalledWork': false,
    'pluginBuilder/testResultFor': () => null,
  };
  store.dispatch.mockClear();
  showModal.mockReset().mockResolvedValue(true);
  localStorage.clear();
});

describe('one library, three views', () => {
  it('offers Installed, Discover and My builds — and nothing that makes things', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.findAll('.tab').map((t) => t.text().replace(/\s+\d+$/, ''))).toEqual(['Installed', 'Discover', 'My builds']);
    expect(wrapper.text()).not.toMatch(/Pack Studio|Build Plugin/);
  });

  it('has exactly one title, not three stacked headers', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(wrapper.findAll('h2')).toHaveLength(1);
    expect(wrapper.find('.library-title').text()).toBe('Plugin Forge');
    expect(wrapper.text()).not.toContain('Plugin Manager');
  });

  it('turns manual install into a button instead of a collapsible panel', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(buttonByText(wrapper, 'Install file').exists()).toBe(true);
    expect(wrapper.find('.manual-install-section').exists()).toBe(false);
  });

  it('My builds holds what you built in the Forge, not everything installed', async () => {
    const wrapper = mountScreen('mine');
    await flushPromises();

    const names = wrapper.findAll('.plugin-name').map((n) => n.text());
    expect(names).toEqual(['Notion Sync']);
  });

  it('My builds also shows an unfinished draft first', async () => {
    store.state.pluginBuilder.generatedManifest = { name: 'todo-sync', tools: [] };
    store.getters['pluginBuilder/hasUninstalledWork'] = true;

    const wrapper = mountScreen('mine');
    await flushPromises();

    expect(wrapper.find('.draft-card .plugin-name').text()).toBe('Todo Sync');
    expect(wrapper.findAll('.tab')[2].text()).toContain('2');
  });

  it('Discover filters by the categories the data actually has', async () => {
    const wrapper = mountScreen('marketplace');
    await flushPromises();
    await buttonByText(wrapper, 'data').trigger('click');

    expect(wrapper.findAll('.plugin-name').map((n) => n.text())).toEqual(['Sheets']);
  });

  it('Discover installs through the disclosure flow, never directly', async () => {
    const wrapper = mountScreen('marketplace');
    await flushPromises();
    // Cards sort by display name, so address the card by name, never position.
    const slack = wrapper.findAll('.plugin-card').find((card) => card.find('.plugin-name').text() === 'Slack');
    await buttonByText(slack, 'Install').trigger('click');
    await flushPromises();

    const order = requested.map((r) => r.url.replace('http://localhost:3333/api', ''));
    expect(order.indexOf('/plugins/inspect/slack')).toBeGreaterThan(-1);
    expect(order.indexOf('/plugins/inspect/slack')).toBeLessThan(order.indexOf('/plugins/install'));
  });
});

describe('into the Forge', () => {
  it('New plugin opens the Forge', async () => {
    const wrapper = mountScreen();
    await flushPromises();
    await buttonByText(wrapper, 'New plugin').trigger('click');
    await flushPromises();

    expect(dispatched('connectors/setActiveTab')).toContain('builder');
    expect(showModal).not.toHaveBeenCalled();
  });

  it('New plugin offers an unfinished draft back instead of dropping it', async () => {
    store.state.pluginBuilder.generatedManifest = { name: 'todo-sync', tools: [] };
    store.getters['pluginBuilder/hasUninstalledWork'] = true;
    showModal.mockResolvedValue(false); // "Continue draft"

    const wrapper = mountScreen();
    await flushPromises();
    await buttonByText(wrapper, 'New plugin').trigger('click');
    await flushPromises();

    expect(showModal.mock.calls[0][0].message).toContain('Todo Sync');
    expect(dispatched('pluginBuilder/resetAll')).toHaveLength(0);
    expect(dispatched('connectors/setActiveTab')).toContain('builder');
  });

  it('a saved "publish" tab from the old layout lands on the library', async () => {
    mountScreen('publish');
    await flushPromises();

    expect(dispatched('connectors/setActiveTab')).toContain('installed');
  });

  it('renders the Forge full-height with no library chrome around it', async () => {
    const wrapper = mountScreen('builder');
    await flushPromises();

    expect(wrapper.find('.forge-stub').exists()).toBe(true);
    expect(wrapper.find('.plugins-container').classes()).toContain('is-forge');
    expect(wrapper.find('.tabs').exists()).toBe(false);
  });
});

describe('the publish sheet', () => {
  async function openPublishFor(wrapper, name) {
    const card = wrapper.findAll('.plugin-card.installed').find((c) => c.find('.plugin-name').text() === name);
    await card.find('.card-menu-btn').trigger('click');
    await buttonByText(card, 'Publish').trigger('click');
    await flushPromises();
  }

  it('opens over the plugin from its card menu, pre-filled', async () => {
    const wrapper = mountScreen();
    await flushPromises();
    await openPublishFor(wrapper, 'Notion Sync');

    expect(wrapper.find('.publish-sheet').exists()).toBe(true);
    expect(wrapper.find('.publish-sheet textarea').element.value).toBe('Notion pages');
  });

  it('says plainly when tools were not tested, without blocking', async () => {
    const wrapper = mountScreen();
    await flushPromises();
    await openPublishFor(wrapper, 'Notion Sync');

    expect(wrapper.find('.checklist').text()).toContain('Tools not tested this session');
    expect(buttonByText(wrapper.find('.publish-sheet'), 'Publish v0.4.0').attributes('disabled')).toBeUndefined();
  });

  it('reports test results it actually has', async () => {
    store.getters['pluginBuilder/testResultFor'] = (plugin, tool) => (tool === 'notion-search' ? { ok: true } : { ok: false });

    const wrapper = mountScreen();
    await flushPromises();
    await openPublishFor(wrapper, 'Notion Sync');

    expect(wrapper.find('.checklist').text()).toContain('1 of 2 tools passed in Test');
  });

  it('blocks a paid listing until payments are set up', async () => {
    const wrapper = mountScreen();
    await flushPromises();
    await openPublishFor(wrapper, 'Notion Sync');
    await buttonByText(wrapper.find('.publish-sheet'), 'Paid').trigger('click');
    await wrapper.find('.publish-sheet input[type="number"]').setValue('9.99');

    expect(wrapper.find('.checklist').text()).toContain('Set up Stripe payments');
    expect(buttonByText(wrapper.find('.publish-sheet'), 'Publish v0.4.0').attributes('disabled')).toBeDefined();
  });

  it('closes on Escape', async () => {
    const wrapper = mountScreen();
    await flushPromises();
    await openPublishFor(wrapper, 'Notion Sync');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(wrapper.find('.publish-sheet').exists()).toBe(false);
    wrapper.unmount();
  });
});
