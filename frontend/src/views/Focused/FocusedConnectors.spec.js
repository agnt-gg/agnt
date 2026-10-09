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
// The provider editor is Studio's Connectors screen, embedded; its own spec covers it.
vi.mock('@/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue', () => ({
  __esModule: true,
  default: { name: 'IntegrationsStub', props: { embedded: Boolean }, template: '<div class="integrations-stub">{{ embedded ? "embedded" : "" }}</div>' },
}));
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
function mountPage(item = null, tab = '') {
  wrapper = mount(FocusedConnectors, {
    props: { item, tab },
    global: { provide: { focusedNav: nav }, stubs: { SvgIcon: true, SimpleModal: modalStub, FocusedConnectorLogo: true } },
  });
  // Follow the same route-prop contract as FocusedShell without mocking the browser itself.
  nav.go.mockImplementation((location) => location.page === 'connectors' ? wrapper.setProps({ item: location.item || null, tab: location.tab || '' }) : undefined);
  return wrapper;
}
const tabButton = (id) => wrapper.find(`[data-tab="${id}"]`);
const detail = () => wrapper.find('.ap-detail');
async function openListing(name) {
  await flushPromises();
  await tabButton('browse').trigger('click');
  await wrapper.find(`[data-listing="${name}"] .ap-row-open`).trigger('click');
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

describe('Focused shared Plugins page', () => {
  it('mounts the same page as Studio, with every Market package including no-auth ones', async () => {
    mountPage(); await flushPromises();
    expect(wrapper.findComponent(AppsSection).exists()).toBe(true);
    expect(wrapper.findAll('[data-tab]').map((t) => t.attributes('data-tab'))).toEqual(['installed', 'browse', 'accounts', 'mine']);
    await tabButton('browse').trigger('click');
    expect(wrapper.findAll('[data-listing]')).toHaveLength(3);
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
  });
  it('Installed shows what you have; Browse search finds what you do not', async () => {
    getters['apps/installed'] = [gmail]; mountPage(); await flushPromises();
    expect(wrapper.findAll('[data-card]').map((c) => c.attributes('data-card'))).toEqual(['google']);
    expect(wrapper.find('[data-card="google"]').text()).toContain('Gmail');
    await tabButton('browse').trigger('click');
    await wrapper.find('input[type="search"]').setValue('research');
    expect(wrapper.findAll('[data-listing]').map((r) => r.attributes('data-listing'))).toEqual(['research']);
  });
  it('selecting a plugin creates a deep link and shows every kind of content', async () => {
    mountPage(); await openListing('research');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'app:research' });
    expect(detail().findAll('[data-group]')).toHaveLength(5);
    expect(detail().find('.ap-detail-name').text()).toBe('Research');
    expect(nav.studio).not.toHaveBeenCalled();
    await wrapper.find('[data-action="back"]').trigger('click'); await flushPromises();
    expect(wrapper.find('.ap-detail').exists()).toBe(false);
    expect(wrapper.findAll('[data-listing]')).toHaveLength(3);
  });
  it('opens direct and browser-back plugin links, including packages loaded after mount', async () => {
    getters['apps/available'] = []; mountPage('app:research'); await flushPromises();
    expect(wrapper.text()).toContain('This plugin isn’t available');
    getters['apps/available'] = [pack, gmail]; await flushPromises();
    expect(detail().find('.ap-detail-name').text()).toBe('Research');
    await wrapper.setProps({ item: 'app:gmail-plugin' }); await flushPromises();
    expect(detail().find('.ap-detail-name').text()).toBe('Gmail');
    await wrapper.setProps({ item: null }); await flushPromises();
    expect(wrapper.find('.ap-detail').exists()).toBe(false);
  });
  it('uses the inspected shared install flow, including consent and refreshed installed state', async () => {
    mountPage('app:research'); await flushPromises();
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/plugins/inspect/research'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('full access') }));
    expect(dispatch.mock.calls.filter(([a]) => a === 'marketplace/installPlugin')).toEqual([['marketplace/installPlugin', { pluginName: 'research' }]]);
    expect(wrapper.text()).toContain('Research installed.');
    expect(nav.studio).not.toHaveBeenCalled();
  });
  it('cancelled installation never invokes the installer', async () => {
    confirm.mockResolvedValue(false); mountPage('app:research'); await flushPromises();
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it('Connect opens the existing account page and Back returns to the same plugin and search', async () => {
    mountPage(); await flushPromises();
    await tabButton('browse').trigger('click');
    await wrapper.find('input[type="search"]').setValue('gmail');
    await wrapper.find('[data-listing="gmail-plugin"] .ap-row-open').trigger('click'); await flushPromises();
    const sharedElement = wrapper.findComponent(AppsSection).element;
    await detail().find('[data-section="sign-in"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'google' });
    expect(wrapper.findComponent(FocusedConnection).props()).toMatchObject({ cardId: 'google', returnItem: 'app:gmail-plugin' });
    expect(wrapper.findComponent(AppsSection).element).toBe(sharedElement);
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(detail().find('.ap-detail-name').text()).toBe('Gmail');
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    await wrapper.find('[data-action="back"]').trigger('click'); await flushPromises();
    expect(wrapper.find('input[type="search"]').element.value).toBe('gmail');
    expect(wrapper.findAll('[data-listing]')).toHaveLength(1);
  });
  it('Reconnect preserves the failing-account state and refreshes on return', async () => {
    getters['appAuth/connectedApps'] = ['google'];
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'error' }] };
    mountPage('app:gmail-plugin'); await flushPromises();
    const button = detail().find('[data-section="sign-in"] [data-action="connect"]');
    expect(button.text()).toBe('Reconnect');
    await button.trigger('click'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).text()).toContain('sign-in stopped working');
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'healthy' }] };
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(detail().find('[data-section="sign-in"] .ap-connected').exists()).toBe(true);
  });
  it('legacy provider links still render setup and return to the page', async () => {
    mountPage('google'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).props('returnItem')).toBeNull();
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    expect(wrapper.findComponent(AppsSection).isVisible()).toBe(true);
  });
  it('keeps API-key setup in the existing Focused account form', async () => {
    getters['apps/available'] = [{ name: 'notion-plugin', tools: [tool('notion-api', 'notion')] }];
    mountPage('app:notion-plugin'); await flushPromises();
    await detail().find('[data-section="sign-in"] [data-action="connect"]').trigger('click'); await flushPromises();
    await wrapper.find('input[aria-label="API key"]').setValue('test-key');
    await wrapper.find('form').trigger('submit'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/saveApiKey', { providerId: 'notion', apiKey: 'test-key' });
  });
  it('model credentials still belong to Focused Settings', async () => {
    state.appAuth.allProviders.push({ id: 'openrouter', name: 'OpenRouter', connection_type: 'apikey' });
    getters['apps/available'] = [{ name: 'video', tools: [tool('video-generate', 'openrouter')] }];
    mountPage('app:video'); await flushPromises();
    await detail().find('[data-section="sign-in"] [data-action="ai-models"]').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'settings' });
    expect(nav.studio).not.toHaveBeenCalled();
  });
  it('installed widgets open in Focused Library; the Forge explicitly uses Studio', async () => {
    getters['apps/installed'] = [pack]; getters['widgetDefinitions/allDefinitions'] = [{ id: 'w1' }];
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, assets: [{ asset_type: 'widget', asset_slug: 'board', local_id: 'w1' }] }) });
    mountPage('app:research'); await flushPromises();
    await detail().find('[data-group="widgets"] [data-action="open-widget"]').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'library', tab: 'widgets', item: 'w1' });
    await detail().find('[data-action="open-forge"]').trigger('click');
    expect(nav.studio).toHaveBeenLastCalledWith('PluginsScreen', { select: { kind: 'plugin', id: 'research' } });
  });
  it('Build opens the Forge in Studio on the chosen view', async () => {
    mountPage(); await flushPromises();
    await wrapper.find('[data-action="build"]').trigger('click');
    await wrapper.find('.ap-menu [data-forge="builder"]').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('connectors/setActiveTab', 'builder');
    expect(nav.studio).toHaveBeenLastCalledWith('PluginsScreen');
  });
});

describe('Focused Accounts & keys', () => {
  it('the Accounts tab is the route’s vault tab, both ways', async () => {
    mountPage(); await flushPromises();
    await tabButton('accounts').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', tab: 'vault' });
    expect(tabButton('accounts').attributes('aria-selected')).toBe('true');
    await tabButton('installed').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors' });
    expect(tabButton('installed').attributes('aria-selected')).toBe('true');
  });
  it('a vault deep link opens Accounts & keys; Connect and Sign out go to the account page', async () => {
    getters['apps/installed'] = [gmail]; getters['appAuth/connectedApps'] = ['google'];
    mountPage(null, 'vault'); await flushPromises();
    expect(tabButton('accounts').attributes('aria-selected')).toBe('true');
    await wrapper.find('[data-service="notion"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'notion' });
    expect(wrapper.findComponent(FocusedConnection).props()).toMatchObject({ cardId: 'notion', returnTab: 'vault' });
    // Back returns to the tab the sign-in started from.
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', tab: 'vault' });
    expect(tabButton('accounts').attributes('aria-selected')).toBe('true');
    await wrapper.find('[data-account="google"] .ap-row-open').trigger('click'); await flushPromises();
    await detail().find('[data-action="disconnect"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'google' });
  });
  it('Edit integrations opens the embedded provider editor, and Back returns to Accounts & keys', async () => {
    mountPage(null, 'vault'); await flushPromises();
    await wrapper.find('[data-action="integrations"]').trigger('click'); await flushPromises();
    expect(wrapper.find('.integrations-stub').text()).toBe('embedded');
    expect(wrapper.findComponent(AppsSection).isVisible()).toBe(false);
    await wrapper.find('.focused-integrations .focused-page-back').trigger('click'); await flushPromises();
    expect(wrapper.find('.integrations-stub').exists()).toBe(false);
    expect(tabButton('accounts').attributes('aria-selected')).toBe('true');
  });
});
