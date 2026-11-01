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
// mapState/mapGetters: the Email & webhooks tab's components (options API) call them at import.
vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }), mapState: () => ({}), mapGetters: () => ({}), mapActions: () => ({}) }));
vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: vi.fn() }));
// The provider editor is Studio's Connectors screen, embedded; its own spec covers it.
vi.mock('@/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue', () => ({
  __esModule: true,
  default: { name: 'IntegrationsStub', props: { embedded: Boolean }, template: '<div class="integrations-stub">{{ embedded ? "embedded" : "" }}</div>' },
}));
const confirm = vi.fn();
const modalStub = defineComponent({ setup(_, { expose }) { expose({ showModal: confirm }); return () => null; } });
const nav = { go: vi.fn(), ask: vi.fn(), studio: vi.fn(), toast: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };
// The OAuth consent popup: stays open until a test closes it.
let popup;
const closePopup = async () => { popup.closed = true; await new Promise((r) => setTimeout(r, 600)); await flushPromises(); };
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
  popup = { closed: false };
  vi.spyOn(window, 'open').mockImplementation(() => popup);
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
    if (action === 'appAuth/requestOAuthUrl') return `https://idp.test/consent/${payload}`;
    if (action === 'marketplace/installPlugin') getters['apps/installed'].push({ ...getters['apps/available'].find(p => p.name === payload.pluginName) });
  });
});
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

describe('Focused shared Plugins page', () => {
  it('mounts the same page as Studio, with every Market package including no-auth ones', async () => {
    mountPage(); await flushPromises();
    expect(wrapper.findComponent(AppsSection).exists()).toBe(true);
    expect(wrapper.findAll('[data-tab]').map((t) => t.attributes('data-tab'))).toEqual(['foryou', 'installed', 'browse', 'accounts', 'triggers', 'mcp', 'mine']); // For you first; + Email & webhooks, MCP servers (AGNT One)
    await tabButton('browse').trigger('click');
    expect(wrapper.findAll('[data-listing]')).toHaveLength(3);
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
  });
  it('Installed shows what you have; Browse search finds what you do not', async () => {
    getters['apps/installed'] = [gmail]; mountPage(); await flushPromises();
    await tabButton('installed').trigger('click');
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
  // Reported 2026-10-26: Connect opened a second page with a second Connect button.
  it('Connect starts the sign-in right there: no second page, search and plugin kept', async () => {
    mountPage(); await flushPromises();
    await tabButton('browse').trigger('click');
    await wrapper.find('input[type="search"]').setValue('gmail');
    await wrapper.find('[data-listing="gmail-plugin"] .ap-row-open').trigger('click'); await flushPromises();
    nav.go.mockClear();
    await detail().find('[data-section="sign-in"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/requestOAuthUrl', 'google');
    expect(window.open).toHaveBeenCalledWith('https://idp.test/consent/google', 'oauth_google', expect.any(String));
    expect(nav.go).not.toHaveBeenCalled();
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    expect(detail().find('.ap-detail-name').text()).toBe('Gmail');
    // Closing the popup re-reads the connections, once.
    await closePopup();
    expect(dispatch.mock.calls.filter(([a]) => a === 'appAuth/refreshAfterConnect')).toHaveLength(1);
    await wrapper.find('[data-action="back"]').trigger('click'); await flushPromises();
    expect(wrapper.find('input[type="search"]').element.value).toBe('gmail');
  });
  it('Reconnect starts a fresh sign-in in place and the detail shows connected once health is re-read', async () => {
    getters['appAuth/connectedApps'] = ['google'];
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'error' }] };
    mountPage('app:gmail-plugin'); await flushPromises();
    const button = detail().find('[data-section="sign-in"] [data-action="connect"]');
    expect(button.text()).toBe('Reconnect');
    await button.trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/requestOAuthUrl', 'google');
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'healthy' }] };
    await closePopup();
    expect(dispatch).toHaveBeenCalledWith('appAuth/checkConnectionHealth');
    expect(detail().find('[data-section="sign-in"] .ap-connected').exists()).toBe(true);
  });
  it('legacy provider links still render setup and return to the page', async () => {
    mountPage('google'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).props('returnItem')).toBeNull();
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    expect(wrapper.findComponent(AppsSection).isVisible()).toBe(true);
  });
  it('an API-key sign-in asks for the key in one dialog, right there', async () => {
    getters['apps/available'] = [{ name: 'notion-plugin', tools: [tool('notion-api', 'notion')] }];
    nav.prompt.mockResolvedValue('  test-key  ');
    mountPage('app:notion-plugin'); await flushPromises();
    await detail().find('[data-section="sign-in"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(nav.prompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connect Notion', secret: true }));
    expect(dispatch).toHaveBeenCalledWith('appAuth/saveApiKey', { providerId: 'notion', apiKey: 'test-key' });
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    expect(nav.toast).toHaveBeenCalledWith('Notion connected.');
  });
  it('cancelling the key dialog saves nothing', async () => {
    getters['apps/available'] = [{ name: 'notion-plugin', tools: [tool('notion-api', 'notion')] }];
    nav.prompt.mockResolvedValue(null);
    mountPage('app:notion-plugin'); await flushPromises();
    await detail().find('[data-section="sign-in"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(dispatch.mock.calls.some(([a]) => a === 'appAuth/saveApiKey')).toBe(false);
  });
  it('a sign-in that cannot start says why instead of failing quietly', async () => {
    dispatch.mockImplementation(async (action) => { if (action === 'appAuth/requestOAuthUrl') throw new Error('502'); });
    mountPage('app:gmail-plugin'); await flushPromises();
    await detail().find('[data-section="sign-in"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(window.open).not.toHaveBeenCalled();
    expect(nav.toast).toHaveBeenCalledWith(expect.stringContaining('Couldn’t start connecting Google. 502'));
  });
  it('model credentials still belong to Focused Settings', async () => {
    state.appAuth.allProviders.push({ id: 'openrouter', name: 'OpenRouter', connection_type: 'apikey' });
    getters['apps/available'] = [{ name: 'video', tools: [tool('video-generate', 'openrouter')] }];
    mountPage('app:video'); await flushPromises();
    await detail().find('[data-section="sign-in"] [data-action="ai-models"]').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'settings' });
    expect(nav.studio).not.toHaveBeenCalled();
  });
  it('installed widgets open in the Library', async () => {
    getters['apps/installed'] = [pack]; getters['widgetDefinitions/allDefinitions'] = [{ id: 'w1' }];
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, assets: [{ asset_type: 'widget', asset_slug: 'board', local_id: 'w1' }] }) });
    mountPage('app:research'); await flushPromises();
    await detail().find('[data-group="widgets"] [data-action="open-widget"]').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'library', tab: 'widgets', item: 'w1' });
  });
  // Reported: an installed plugin's detail led with "Open in the Forge". The
  // Forge is where you build your OWN plugin, so it is offered only on those.
  it('the Forge is offered only on a plugin you built', async () => {
    getters['apps/installed'] = [pack];
    mountPage('app:research'); await flushPromises();
    expect(detail().find('[data-action="edit-in-forge"]').exists()).toBe(false);
    expect(detail().text()).not.toMatch(/Forge/);
    wrapper.unmount();
    state.pluginBuilder = { builtPluginNames: ['research'] };
    try {
      mountPage('app:research'); await flushPromises();
      await detail().find('[data-action="edit-in-forge"]').trigger('click');
      expect(nav.studio).toHaveBeenLastCalledWith('PluginsScreen', { select: { kind: 'plugin', id: 'research' } });
    } finally {
      delete state.pluginBuilder;
    }
  });
  it('right after installing, the detail leads with connecting what it needs', async () => {
    mountPage(); await openListing('gmail-plugin');
    expect(detail().find('[data-section="sign-in"]').text()).not.toContain('No sign-in needed');
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    const lead = detail().find('.ap-detail-actions .ap-btn.primary');
    expect(lead.attributes('data-action')).toBe('next-connect');
    expect(lead.text()).toBe('Connect Google');
    expect(wrapper.text()).toContain('Gmail installed. Connect Google to start using it.');
    await lead.trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/requestOAuthUrl', 'google');
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
  });
  it('a ready plugin leads with trying it, which asks Annie', async () => {
    getters['apps/installed'] = [gmail]; getters['appAuth/connectedApps'] = ['google'];
    mountPage('app:gmail-plugin'); await flushPromises();
    const lead = detail().find('.ap-detail-actions .ap-btn.primary');
    expect(lead.attributes('data-action')).toBe('try');
    await lead.trigger('click');
    expect(nav.ask).toHaveBeenLastCalledWith('Use Gmail to ');
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
  it('a vault deep link opens Accounts & keys; Connect and Disconnect happen in place', async () => {
    getters['apps/installed'] = [gmail]; getters['appAuth/connectedApps'] = ['google'];
    nav.prompt.mockResolvedValue('k');
    nav.confirm.mockResolvedValue(true);
    mountPage(null, 'vault'); await flushPromises();
    expect(tabButton('accounts').attributes('aria-selected')).toBe('true');
    nav.go.mockClear();
    await wrapper.find('[data-service="notion"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/saveApiKey', { providerId: 'notion', apiKey: 'k' });
    expect(nav.go).not.toHaveBeenCalled();
    expect(tabButton('accounts').attributes('aria-selected')).toBe('true');
    await wrapper.find('[data-account="google"] .ap-row-open').trigger('click'); await flushPromises();
    await detail().find('[data-action="disconnect"]').trigger('click'); await flushPromises();
    expect(nav.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disconnect Google?', danger: true }));
    expect(dispatch).toHaveBeenCalledWith('appAuth/disconnectApp', 'google');
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
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
