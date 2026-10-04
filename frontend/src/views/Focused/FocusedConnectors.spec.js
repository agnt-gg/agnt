import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const dispatch = vi.fn(() => Promise.resolve());
const state = reactive({ appAuth: { allProviders: [] } });
const getters = reactive({ 'appAuth/connectedApps': [] });
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }) }));
import FocusedConnectors from './FocusedConnectors.vue';

const nav = { go: vi.fn(), ask: vi.fn(), studio: vi.fn(), toast: vi.fn(), confirm: vi.fn() };
// The remote catalogue's real shape: snake_case, categories as a JSON string.
const catalogue = Array.from({ length: 15 }, (_, i) => ({
  id: `app${String(i).padStart(2, '0')}`,
  name: `App ${String(i).padStart(2, '0')}`,
  connection_type: 'oauth',
  categories: '["productivity"]',
  instructions: `Does thing ${i}`,
}));
function mountPage(opts = {}) {
  return mount(FocusedConnectors, {
    ...opts,
    props: { item: null },
    global: { provide: { focusedNav: nav }, stubs: { FocusedConnectorLogo: true, FocusedConnection: true } },
  });
}
const tabLabels = (w) => w.findAll('.focused-tab').map((t) => [t.text(), t.classes('active')]);

beforeEach(() => {
  vi.clearAllMocks();
  state.appAuth.allProviders = catalogue;
  getters['appAuth/connectedApps'] = [];
});

describe('Focused Connectors', () => {
  it('is titled Connectors, with Yours and Discover', () => {
    const w = mountPage();
    expect(w.find('h1').text()).toBe('Connectors');
    expect(w.findAll('.focused-tab').map((t) => t.text())).toEqual(['Yours', 'Discover']);
    expect(w.text()).not.toMatch(/plugin/i);
    w.unmount();
  });

  it('opens on Discover when nothing is connected, capped with Show all', async () => {
    const w = mountPage();
    expect(tabLabels(w)).toEqual([['Yours', false], ['Discover', true]]);
    expect(w.findAll('.focused-connector-card')).toHaveLength(12);
    expect(w.find('.focused-market-section-head .focused-count').text()).toBe('15');
    await w.find('.focused-market-section-head .focused-link').trigger('click');
    expect(w.findAll('.focused-connector-card')).toHaveLength(15);
    expect(w.find('.focused-market-section-head .focused-link').exists()).toBe(false);
    w.unmount();
  });

  it('opens on Yours when something is connected, and marks it', async () => {
    getters['appAuth/connectedApps'] = ['app03'];
    const w = mountPage();
    expect(tabLabels(w)).toEqual([['Yours', true], ['Discover', false]]);
    const cards = w.findAll('.focused-connector-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain('App 03');
    expect(cards[0].text()).toContain('Productivity · Connected');
    expect(cards[0].find('.focused-connector-state').classes()).toContain('ok');
    await w.findAll('.focused-tab')[1].trigger('click');
    const states = w.findAll('.focused-connector-state');
    // Discover lists connected first, then everything else with a +.
    expect(states[0].classes()).toContain('ok');
    expect(states[1].find('i').classes()).toContain('fa-plus');
    expect(w.findAll('.focused-connector-card')[1].text()).toContain('Productivity · Sign in');
    w.unmount();
  });

  it('a card opens its connection page', async () => {
    const w = mountPage();
    await w.find('.focused-connector-card').trigger('click');
    expect(nav.go).toHaveBeenCalledWith({ page: 'connectors', item: 'app00' });
    w.unmount();
  });

  it('Add shows every connector to pick from, here, never the chat', async () => {
    getters['appAuth/connectedApps'] = ['app03'];
    const w = mountPage({ attachTo: document.body });
    await w.find('.focused-primary').trigger('click');
    await flushPromises();
    expect(nav.ask).not.toHaveBeenCalled();
    expect(tabLabels(w)[1]).toEqual(['Discover', true]);
    expect(w.findAll('.focused-connector-card')).toHaveLength(15); // uncapped
    expect(document.activeElement).toBe(w.find('input[type="search"]').element);
    w.unmount();
  });

  it('search lifts the cap and says when nothing matches', async () => {
    const w = mountPage();
    await w.find('input[type="search"]').setValue('thing 14');
    expect(w.findAll('.focused-connector-card').map((c) => c.text())).toEqual([expect.stringContaining('App 14')]);
    await w.find('input[type="search"]').setValue('zzz');
    expect(w.text()).toContain('No connectors match');
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
});
