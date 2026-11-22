import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, defineComponent } from 'vue';
import { apiFetch } from '@/utils/apiFetch.js';
import { teamRequest } from '@/utils/teamClient.js';
import AppsSection from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue';
import OneApps from '@/views/One/apps/OneApps.vue';
import FocusedConnectors from './FocusedConnectors.vue';
import FocusedConnection from './FocusedConnection.vue';
import { __license as license } from '@/composables/useLicense';

const dispatch = vi.fn(() => Promise.resolve());
const state = reactive({
  appAuth: { allProviders: [], connectionHealth: null },
  apps: { installedAt: 1 },
  mcpServers: { servers: [] },
  webhooks: { webhooks: [] },
  emailListeners: { emailListeners: [] },
});
const getters = reactive({
  'appAuth/connectedApps': [], 'apps/installed': [], 'apps/available': [],
  'widgetDefinitions/allDefinitions': [], 'skills/allSkills': [], 'userAuth/userPseudonym': 'Nathan Wilbanks',
});
const team = reactive({ team: null, members: [] });

vi.mock('vuex', () => ({ useStore: () => ({ dispatch, state, getters }), mapState: () => ({}), mapGetters: () => ({}), mapActions: () => ({}) }));
vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: vi.fn() }));
vi.mock('@/utils/teamClient.js', () => ({ teamRequest: vi.fn() }));
vi.mock('@/views/One/team/useTeam.js', () => ({ useTeam: () => ({ state: team }) }));
// Reactive, like the store-backed licence, so a test can let it arrive after the page mounts.
vi.mock('@/composables/useLicense', async () => {
  const { reactive: makeReactive, computed } = await vi.importActual('vue');
  const state = makeReactive({ mail: true, hooks: true });
  return { __license: state, useLicense: () => ({ hasMail: computed(() => state.mail), hasHostedWebhooks: computed(() => state.hooks) }) };
});
vi.mock('@/components/UpgradeModal.vue', () => ({
  default: { name: 'UpgradeModal', props: { open: Boolean, reason: String }, template: '<div v-if="open" class="upgrade-stub">{{ reason }}</div>' },
}));
// The two editors are Studio's own screens, embedded; their specs cover them.
vi.mock('@/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue', () => ({
  __esModule: true,
  default: { name: 'IntegrationsStub', props: { embedded: Boolean }, template: '<div class="integrations-stub">{{ embedded ? "embedded" : "" }}</div>' },
}));
vi.mock('@/views/Terminal/CenterPanel/screens/Connectors/components/McpServers.vue', () => ({
  default: { name: 'McpServersStub', props: { compact: Boolean }, template: '<div class="mcp-stub">{{ compact ? "compact" : "" }}</div>' },
}));

const confirm = vi.fn();
const modalStub = defineComponent({ setup(_, { expose }) { expose({ showModal: confirm }); return () => null; } });
const nav = { go: vi.fn(), ask: vi.fn(), studio: vi.fn(), toast: vi.fn(), confirm: vi.fn(), prompt: vi.fn() };
// The OAuth consent popup: stays open until a test closes it.
let popup;
const closePopup = async () => { popup.closed = true; await new Promise((r) => setTimeout(r, 600)); await flushPromises(); };
const tool = (type, authProvider) => ({ type, schema: { title: type, ...(authProvider ? { authProvider } : {}) } });
const gmail = { name: 'gmail-plugin', displayName: 'Gmail', version: '1.1.0', category: 'productivity', tools: [tool('gmail-api', 'google')] };
const notion = { name: 'notion-plugin', displayName: 'Notion', version: '1.0.0', tools: [tool('notion-api', 'notion')] };
const pack = {
  name: 'research', displayName: 'Research', category: 'research',
  agents: [{ slug: 'researcher' }], tools: [tool('research-search')], widgets: [{ slug: 'board' }],
  skills: [{ slug: 'source-check' }], workflows: [{ slug: 'digest' }],
};

let wrapper;
function mountPage(item = null, tab = '') {
  wrapper = mount(FocusedConnectors, {
    props: { item, tab },
    global: {
      provide: { focusedNav: nav },
      stubs: { SvgIcon: true, SimpleModal: modalStub, FocusedConnectorLogo: true, teleport: true },
      directives: { tooltip: () => {} },
    },
  });
  // The route-prop contract OneShell keeps, without a browser.
  nav.go.mockImplementation((location) => (location.page === 'connectors' ? wrapper.setProps({ item: location.item || null, tab: location.tab || '' }) : undefined));
  return wrapper;
}
const apps = () => wrapper.findComponent(OneApps);
// The page hides with v-show. jsdom caches computed style, so isVisible() read while hidden stays
// false after it is shown again; the inline display v-show sets is the truth.
const appsShown = () => apps().element.style.display !== 'none';
const row = (id) => wrapper.find(`[data-row="${id}"]`);
const heading = () => wrapper.find('.za-main h1').text();
const detail = () => wrapper.find('.ap-detail');
async function openMenu(id) {
  await row(id).find('.kebab .icon-btn').trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  confirm.mockResolvedValue(true);
  nav.confirm.mockResolvedValue(true);
  popup = { closed: false };
  vi.spyOn(window, 'open').mockImplementation(() => popup);
  state.appAuth.allProviders = [
    { id: 'google', name: 'Google', connection_type: 'oauth', is_global: '1' },
    { id: 'notion', name: 'Notion', connection_type: 'apikey', is_global: '1' },
    { id: 'github', name: 'GitHub', connection_type: 'oauth', is_global: '1' },
  ];
  state.appAuth.connectionHealth = { providers: [] };
  state.mcpServers.servers = [];
  state.webhooks.webhooks = [];
  state.emailListeners.emailListeners = [];
  getters['appAuth/connectedApps'] = [];
  getters['apps/installed'] = [];
  getters['apps/available'] = [gmail, pack, { name: 'calculator', tools: [] }];
  getters['widgetDefinitions/allDefinitions'] = [];
  team.team = null;
  team.members = [];
  license.mail = true;
  license.hooks = true;
  apiFetch.mockImplementation(async (url, options = {}) => ({
    ok: true,
    json: async () => (options.method === 'DELETE' ? { success: true }
      : url.includes('/inspect/') ? { success: true, valid: true, integrityState: 'verified', detected: {}, trustTier: 'community' }
        : { success: true, assets: [] }),
  }));
  dispatch.mockImplementation(async (action, payload) => {
    if (action === 'appAuth/requestOAuthUrl') return `https://idp.test/consent/${payload}`;
    if (action === 'appAuth/checkConnectionHealth') return state.appAuth.connectionHealth;
    if (action === 'appAuth/createProvider') {
      state.appAuth.allProviders.push({ id: payload.id, name: payload.name, connection_type: 'apikey', is_global: '0', created_by: 'me' });
      return { success: true };
    }
    if (action === 'mcpServers/testConnection') return { success: true, connected: true, message: 'Connection successful (3 actions, 12ms)', toolCount: 3 };
    if (action === 'mcpServers/deleteServer') return { success: true };
    if (action === 'webhooks/deleteWebhook') return { success: true };
    if (action === 'marketplace/installPlugin') getters['apps/installed'].push({ ...getters['apps/available'].find((p) => p.name === payload.pluginName) });
    return undefined;
  });
});
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

describe('Apps page: App connections', () => {
  it('opens on App connections with the four sections; old Accounts & keys links land there too', async () => {
    getters['apps/installed'] = [gmail];
    getters['appAuth/connectedApps'] = ['google'];
    mountPage(); await flushPromises();
    expect(wrapper.findAll('.sub-item').map((b) => b.attributes('data-page'))).toEqual(['connections', 'plugins', 'mcp', 'triggers']);
    expect(heading()).toBe('Connections');
    expect(row('google').text()).toContain('Google');
    expect(row('google').text()).toContain('Connected');
    wrapper.unmount();
    mountPage(null, 'vault'); await flushPromises();
    expect(heading()).toBe('Connections');
  });

  it('each section has its own route, and the page follows it', async () => {
    mountPage(); await flushPromises();
    await wrapper.find('[data-page="plugins"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', tab: 'plugins' });
    expect(heading()).toBe('Add-ons');
    await wrapper.find('[data-page="connections"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors' });
    expect(heading()).toBe('Connections');
  });

  it('Connect starts the sign-in right in the row: no second page', async () => {
    getters['apps/installed'] = [gmail];
    mountPage(); await flushPromises();
    expect(row('google').text()).toContain('Not connected');
    await row('google').find('[data-action="signin"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/requestOAuthUrl', 'google');
    expect(window.open).toHaveBeenCalledWith('https://idp.test/consent/google', 'oauth_google', expect.any(String));
    expect(row('google').text()).toContain('Signing in…');
    expect(nav.go).not.toHaveBeenCalled();
    await closePopup();
    expect(dispatch.mock.calls.filter(([a]) => a === 'appAuth/refreshAfterConnect')).toHaveLength(1);
    expect(row('google').text()).not.toContain('Signing in…');
  });

  it('an API-key sign-in asks for the key in one dialog', async () => {
    getters['apps/installed'] = [notion];
    nav.prompt.mockResolvedValue('  test-key  ');
    mountPage(); await flushPromises();
    await row('notion').find('[data-action="signin"]').trigger('click'); await flushPromises();
    expect(nav.prompt).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connect Notion', secret: true }));
    expect(dispatch).toHaveBeenCalledWith('appAuth/saveApiKey', { providerId: 'notion', apiKey: 'test-key' });
    expect(nav.toast).toHaveBeenCalledWith('Notion connected.');
  });

  it('a row opens its details; Disconnect there confirms, then disconnects in place', async () => {
    getters['apps/installed'] = [gmail];
    getters['appAuth/connectedApps'] = ['google'];
    mountPage(); await flushPromises();
    await row('google').find('.name-text').trigger('click'); await flushPromises();
    const drawer = wrapper.find('[data-testid="apps-drawer"]');
    expect(drawer.text()).toContain('Gmail');
    await drawer.find('[data-action="disconnect"]').trigger('click'); await flushPromises();
    expect(nav.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disconnect Google?', danger: true }));
    expect(dispatch).toHaveBeenCalledWith('appAuth/disconnectApp', 'google');
  });

  it('Test connection, in a working row\'s menu, runs the health check and says how it went', async () => {
    getters['apps/installed'] = [gmail];
    getters['appAuth/connectedApps'] = ['google'];
    state.appAuth.connectionHealth = { providers: [{ provider: 'google', status: 'healthy', lastChecked: new Date().toISOString(), details: { email: 'nathan@example.com' } }] };
    mountPage(); await flushPromises();
    expect(row('google').text()).toContain('nathan@example.com');
    // A working connection needs nothing in its row; the test is one menu away.
    expect(row('google').find('.col-status [data-action="test"]').exists()).toBe(false);
    await row('google').find('[aria-label="More actions"]').trigger('click'); await flushPromises();
    await row('google').find('[data-action="test"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/checkConnectionHealth');
    expect(nav.toast).toHaveBeenCalledWith('Google works.');
  });

  it('the Add-ons chip opens Add-ons, searched for that connection', async () => {
    getters['apps/installed'] = [gmail];
    getters['appAuth/connectedApps'] = ['google'];
    mountPage(); await flushPromises();
    await row('google').find('[data-action="show-plugins"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', tab: 'plugins' });
    expect(wrapper.find('[data-testid="apps-search"]').element.value).toBe('Google');
    expect(wrapper.findAll('[data-row]').map((r) => r.attributes('data-row'))).toEqual(['gmail-plugin']);
  });

  it('Disconnect several asks once and reports once', async () => {
    getters['apps/installed'] = [gmail, notion];
    getters['appAuth/connectedApps'] = ['google', 'notion'];
    mountPage(); await flushPromises();
    for (const id of ['google', 'notion']) await row(id).find('.cb input').setValue(true);
    expect(wrapper.find('.bulk').text()).toContain('2 selected');
    await wrapper.find('[data-action="bulk-disconnect"]').trigger('click'); await flushPromises();
    expect(nav.confirm).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls.filter(([a]) => a === 'appAuth/disconnectApp').map(([, id]) => id)).toEqual(['google', 'notion']);
    expect(nav.toast).toHaveBeenCalledWith('2 connections disconnected.');
  });
});

describe('Apps page: Add connection', () => {
  it('lists every service, and offers an app that is missing as a custom app', async () => {
    mountPage(); await flushPromises();
    await wrapper.find('.page-head [data-action="add"]').trigger('click'); await flushPromises();
    const modal = () => wrapper.find('[data-testid="add-connection"]');
    expect(modal().findAll('[data-item]').map((i) => i.attributes('data-item'))).toEqual(['github', 'google', 'notion']);
    expect(modal().find('[data-action="custom-app"]').exists()).toBe(true);
    await modal().find('[data-testid="add-search"]').setValue('Acme CRM'); await flushPromises();
    expect(modal().find('[data-section="no-match"]').text()).toContain('Add “Acme CRM” as a custom app');
    await modal().find('[data-action="custom-app-named"]').trigger('click'); await flushPromises();
    expect(modal().find('#za-ca-name').element.value).toBe('Acme CRM');
    await modal().find('#za-ca-key').setValue('k-123');
    await modal().find('form').trigger('submit'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('appAuth/createProvider', expect.objectContaining({ name: 'Acme CRM', connectionType: 'apikey', icon: 'custom' }));
    const saved = dispatch.mock.calls.find(([a]) => a === 'appAuth/saveApiKey');
    expect(saved[1]).toEqual({ providerId: expect.stringMatching(/^custom-acme-crm-[a-z0-9]{4}$/), apiKey: 'k-123' });
    expect(nav.toast).toHaveBeenCalledWith('Acme CRM connected.');
    expect(modal().exists()).toBe(false);
  });

  it('a custom app needs a name that is not already listed, and a key', async () => {
    mountPage(); await flushPromises();
    await wrapper.find('.page-head [data-action="add"]').trigger('click'); await flushPromises();
    const modal = () => wrapper.find('[data-testid="add-connection"]');
    await modal().find('[data-action="custom-app"]').trigger('click'); await flushPromises();
    await modal().find('form').trigger('submit'); await flushPromises();
    expect(modal().findAll('.err').map((e) => e.text())).toEqual(['Enter the app’s name', 'Paste the API key']);
    await modal().find('#za-ca-name').setValue('google');
    await modal().find('#za-ca-key').setValue('k');
    await modal().find('form').trigger('submit'); await flushPromises();
    expect(modal().find('.err').text()).toBe('google is already in the list. Connect it from there.');
    expect(dispatch.mock.calls.some(([a]) => a === 'appAuth/createProvider')).toBe(false);
  });

  it('an app with its own sign-in page is pointed at an add-on Annie can build', async () => {
    mountPage(); await flushPromises();
    await wrapper.find('.page-head [data-action="add"]').trigger('click'); await flushPromises();
    const modal = () => wrapper.find('[data-testid="add-connection"]');
    await modal().find('[data-action="custom-app"]').trigger('click'); await flushPromises();
    await modal().find('#za-ca-name').setValue('Northwind');
    await modal().find('[data-type="oauth"]').trigger('click'); await flushPromises();
    await modal().find('[data-action="ask-annie"]').trigger('click'); await flushPromises();
    expect(nav.ask).toHaveBeenCalledWith(expect.stringContaining('Build an add-on that connects AGNT to Northwind'));
    expect(modal().exists()).toBe(false);
  });

  it('team connections: the switch lists the team’s, and Connect for the team posts a named one', async () => {
    team.team = { id: 't1', name: 'bravo', role: 'owner' };
    let saved = [];
    teamRequest.mockImplementation(async (path, options = {}) => {
      if (options.method === 'POST') { saved = [{ id: 'c1', ...JSON.parse(options.body) }]; return {}; }
      return saved;
    });
    mountPage(); await flushPromises();
    await wrapper.find('[data-scope="team"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[data-section="empty"]').text()).toContain('No team connections yet');
    await wrapper.find('.page-head [data-action="add"]').trigger('click'); await flushPromises();
    const modal = () => wrapper.find('[data-testid="add-connection"]');
    await modal().find('[data-testid="team-connection-name"]').setValue('Company GitHub');
    await modal().find('[data-item="github"] [data-action="connect"]').trigger('click'); await flushPromises();
    expect(teamRequest).toHaveBeenCalledWith('/t1/connections', { method: 'POST', body: JSON.stringify({ providerId: 'github', name: 'Company GitHub' }) });
    expect(row('team:c1').text()).toContain('Company GitHub');
  });
});

describe('Apps page: Add-ons, Custom connections, Email & web triggers', () => {
  it('Plugins: each row shows the sign-in it needs; Uninstall confirms and uninstalls', async () => {
    getters['apps/installed'] = [gmail];
    mountPage(null, 'plugins'); await flushPromises();
    expect(row('gmail-plugin').text()).toContain('Not connected');
    await openMenu('gmail-plugin');
    await row('gmail-plugin').find('[data-action="uninstall"]').trigger('click'); await flushPromises();
    expect(nav.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Uninstall Gmail?', danger: true }));
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/plugins/gmail-plugin?mode=clean'), { method: 'DELETE' });
    expect(nav.toast).toHaveBeenCalledWith('Gmail uninstalled.');
  });

  it('Plugins lead with the Market; building opens the Forge', async () => {
    mountPage(null, 'plugins'); await flushPromises();
    await wrapper.find('.page-head [data-action="browse"]').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'market' });
    await wrapper.find('.page-head [data-action="build"]').trigger('click');
    expect(nav.studio).toHaveBeenLastCalledWith('PluginsScreen');
  });

  it('MCP: Test says what the server answered; Remove confirms; Add opens the MCP manager in place', async () => {
    state.mcpServers.servers = [{ name: 'git', transport: { type: 'stdio' } }];
    mountPage(null, 'mcp'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('mcpServers/fetchServers');
    expect(row('git').text()).toContain('Not checked');
    await row('git').find('[data-action="mcp-test"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('mcpServers/testConnection', 'git');
    expect(row('git').text()).toContain('Responding');
    expect(row('git').text()).toContain('3 actions');
    await openMenu('git');
    await row('git').find('[data-action="mcp-remove"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('mcpServers/deleteServer', 'git');
    await wrapper.find('.page-head [data-action="mcp-manage"]').trigger('click'); await flushPromises();
    expect(wrapper.find('.mcp-stub').text()).toBe('compact');
    expect(appsShown()).toBe(false);
    await wrapper.find('.focused-mcp .focused-page-back').trigger('click'); await flushPromises();
    expect(appsShown()).toBe(true);
  });

  it('Email & web triggers: copy an address or URL, and remove a web trigger', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    state.webhooks.webhooks = [{ id: 7, workflow_id: 'w2', workflow_name: 'Leads', workflow_status: 'listening', webhook_url: 'https://hooks.example/x', method: 'POST', auth_type: 'none' }];
    state.emailListeners.emailListeners = [{ id: 3, workflow_id: 'w1', workflow_name: 'Inbox', workflow_status: 'stopped', email_address: 'workflow-1@agnt.gg' }];
    mountPage(null, 'triggers'); await flushPromises();
    expect(wrapper.findAll('[data-row]').map((r) => r.attributes('data-row'))).toEqual(['email:3', 'webhook:7']);
    await openMenu('webhook:7');
    await row('webhook:7').find('[data-action="copy"]').trigger('click'); await flushPromises();
    expect(writeText).toHaveBeenCalledWith('https://hooks.example/x');
    expect(nav.toast).toHaveBeenCalledWith('Web trigger URL copied.');
    await openMenu('webhook:7');
    await row('webhook:7').find('[data-action="remove-webhook"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('webhooks/deleteWebhook', 'w2');
    expect(row('email:3').find('[data-action="remove-webhook"]').exists()).toBe(false);
  });

  // The licence usually arrives after the page mounts; asking only at mount showed none.
  it('loads triggers once the licence arrives, even after the page mounted', async () => {
    license.mail = false;
    license.hooks = false;
    mountPage(); await flushPromises();
    expect(dispatch.mock.calls.some(([a]) => a === 'emailListeners/fetchEmailListeners')).toBe(false);
    license.mail = true;
    license.hooks = true;
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('emailListeners/fetchEmailListeners');
    expect(dispatch).toHaveBeenCalledWith('webhooks/fetchWebhooks');
  });

  it('without Pro, Email & web triggers offers Go Pro and asks the server for nothing', async () => {
    license.mail = false;
    license.hooks = false;
    mountPage(null, 'triggers'); await flushPromises();
    expect(wrapper.find('[data-section="locked"]').text()).toContain('Email and web triggers are included with AGNT Pro');
    expect(dispatch.mock.calls.some(([a]) => a === 'webhooks/fetchWebhooks' || a === 'emailListeners/fetchEmailListeners')).toBe(false);
    await wrapper.find('[data-action="upgrade"]').trigger('click'); await flushPromises();
    expect(wrapper.find('.upgrade-stub').exists()).toBe(true);
  });
});

describe('An add-on in full (app:<name>)', () => {
  it('opens direct and browser-back add-on links, including packages loaded after mount', async () => {
    getters['apps/available'] = []; mountPage('app:research'); await flushPromises();
    expect(wrapper.text()).toContain('This add-on isn’t available');
    getters['apps/available'] = [pack, gmail]; await flushPromises();
    expect(detail().find('.ap-detail-name').text()).toBe('Research');
    expect(appsShown()).toBe(false);
    await wrapper.setProps({ item: 'app:gmail-plugin' }); await flushPromises();
    expect(detail().find('.ap-detail-name').text()).toBe('Gmail');
    await wrapper.setProps({ item: null }); await flushPromises();
    expect(wrapper.find('.ap-detail').exists()).toBe(false);
    expect(appsShown()).toBe(true);
  });

  it('Back returns to the section you came from, as you left it', async () => {
    getters['apps/installed'] = [gmail];
    mountPage(null, 'plugins'); await flushPromises();
    await wrapper.find('[data-testid="apps-search"]').setValue('gm');
    await openMenu('gmail-plugin');
    await row('gmail-plugin').find('[data-action="details"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', item: 'app:gmail-plugin' });
    expect(wrapper.findComponent(AppsSection).props('selectedPlugin')).toBe('gmail-plugin');
    await wrapper.find('[data-action="back"]').trigger('click'); await flushPromises();
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'connectors', tab: 'plugins' });
    expect(heading()).toBe('Add-ons');
    expect(wrapper.find('[data-testid="apps-search"]').element.value).toBe('gm');
  });

  it('uses the inspected shared install flow, including consent and refreshed installed state', async () => {
    mountPage('app:research'); await flushPromises();
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/plugins/inspect/research'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('full access') }));
    expect(dispatch.mock.calls.filter(([a]) => a === 'marketplace/installPlugin')).toEqual([['marketplace/installPlugin', { pluginName: 'research' }]]);
    expect(wrapper.text()).toContain('Research installed.');
  });

  it('cancelled installation never invokes the installer', async () => {
    confirm.mockResolvedValue(false); mountPage('app:research'); await flushPromises();
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });

  it('Connect in the details starts the sign-in there, and Reconnect shows connected once health is re-read', async () => {
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

  it('model credentials belong to Settings', async () => {
    state.appAuth.allProviders.push({ id: 'openrouter', name: 'OpenRouter', connection_type: 'apikey' });
    getters['apps/available'] = [{ name: 'video', tools: [tool('video-generate', 'openrouter')] }];
    mountPage('app:video'); await flushPromises();
    await detail().find('[data-section="sign-in"] [data-action="ai-models"]').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'settings' });
  });

  it('installed dashboard cards open in the Library', async () => {
    getters['apps/installed'] = [pack]; getters['widgetDefinitions/allDefinitions'] = [{ id: 'w1' }];
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, assets: [{ asset_type: 'widget', asset_slug: 'board', local_id: 'w1' }] }) });
    mountPage('app:research'); await flushPromises();
    await detail().find('[data-group="widgets"] [data-action="open-widget"]').trigger('click');
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'library', tab: 'widgets', item: 'w1' });
  });

  it('the Forge is offered only on an add-on you built', async () => {
    getters['apps/installed'] = [pack];
    mountPage('app:research'); await flushPromises();
    expect(detail().find('[data-action="edit-in-forge"]').exists()).toBe(false);
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

  it('a ready add-on leads with trying it, which asks Annie', async () => {
    getters['apps/installed'] = [gmail]; getters['appAuth/connectedApps'] = ['google'];
    mountPage('app:gmail-plugin'); await flushPromises();
    const lead = detail().find('.ap-detail-actions .ap-btn.primary');
    expect(lead.attributes('data-action')).toBe('try');
    await lead.trigger('click');
    expect(nav.ask).toHaveBeenLastCalledWith('Use Gmail to ');
  });
});

describe('Old links', () => {
  it('an account link renders its page and returns to Apps', async () => {
    mountPage('google'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).props('cardId')).toBe('google');
    await wrapper.find('.focused-page-back').trigger('click'); await flushPromises();
    expect(wrapper.findComponent(FocusedConnection).exists()).toBe(false);
    expect(appsShown()).toBe(true);
  });

  it('Edit app on a custom app opens the provider editor, and Back returns', async () => {
    state.appAuth.allProviders.push({ id: 'custom-acme-k3x9', name: 'Acme', connection_type: 'apikey', is_global: '0', created_by: 'me' });
    getters['appAuth/connectedApps'] = ['custom-acme-k3x9'];
    mountPage(); await flushPromises();
    expect(row('custom-acme-k3x9').text()).toContain('Custom app');
    await row('custom-acme-k3x9').find('.name-text').trigger('click'); await flushPromises();
    await wrapper.find('[data-testid="apps-drawer"] [data-action="edit-app"]').trigger('click'); await flushPromises();
    expect(wrapper.find('.integrations-stub').text()).toBe('embedded');
    expect(appsShown()).toBe(false);
    await wrapper.find('.focused-integrations .focused-page-back').trigger('click'); await flushPromises();
    expect(appsShown()).toBe(true);
  });
});
