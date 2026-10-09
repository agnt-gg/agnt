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
  wrapper = shallowMount(Connectors, { props, global: { plugins: [store], stubs: { BaseScreen: { template: '<div><slot /></div>' }, AppsSection: { name: 'AppsSection', props: ['selectedPlugin'], template: '<div class="catalog" />' } } } });
  return wrapper;
}
beforeEach(() => { route.query = {}; clearInnerSection(); });
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); clearInnerSection(); });

describe('Studio canonical plugin catalog', () => {
  it('renders every Vault connection in embedded mode without the Studio shell or category bar', async () => {
    setInnerSection('apps'); route.query = { section: 'apps' };
    mountCatalog({ embedded: true }); await flushPromises();
    expect(wrapper.find('.embedded-vault').exists()).toBe(true);
    expect(wrapper.find('.vault-content').exists()).toBe(true);
    expect(wrapper.find('.content-title').text()).toBe('Vault');
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
    route.query = { section: 'oauth' }; await flushPromises();
    expect(activeInnerSection.value).toBe('oauth');
    expect(wrapper.find('.catalog').exists()).toBe(false);
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
});
