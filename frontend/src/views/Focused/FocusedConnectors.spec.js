import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, defineComponent } from 'vue';
import { apiFetch } from '@/utils/apiFetch.js';
import AppsSection from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue';
import FocusedConnectors from './FocusedConnectors.vue';
import FocusedConnection from './FocusedConnection.vue';

const dispatch = vi.fn(() => Promise.resolve());
const state = reactive({ appAuth: { allProviders: [], connectionHealth: null }, apps: { installedAt: 1 } });
const getters = reactive({
  'appAuth/connectedApps': [], 'apps/installed': [], 'apps/available': [],
  'widgetDefinitions/allDefinitions': [], 'skills/allSkills': [],
});
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }) }));
vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: vi.fn() }));
const confirm = vi.fn();
const modalStub = defineComponent({ setup(_, { expose }) { expose({ showModal: confirm }); return () => null; } });
const nav = { go: vi.fn(), ask: vi.fn(), studio: vi.fn(), toast: vi.fn(), confirm: vi.fn() };
const tool = (type, authProvider) => ({ type, schema: { title: type, ...(authProvider ? { authProvider } : {}) } });
const gmail = { name: 'gmail-plugin', displayName: 'Gmail', category: 'productivity', tools: [tool('gmail-api', 'google')] };
const pack = {
  name: 'research', displayName: 'Research', category: 'research',
  agents: [{ slug: 'researcher' }], tools: [tool('research-search')], widgets: [{ slug: 'board' }],
  skills: [{ slug: 'source-check' }], workflows: [{ slug: 'digest' }],
};
let wrapper;
function mountPage(item = null) {
  wrapper = mount(FocusedConnectors, {
    props: { item },
    global: { provide: { focusedNav: nav }, stubs: { SvgIcon: true, SimpleModal: modalStub, FocusedConnectorLogo: true } },
  });
  // Follow the same route-prop contract as FocusedShell without mocking the browser itself.
  nav.go.mockImplementation((location) => location.page === 'connectors' ? wrapper.setProps({ item: location.item || null }) : undefined);
  return wrapper;
}
async function open(name) {
  await flushPromises();
  await wrapper.find(`[data-app="${name}"] .card-title`).trigger('click');
  await flushPromises();
}
beforeEach(() => {
  vi.clearAllMocks(); confirm.mockResolvedValue(true);
  state.appAuth.allProviders = [{ id: 'google', name: 'Google', connection_type: 'oauth' }, { id: 'notion', name: 'Notion', connection_type: 'apikey' }];
  state.appAuth.connectionHealth = { providers: [] };
  getters['appAuth/connectedApps'] = [];
  getters['apps/installed'] = [];
  getters['apps/available'] = [gmail, pack, { name: 'calculator', tools: [] }];
  getters['widgetDefinitions/allDefinitions'] = [];
  apiFetch.mockImplementation(async url => ({ ok: true, json: async () => url.includes('/inspect/')
    ? { success: true, valid: true, integrityState: 'verified', detected: {}, trustTier: 'community' }
    : { success: true, assets: [] } }));
  dispatch.mockImplementation(async (action, payload) => {
    if (action === 'marketplace/installPlugin') getters['apps/installed'].push({ ...getters['apps/available'].find(p => p.name === payload.pluginName) });
  });
});
afterEach(() => wrapper?.unmount());

describe('Focused shared plugin catalog', () => {
  it('mounts the same browser as Studio, showing all packages including no-auth apps', async () => {
    mountPage(); await flushPromises();
    expect(wrapper.findComponent(AppsSection).exists()).toBe(true);
    expect(wrapper.findAll('.apps-card')).toHaveLength(3);
    expect(wrapper.find('.apps-nav').text()).toContain('All plugins');
    expect(wrapper.find('.apps-nav').text()).toContain('Installed');
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
  });
  it('search and Installed filtering operate on packages, not sign-ins', async () => {
    getters['apps/installed'] = [gmail]; mountPage(); await flushPromises();
    await wrapper.find('input[type="search"]').setValue('research');
    expect(wrapper.findAll('.apps-card')).toHaveLength(1);
    await wrapper.find('input[type="search"]').setValue('');
    await wrapper.findAll('.apps-nav nav button')[1].trigger('click');
    expect(wrapper.findAll('.apps-card')).toHaveLength(1);
    expect(wrapper.find('.apps-card').text()).toContain('Gmail');
  });
  it('card selection creates a deep link and renders all five content groups', async () => {
    mountPage(); await open('research');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'app:research' });
    expect(wrapper.findAll('.asset-group')).toHaveLength(5);
    expect(wrapper.find('.detail-identity h1').text()).toBe('Research');
    expect(nav.studio).not.toHaveBeenCalled();
    await wrapper.find('.apps-back').trigger('click'); await flushPromises();
    expect(wrapper.findAll('.apps-card')).toHaveLength(3);
  });
  it('opens direct and browser-back plugin links, including packages loaded after mount', async () => {
    getters['apps/available'] = []; mountPage('app:research'); await flushPromises();
    expect(wrapper.text()).toContain('This plugin isn’t available');
    getters['apps/available'] = [pack, gmail]; await flushPromises();
    expect(wrapper.find('.detail-identity h1').text()).toBe('Research');
    await wrapper.setProps({ item: 'app:gmail-plugin' }); await flushPromises();
    expect(wrapper.find('.detail-identity h1').text()).toBe('Gmail');
    await wrapper.setProps({ item: null }); await flushPromises();
    expect(wrapper.findAll('.apps-card')).toHaveLength(2);
  });
  it('uses the inspected shared install flow, including consent and refreshed installed state', async () => {
    mountPage('app:research'); await flushPromises();
    await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/plugins/inspect/research'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('full access') }));
    expect(dispatch.mock.calls.filter(([a]) => a === 'marketplace/installPlugin')).toEqual([['marketplace/installPlugin', { pluginName: 'research' }]]);
    expect(wrapper.text()).toContain('Research installed.');
    expect(nav.studio).not.toHaveBeenCalled();
  });
  it('cancelled installation never invokes the installer', async () => {
    confirm.mockResolvedValue(false); mountPage('app:research'); await flushPromises();
    await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it('Connect opens the existing account page and Back returns to the same plugin', async () => {
    mountPage(); await flushPromises();
    await wrapper.find('input[type="search"]').setValue('gmail');
    await open('gmail-plugin');
    const sharedElement = wrapper.findComponent(AppsSection).element;
    await wrapper.find('.app-connection button').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'google' });
    expect(wrapper.findComponent(FocusedConnection).props()).toMatchObject({ cardId: 'google', returnItem: 'app:gmail-plugin' });
    expect(wrapper.findComponent(AppsSection).element).toBe(sharedElement);
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(wrapper.find('.detail-identity h1').text()).toBe('Gmail');
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    await wrapper.find('.apps-back').trigger('click'); await flushPromises();
    expect(wrapper.find('input[type="search"]').element.value).toBe('gmail');
    expect(wrapper.findAll('.apps-card')).toHaveLength(1);
  });
  it('Reconnect preserves the existing failing-account state and refreshes on return', async () => {
    getters['appAuth/connectedApps'] = ['google'];
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'error' }] };
    mountPage('app:gmail-plugin'); await flushPromises();
    expect(wrapper.find('.app-connection button').text()).toBe('Reconnect');
    await wrapper.find('.app-connection button').trigger('click'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).text()).toContain('sign-in stopped working');
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'healthy' }] };
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(wrapper.find('.app-connection .connection-check').exists()).toBe(true);
  });
  it('legacy provider links still render setup and return to the catalog', async () => {
    mountPage('google'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).props('returnItem')).toBeNull();
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(wrapper.findAll('.apps-card')).toHaveLength(3);
  });
  it('keeps API-key setup in the existing Focused account form', async () => {
    getters['apps/available'] = [{ name: 'notion-plugin', tools: [tool('notion-api', 'notion')] }];
    mountPage('app:notion-plugin'); await flushPromises();
    await wrapper.find('.app-connection button').trigger('click'); await flushPromises();
    await wrapper.find('input[aria-label="API key"]').setValue('test-key');
    await wrapper.find('form').trigger('submit'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/saveApiKey', { providerId: 'notion', apiKey: 'test-key' });
  });
  it('model credentials still belong to Focused Settings', async () => {
    state.appAuth.allProviders.push({ id: 'openrouter', name: 'OpenRouter', connection_type: 'apikey' });
    getters['apps/available'] = [{ name: 'video', tools: [tool('video-generate', 'openrouter')] }];
    mountPage('app:video'); await flushPromises();
    await wrapper.find('.app-connection button').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'settings' });
    expect(nav.studio).not.toHaveBeenCalled();
  });
  it('installed widgets open in Focused Library; advanced management explicitly uses Studio', async () => {
    getters['apps/installed'] = [pack]; getters['widgetDefinitions/allDefinitions'] = [{ id: 'w1' }];
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, assets: [{ asset_type: 'widget', asset_slug: 'board', local_id: 'w1' }] }) });
    mountPage('app:research'); await flushPromises();
    await wrapper.findAll('.asset-group')[2].find('button').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'library', tab: 'widgets', item: 'w1' });
    await wrapper.find('.hero-action button').trigger('click');
    expect(nav.studio).toHaveBeenLastCalledWith('PluginsScreen', { select: { kind: 'plugin', id: 'research' } });
  });
  it('builder and a direct Vault tab remain available', async () => {
    mountPage(); await flushPromises();
    await wrapper.findAll('.apps-nav-actions button')[0].trigger('click');
    expect(nav.studio).toHaveBeenLastCalledWith('PluginsScreen');
    await wrapper.findAll('.apps-nav nav button').find((button) => button.text() === 'Vault').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', tab: 'vault' });
  });
});
