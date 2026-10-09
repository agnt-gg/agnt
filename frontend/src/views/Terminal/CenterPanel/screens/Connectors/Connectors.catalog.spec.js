import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import { createStore } from 'vuex';
import Connectors from './Connectors.vue';
import { activeInnerSection, setInnerSection, clearInnerSection } from '@/canvas/innerSection.js';

const route = reactive({ query: {} });
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
let wrapper;
function mountCatalog(props = {}) {
  const store = createStore({ modules: {
    appAuth: { namespaced: true, state: () => ({ allProviders: [], connectedApps: [], connectionHealth: null }) },
    mcpServers: { namespaced: true, state: () => ({ servers: [], loading: false }), getters: { allServers: () => [] } },
    connectors: { namespaced: true, getters: { allSecrets: () => [] } },
  } });
  vi.spyOn(store, 'dispatch').mockResolvedValue([]);
  wrapper = shallowMount(Connectors, { props, global: { plugins: [store], stubs: { BaseScreen: { template: '<div><slot /></div>' }, AppsSection: { name: 'AppsSection', props: ['selectedPlugin', 'vaultActive'], template: '<div class="catalog" />' } } } });
  return wrapper;
}
beforeEach(() => { route.query = {}; clearInnerSection(); });
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); clearInnerSection(); });

describe('Studio canonical plugin catalog', () => {
  it('renders every integration in embedded mode without the Studio shell or category bar', async () => {
    setInnerSection('apps'); route.query = { section: 'apps' };
    mountCatalog({ embedded: true }); await flushPromises();
    expect(wrapper.find('.embedded-vault').exists()).toBe(true);
    expect(wrapper.find('.vault-content').exists()).toBe(true);
    expect(wrapper.find('.content-title').text()).toBe('Integrations');
    expect(wrapper.find('.catalog').exists()).toBe(false);
    expect(wrapper.find('.category-filter-bar').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'BaseScreen' }).exists()).toBe(false);
    expect(activeInnerSection.value).toBe('apps');
  });
  it('opens a plugin deep link even if a different section was previously active', async () => {
    setInnerSection('oauth'); route.query = { select: 'plugin:proofkit' };
    mountCatalog(); await flushPromises();
    expect(wrapper.findComponent({ name: 'AppsSection' }).props('selectedPlugin')).toBe('proofkit');
    expect(activeInnerSection.value).toBe('apps');
  });
  it('reads old app selection links and follows same-screen browser navigation', async () => {
    route.query = { select: 'app:proofkit' }; mountCatalog(); await flushPromises();
    expect(wrapper.findComponent({ name: 'AppsSection' }).props('selectedPlugin')).toBe('proofkit');
    // The old Vault link opens the same Plugins page on its Accounts & keys tab.
    route.query = { section: 'oauth' }; await flushPromises();
    expect(activeInnerSection.value).toBe('oauth');
    expect(wrapper.findComponent({ name: 'AppsSection' }).props('vaultActive')).toBe(true);
    expect(wrapper.find('.vault-content').exists()).toBe(false);
    route.query = {}; await flushPromises();
    expect(activeInnerSection.value).toBe('apps');
    expect(wrapper.findComponent({ name: 'AppsSection' }).props('selectedPlugin')).toBeNull();
  });
  it('emits canonical plugin selections and clears them on Back', async () => {
    mountCatalog(); await flushPromises();
    wrapper.findComponent({ name: 'AppsSection' }).vm.$emit('select-app', 'proofkit');
    expect(wrapper.emitted('screen-change').at(-1)).toEqual(['ConnectorsScreen', { section: 'apps', select: { kind: 'plugin', id: 'proofkit' } }]);
    route.query = { select: 'plugin:proofkit' }; await flushPromises();
    wrapper.findComponent({ name: 'AppsSection' }).vm.$emit('close-app');
    expect(wrapper.emitted('screen-change').at(-1)).toEqual(['ConnectorsScreen', { section: 'apps' }]);
  });
  it('page tabs and links navigate through the route like sidebar rows', async () => {
    mountCatalog(); await flushPromises();
    const page = wrapper.findComponent({ name: 'AppsSection' });
    for (const [event, section] of [['open-vault', 'oauth'], ['open-plugins', 'apps'], ['open-integrations', 'integrations']]) {
      page.vm.$emit(event);
      expect(wrapper.emitted('screen-change').at(-1)).toEqual(['ConnectorsScreen', { section }]);
    }
    page.vm.$emit('open-section', 'webhooks');
    expect(wrapper.emitted('screen-change').at(-1)).toEqual(['ConnectorsScreen', { section: 'webhooks' }]);
    page.vm.$emit('open-ai-models');
    expect(wrapper.emitted('screen-change').at(-1)).toEqual(['SettingsScreen', { section: 'providers' }]);
  });
  it('the provider editor lives at section=integrations, highlighted under Accounts & keys, and Back returns there', async () => {
    route.query = { section: 'integrations' }; mountCatalog(); await flushPromises();
    expect(wrapper.find('.vault-content .content-title').text()).toBe('Integrations');
    expect(wrapper.find('.catalog').exists()).toBe(false);
    await wrapper.find('.vault-back').trigger('click');
    expect(wrapper.emitted('screen-change').at(-1)).toEqual(['ConnectorsScreen', { section: 'oauth' }]);
  });
});
