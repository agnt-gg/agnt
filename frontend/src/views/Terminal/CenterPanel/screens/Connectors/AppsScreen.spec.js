// The Plugins page (/plugins): One's Apps page in Studio, the full Connectors screen inside One.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, inject, reactive } from 'vue';

const route = reactive({ path: '/plugins', fullPath: '/plugins', query: {}, meta: { terminalScreen: 'ConnectorsScreen' } });
const router = { push: vi.fn(() => Promise.resolve()), replace: vi.fn(() => Promise.resolve()) };
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));

let seenNav = null;
vi.mock('@/views/Terminal/CenterPanel/BaseScreen.vue', () => ({
  default: defineComponent({ name: 'BaseScreen', props: ['screenId', 'activeLeftPanel', 'activeRightPanel'], setup: (_, { slots }) => () => h('div', { class: 'base-stub' }, slots.default?.()) }),
}));
vi.mock('@/views/_components/common/SimpleModal.vue', () => ({ default: defineComponent({ name: 'SimpleModal', render: () => null }) }));
vi.mock('@/views/Focused/FocusedConnectors.vue', () => ({
  default: defineComponent({ name: 'FocusedConnectors', props: ['item', 'tab'], setup() { seenNav = inject('focusedNav', null); return () => h('div', { class: 'apps-stub' }); } }),
}));
vi.mock('./Connectors.vue', () => ({ default: defineComponent({ name: 'Connectors', render: () => h('div', { class: 'connectors-stub' }) }) }));

import AppsScreen from './AppsScreen.vue';

function at(path, query = {}, screen = 'ConnectorsScreen') {
  const search = new URLSearchParams(query).toString();
  Object.assign(route, { path, query, fullPath: search ? `${path}?${search}` : path, meta: { terminalScreen: screen } });
}
const mountScreen = (provide = {}) => mount(AppsScreen, { global: { provide } });

describe('the Plugins page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenNav = null;
    at('/plugins');
  });

  it('in Studio is the Apps page One shows, with no side panels', () => {
    const w = mountScreen();
    expect(w.find('.apps-stub').exists()).toBe(true);
    expect(w.find('.connectors-stub').exists()).toBe(false);
    const base = w.findComponent({ name: 'BaseScreen' });
    expect(base.props()).toMatchObject({ screenId: 'ConnectorsScreen', activeLeftPanel: false, activeRightPanel: false });
    expect(w.findComponent({ name: 'FocusedConnectors' }).props()).toMatchObject({ item: null, tab: '' });
  });

  it('opens the section and the plugin the route names, and follows the route', async () => {
    at('/plugins', { section: 'plugins' });
    const w = mountScreen();
    expect(w.findComponent({ name: 'FocusedConnectors' }).props('tab')).toBe('plugins');
    at('/plugins', { select: 'plugin:figma-bridge' });
    await flushPromises();
    expect(w.findComponent({ name: 'FocusedConnectors' }).props()).toMatchObject({ item: 'app:figma-bridge', tab: '' });
  });

  it('keeps its place while another screen shows (Terminal keeps it alive)', async () => {
    at('/plugins', { section: 'mcp-servers' });
    const w = mountScreen();
    at('/agents', { select: 'agent:a1' }, 'AgentsScreen');
    await flushPromises();
    expect(w.findComponent({ name: 'FocusedConnectors' }).props('tab')).toBe('mcp');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('moves by route, and asks for full editors with ?studio=1', () => {
    mountScreen();
    seenNav.go({ page: 'connectors', tab: 'plugins' });
    expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/plugins', query: expect.objectContaining({ section: 'plugins' }) }));
    seenNav.studio('PluginsScreen');
    expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/plugin-forge', query: expect.objectContaining({ studio: '1' }) }));
  });

  it('?studio=1 shows the full Connectors screen', () => {
    at('/plugins', { section: 'oauth', studio: '1' });
    const w = mountScreen();
    expect(w.find('.connectors-stub').exists()).toBe(true);
    expect(w.find('.apps-stub').exists()).toBe(false);
  });

  it('inside One it is the full Connectors screen and leaves One\u2019s frame service alone', () => {
    const oneNav = { go: vi.fn() };
    const w = mountScreen({ focusedNav: oneNav });
    expect(w.find('.connectors-stub').exists()).toBe(true);
    expect(w.find('.apps-stub').exists()).toBe(false);
  });

  it('an old AI-models link goes to Settings, as in One', async () => {
    at('/plugins', { section: 'providers' });
    mountScreen();
    await flushPromises();
    expect(router.replace).toHaveBeenCalledWith(expect.objectContaining({ path: '/settings' }));
  });
});
