import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent } from 'vue';
import AppsSection from './AppsSection.vue';
import { apiFetch } from '@/utils/apiFetch.js';

vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: vi.fn() }));
const confirm = vi.fn();
const modalStub = defineComponent({ setup(_, { expose }) { expose({ showModal: confirm }); return () => null; } });

// Shapes from backend/plugins/dev manifests as /plugins/installed and /plugins/marketplace serve them.
const tool = (type, schema = {}) => ({ type, schema: { title: type, ...schema } });
const gmail = {
  name: 'gmail-plugin', displayName: 'Gmail', category: 'productivity', author: 'AGNT', version: '1.0.2', trustTier: 'official',
  permissions: { capabilities: [], domains: [] },
  tools: [tool('gmail-api', { title: 'Gmail API', authProvider: 'google', parameters: { operation: { options: ['Send Email', 'Reply to Email'] } } })],
};
const calendar = {
  name: 'google-calendar-plugin', displayName: 'Google Calendar', category: 'productivity', version: '1.0.0',
  tools: [tool('google-calendar-api', { title: 'Calendar API', authProvider: 'google' }), tool('google-calendar-trigger', { title: 'New event', category: 'trigger', authProvider: 'google' })],
};
const research = {
  name: 'research', displayName: 'Research', category: 'research', version: '0.4.0',
  agents: [{ slug: 'researcher' }], tools: [tool('search', { title: 'Search', authProvider: 'google' })],
  widgets: [{ slug: 'board' }], skills: [{ slug: 'source-check' }], workflows: [{ slug: 'digest' }],
};
const calculator = { name: 'calculator', displayName: 'Calculator', category: 'utility', version: '1.0.0', tools: [] };
const notion = { name: 'notion-plugin', displayName: 'Notion', category: 'productivity', version: '1.1.1', tools: [tool('notion-api', { title: 'Notion API', authProvider: 'notion' })] };
const providers = [
  { id: 'google', name: 'Google', connection_type: 'oauth' },
  { id: 'notion', name: 'Notion', connection_type: 'apikey' },
  { id: 'slack', name: 'Slack', connection_type: 'oauth' },
];

let wrapper;
let replies;
function setup(options = {}) {
  const store = createStore({ modules: {
    apps: { namespaced: true, state: () => ({ installed: options.installed || [], available: options.available || [research, calculator], error: null }), getters: { installed: (s) => s.installed, available: (s) => s.available } },
    appAuth: { namespaced: true, state: () => ({ allProviders: providers, connectionHealth: { providers: options.health || [] } }), getters: { connectedApps: () => options.connected || [] } },
    widgetDefinitions: { namespaced: true, getters: { allDefinitions: () => [{ id: 'w1' }] } },
    agents: { namespaced: true, getters: { allAgents: () => options.agents || [] } },
    pluginBuilder: { namespaced: true, state: () => ({ builtPluginNames: options.built || [], generatedManifest: options.draft || null }), getters: { hasUninstalledWork: () => !!options.draft } },
    marketplace: { namespaced: true, state: () => ({ myPublishedItems: options.published || [] }) },
  } });
  const dispatch = vi.spyOn(store, 'dispatch').mockImplementation(async (action, payload) => {
    if (action === 'marketplace/checkPurchaseStatus') return false;
    if (action === 'marketplace/installPlugin') {
      if (options.failInstall) throw new Error('Download failed');
      store.state.apps.installed.push({ ...store.state.apps.available.find((p) => p.name === payload.pluginName) });
    }
    return [];
  });
  wrapper = mount(AppsSection, { props: options.props || {}, global: { plugins: [store], stubs: { SimpleModal: modalStub, SvgIcon: { template: '<span />' } } } });
  return { store, dispatch };
}
const tab = (id) => wrapper.find(`[data-tab="${id}"]`);
const detail = () => wrapper.find('.ap-detail');
const inspectCalls = () => apiFetch.mock.calls.filter(([url]) => url.includes('/inspect/'));
async function openListing(name) {
  await flushPromises();
  await tab('browse').trigger('click');
  await wrapper.find(`[data-listing="${name}"] .ap-row-open`).trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  confirm.mockResolvedValue(true);
  replies = {
    inspect: { success: true, valid: true, integrityState: 'verified', detected: {}, trustTier: 'community' },
    status: null,
    assets: [],
    update: [{ success: true, version: '2.0.0' }],
  };
  let updateCall = 0;
  apiFetch.mockImplementation(async (url, init = {}) => {
    const body = () => {
      if (url.includes('/inspect/')) return replies.inspect;
      if (url.includes('/update-status')) return { success: true, status: replies.status };
      if (url.includes('/update-policy/')) return { success: true };
      if (url.includes('/update/')) return replies.update[Math.min(updateCall++, replies.update.length - 1)];
      if (init.method === 'DELETE') return { success: true };
      return { success: true, assets: replies.assets };
    };
    return { ok: true, json: async () => body() };
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

describe('Browse: the Market', () => {
  it('lists every Market plugin, including ones with no sign-in, and filters by name and by what is inside', async () => {
    setup({ available: [research, calculator, gmail] }); await flushPromises();
    await tab('browse').trigger('click');
    expect(wrapper.findAll('[data-listing]').map((r) => r.attributes('data-listing'))).toEqual(['calculator', 'gmail-plugin', 'research']);
    expect(tab('browse').text()).toContain('3');
    await wrapper.find('input[type="search"]').setValue('reply');
    expect(wrapper.findAll('[data-listing]').map((r) => r.attributes('data-listing'))).toEqual(['gmail-plugin']);
    await wrapper.find('input[type="search"]').setValue('nothing-matches');
    expect(wrapper.text()).toContain('Nothing on the Market matches');
    await wrapper.find('[data-action="clear"]').trigger('click');
    expect(wrapper.findAll('[data-listing]')).toHaveLength(3);
    await wrapper.find('[data-filter="Utility"]').trigger('click');
    expect(wrapper.findAll('[data-listing]').map((r) => r.attributes('data-listing'))).toEqual(['calculator']);
  });
  it('says when a listing is ready with a sign-in you already have', async () => {
    setup({ available: [gmail, notion], connected: ['google'] }); await flushPromises();
    await tab('browse').trigger('click');
    expect(wrapper.find('[data-listing="gmail-plugin"]').text()).toContain('Ready with your Google sign-in');
    expect(wrapper.find('[data-listing="notion-plugin"]').text()).not.toContain('Ready with');
  });
  it('links to the full Marketplace', async () => {
    setup(); await flushPromises();
    await tab('browse').trigger('click');
    await wrapper.find('[data-testid="open-marketplace"]').trigger('click');
    expect(wrapper.emitted('open-market')).toHaveLength(1);
  });
});

describe('Installed: one card per thing you connected', () => {
  it('folds plugins that share a sign-in into one card and puts what needs you first', async () => {
    setup({ installed: [gmail, calendar, calculator, notion], available: [], connected: ['google'] }); await flushPromises();
    const sections = wrapper.findAll('.ap-group-label').map((h) => h.attributes('data-section'));
    expect(sections).toEqual(['needs-you', 'ready']);
    const needsYou = wrapper.findAll('.ap-list')[0];
    expect(needsYou.find('[data-card="notion"]').text()).toContain('Connect Notion');
    const google = wrapper.find('[data-card="google"]');
    // appCards orders a card's plugins by name; "Google Calendar" reads as "Calendar" on the Google card.
    expect(google.findAll('.ap-plugin-chip').map((c) => c.text())).toEqual(['Gmail', 'Calendar']);
    expect(google.text()).toContain('2 plugins on one sign-in');
    expect(google.text()).toContain('2 tools');
    expect(google.text()).toContain('1 trigger');
    expect(wrapper.find('[data-app="calculator"]').text()).toContain('No sign-in needed');
    expect(wrapper.find('[data-testid="needs-you-count"]').text()).toBe('1');
  });
  it('filters by Needs you, triggers and packs, and searches into operations', async () => {
    setup({ installed: [gmail, calendar, calculator, notion, research], available: [], connected: ['google'] }); await flushPromises();
    await wrapper.find('[data-filter="attention"]').trigger('click');
    expect(wrapper.findAll('[data-card]').map((r) => r.attributes('data-card'))).toEqual(['notion']);
    await wrapper.find('[data-filter="triggers"]').trigger('click');
    expect(wrapper.findAll('[data-card]').map((r) => r.attributes('data-card'))).toEqual(['google']);
    await wrapper.find('[data-filter="packs"]').trigger('click');
    expect(wrapper.findAll('[data-card]').map((r) => r.attributes('data-card'))).toEqual(['google']);
    await wrapper.find('[data-filter="all"]').trigger('click');
    await wrapper.find('input[type="search"]').setValue('reply to email');
    expect(wrapper.findAll('[data-card]').map((r) => r.attributes('data-card'))).toEqual(['google']);
    await wrapper.find('input[type="search"]').setValue('zzz');
    await wrapper.find('[data-action="clear"]').trigger('click');
    expect(wrapper.findAll('[data-card]')).toHaveLength(3);
  });
  it('a card hands Connect and Reconnect to the host with the card', async () => {
    setup({ installed: [gmail, notion], available: [], connected: ['google'], health: [{ provider: 'google', status: 'error' }] }); await flushPromises();
    await wrapper.find('[data-card="notion"] [data-action="connect"]').trigger('click');
    expect(wrapper.emitted('connect')[0][0]).toMatchObject({ providerId: 'notion', name: 'Notion' });
    await wrapper.find('[data-card="google"] [data-action="reconnect"]').trigger('click');
    expect(wrapper.emitted('reconnect')[0][0]).toMatchObject({ providerId: 'google', apps: [expect.objectContaining({ name: 'gmail-plugin' })] });
  });
  it('an empty library offers the Market', async () => {
    setup({ installed: [] }); await flushPromises();
    expect(wrapper.text()).toContain('No plugins installed yet');
    await wrapper.find('[data-action="browse"]').trigger('click');
    expect(tab('browse').attributes('aria-selected')).toBe('true');
    expect(wrapper.findAll('[data-listing]')).toHaveLength(2);
  });
});

describe('Plugin detail and install', () => {
  it('shows every kind of content and delegates real connections to the host', async () => {
    setup(); await openListing('research');
    expect(detail().find('.ap-detail-name').text()).toBe('Research');
    expect(detail().findAll('[data-group]').map((g) => g.attributes('data-group'))).toEqual(['tools', 'agents', 'workflows', 'skills', 'widgets']);
    expect(detail().text()).toContain('Researcher');
    await detail().find('[data-section="sign-in"] [data-action="connect"]').trigger('click');
    expect(wrapper.emitted('connect')[0][0]).toMatchObject({ providerId: 'google', name: 'Google' });
  });
  it('lists a tool’s operations and the access the plugin declares', async () => {
    setup({ installed: [gmail], available: [], connected: ['google'] }); await flushPromises();
    await wrapper.find('[data-app="gmail-plugin"] .ap-row-open').trigger('click'); await flushPromises();
    expect(detail().findAll('.ap-op').map((o) => o.text())).toEqual(['Send email', 'Reply to email']);
    expect(detail().find('[data-section="access"]').text()).toContain('Declares no special access');
    expect(detail().text()).toContain('Official');
  });
  it('inspects and asks consent before invoking the existing installer exactly once', async () => {
    const { dispatch } = setup(); await openListing('research');
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/plugins/inspect/research'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('full access'), confirmText: 'Install plugin' }));
    expect(confirm.mock.calls[0][0].message).toContain('It adds 1 tool, 1 agent, 1 workflow, 1 skill, 1 widget.');
    expect(dispatch.mock.calls.filter(([a]) => a === 'marketplace/installPlugin')).toEqual([['marketplace/installPlugin', { pluginName: 'research' }]]);
    expect(wrapper.text()).toContain('Research installed.');
    expect(detail().find('[data-action="open-forge"]').exists()).toBe(true);
  });
  it('admits only one install while an inspection is pending', async () => {
    let resolveInspection;
    apiFetch.mockImplementation((url) => (url.includes('/inspect/') ? new Promise((resolve) => { resolveInspection = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ success: true, assets: [] }) })));
    const { dispatch } = setup(); await openListing('research');
    await detail().find('[data-action="install"]').trigger('click');
    await detail().find('[data-action="install"]').trigger('click');
    expect(inspectCalls()).toHaveLength(1);
    resolveInspection({ ok: true, json: async () => ({ success: true, valid: true, integrityState: 'verified' }) });
    await flushPromises();
    expect(dispatch.mock.calls.filter(([action]) => action === 'marketplace/installPlugin')).toHaveLength(1);
  });
  it('does not install on cancelled consent', async () => {
    confirm.mockResolvedValue(false); const { dispatch } = setup(); await openListing('research');
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it.each(['mismatch', 'unavailable'])('blocks install on %s inspection and shows an actionable error', async (state) => {
    replies.inspect = state === 'mismatch' ? { success: true, integrityState: 'mismatch' } : { success: false, error: 'Inspection unavailable' };
    const { dispatch } = setup(); await openListing('research');
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it('shows an install failure without claiming success', async () => {
    setup({ failInstall: true }); await openListing('research');
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Download failed');
    expect(wrapper.text()).not.toContain('Research installed.');
    expect(detail().find('[data-action="install"]').attributes('disabled')).toBeUndefined();
  });
  it('paid plugins use purchase checkout rather than bypassing it', async () => {
    const { dispatch } = setup({ available: [{ ...research, price: 9, marketplace_item_id: 'item1' }] });
    await openListing('research');
    expect(detail().find('[data-action="install"]').text()).toBe('Get · $9.00');
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('marketplace/purchaseItem', { itemId: 'item1' });
    expect(inspectCalls()).toHaveLength(0);
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it('opens only a widget whose installed id is in the widget store', async () => {
    replies.assets = [{ asset_type: 'widget', asset_slug: 'board', local_id: 'w1' }];
    setup({ installed: [research], available: [] }); await flushPromises();
    await wrapper.find('[data-app="research"] .ap-row-open').trigger('click'); await flushPromises();
    const widgets = detail().find('[data-group="widgets"]');
    await widgets.find('[data-action="open-widget"]').trigger('click');
    expect(wrapper.emitted('open-widget')).toEqual([['w1']]);
    expect(widgets.findAll('.ap-inside-item')).toHaveLength(1);
  });
  it('ignores late asset responses when another plugin is selected', async () => {
    let resolveAssets;
    apiFetch.mockImplementation((url) => (url.includes('/assets') ? new Promise((resolve) => { resolveAssets = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ success: true }) })));
    setup({ installed: [research, calculator], available: [] }); await flushPromises();
    await wrapper.find('[data-app="research"] .ap-row-open').trigger('click'); await flushPromises();
    const stale = resolveAssets;
    await wrapper.find('[data-app="calculator"] .ap-row-open').trigger('click'); await flushPromises();
    stale({ ok: true, json: async () => ({ success: true, assets: [{ asset_type: 'widget', asset_slug: 'stale-widget', local_id: 'w1' }] }) });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Stale Widget');
    expect(detail().find('.ap-detail-name').text()).toBe('Calculator');
  });
  it('shows load failures without erasing cached packages', async () => {
    const { dispatch } = setup(); await flushPromises();
    dispatch.mockRejectedValue(new Error('Network unavailable'));
    await openListing('research');
    await detail().find('[data-action="install"]').trigger('click'); await flushPromises();
    await wrapper.find('[role="alert"] button').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Network unavailable');
    await wrapper.find('[data-action="back"]').trigger('click');
    expect(wrapper.findAll('[data-listing]')).toHaveLength(2);
  });
  it('a deep link to an unknown plugin says so instead of showing the wrong one', async () => {
    setup({ props: { selectedPlugin: 'ghost' } }); await flushPromises();
    expect(detail().text()).toContain('This plugin isn’t available');
  });
});

describe('Lifecycle: updates, pinning, uninstall, agents', () => {
  it('an update refused for new access is a banner, a Needs-you count and a consent prompt', async () => {
    replies.status = { checkedAt: 't1', blockedOnConsent: [{ name: 'gmail-plugin', permissionDiff: { added: ['filesystem'] } }] };
    replies.update = [{ success: false, requiresConsent: true, permissionDiff: { added: ['filesystem'] } }, { success: true, version: '1.1.0' }];
    setup({ installed: [gmail], available: [], connected: ['google'] }); await flushPromises();
    expect(wrapper.find('.ap-banner').text()).toContain('reads and writes files on this computer');
    expect(wrapper.find('[data-testid="needs-you-count"]').text()).toBe('1');
    await wrapper.find('[data-action="open-review"]').trigger('click'); await flushPromises();
    await detail().find('[data-action="review-update"]').trigger('click'); await flushPromises();
    const updates = apiFetch.mock.calls.filter(([url]) => url.includes('/plugins/update/'));
    expect(updates.map(([, init]) => JSON.parse(init.body))).toEqual([{ acceptedPermissions: false }, { acceptedPermissions: true }]);
    expect(confirm.mock.calls.at(-1)[0].message).toContain('Reads and writes files on this computer');
    expect(wrapper.text()).toContain('Gmail updated to v1.1.0.');
    // The status file is unchanged until the next pass; the resolved review must not come back.
    expect(wrapper.find('.ap-banner').exists()).toBe(false);
  });
  it('declining consent changes nothing', async () => {
    replies.status = { checkedAt: 't1', blockedOnConsent: [{ name: 'gmail-plugin', permissionDiff: { added: ['network'] } }] };
    replies.update = [{ success: false, requiresConsent: true, permissionDiff: { added: ['network'] } }];
    confirm.mockResolvedValue(false);
    setup({ installed: [gmail], available: [], connected: ['google'] }); await flushPromises();
    await wrapper.find('[data-action="open-review"]').trigger('click'); await flushPromises();
    await detail().find('[data-action="review-update"]').trigger('click'); await flushPromises();
    expect(apiFetch.mock.calls.filter(([url]) => url.includes('/plugins/update/'))).toHaveLength(1);
    expect(wrapper.find('.ap-banner').exists()).toBe(true);
  });
  it('pinned plugins are not flagged, and the switch sets the policy', async () => {
    replies.status = { checkedAt: 't1', blockedOnConsent: [{ name: 'gmail-plugin', permissionDiff: { added: ['network'] } }] };
    const { dispatch } = setup({ installed: [{ ...gmail, updatePolicy: 'pinned' }], available: [], connected: ['google'] }); await flushPromises();
    expect(wrapper.find('.ap-banner').exists()).toBe(false);
    await wrapper.find('[data-app="gmail-plugin"] .ap-row-open').trigger('click'); await flushPromises();
    const toggle = detail().find('[role="switch"]');
    expect(toggle.attributes('aria-checked')).toBe('false');
    await toggle.trigger('click'); await flushPromises();
    const call = apiFetch.mock.calls.find(([url]) => url.includes('/update-policy/gmail-plugin'));
    expect(JSON.parse(call[1].body)).toEqual({ policy: 'auto' });
    expect(dispatch).toHaveBeenCalledWith('apps/fetchInstalled', { force: true });
  });
  it('uninstall asks, keeps edited items, and closes the detail', async () => {
    const { dispatch } = setup({ installed: [gmail, calendar], available: [], connected: ['google'] }); await flushPromises();
    await wrapper.find('[data-plugin="gmail-plugin"]').trigger('click'); await flushPromises();
    await detail().find('[data-action="uninstall"]').trigger('click'); await flushPromises();
    expect(confirm.mock.calls.at(-1)[0]).toMatchObject({ confirmText: 'Uninstall', message: expect.stringContaining('kept as your own') });
    expect(confirm.mock.calls.at(-1)[0].message).toContain('Your Google sign-in stays');
    const call = apiFetch.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(call[0]).toMatch(/\/plugins\/gmail-plugin\?mode=clean$/);
    expect(wrapper.text()).toContain('Gmail uninstalled.');
    expect(wrapper.find('.ap-detail').exists()).toBe(false);
    expect(dispatch).toHaveBeenCalledWith('tools/refreshAllTools');
  });
  it('names the restricted agents that were given the plugin’s tools', async () => {
    const agents = [
      { id: 1, name: 'Inbox Triage', toolAccessMode: 'restricted', assignedTools: ['gmail_api'] },
      { id: 2, name: 'Writer', toolAccessMode: 'restricted', assignedTools: ['web_search'] },
      { id: 3, name: 'Annie', toolAccessMode: 'open', assignedTools: [] },
    ];
    setup({ installed: [gmail], available: [], connected: ['google'], agents }); await flushPromises();
    await wrapper.find('[data-app="gmail-plugin"] .ap-row-open').trigger('click'); await flushPromises();
    const section = detail().find('[data-section="agents"]');
    expect(section.findAll('.ap-pill').map((p) => p.text())).toEqual(['Inbox Triage']);
    expect(section.text()).toContain('1 agent has Open tool access');
  });
});

describe('Accounts & keys', () => {
  it('lists each sign-in with what it turns on, and hands sign-in actions to the host', async () => {
    setup({ installed: [gmail, calendar, notion], available: [], connected: ['google', 'notion'], health: [{ provider: 'notion', status: 'error' }] }); await flushPromises();
    await tab('accounts').trigger('click');
    expect(wrapper.emitted('open-vault')).toHaveLength(1);
    expect(wrapper.find('[data-account="google"]').findAll('.ap-plugin-chip').map((c) => c.text())).toEqual(['Gmail', 'Google Calendar']);
    expect(wrapper.find('[data-account="notion"]').text()).toContain('API key');
    await wrapper.find('[data-account="notion"] [data-action="reconnect"]').trigger('click');
    expect(wrapper.emitted('reconnect')[0][0]).toMatchObject({ providerId: 'notion' });
    await wrapper.find('[data-service="slack"] [data-action="connect"]').trigger('click');
    expect(wrapper.emitted('connect')[0][0]).toMatchObject({ providerId: 'slack', name: 'Slack' });
    await wrapper.find('[data-filter="apikey"]').trigger('click');
    expect(wrapper.findAll('[data-account]').map((r) => r.attributes('data-account'))).toEqual(['notion']);
  });
  it('opens from the host route and leaves through it', async () => {
    setup({ installed: [gmail], available: [], connected: ['google'], props: { vaultActive: true } }); await flushPromises();
    expect(tab('accounts').attributes('aria-selected')).toBe('true');
    await tab('installed').trigger('click');
    expect(wrapper.emitted('open-plugins')).toHaveLength(1);
    await wrapper.setProps({ vaultActive: false });
    expect(tab('installed').attributes('aria-selected')).toBe('true');
  });
  it('the provider editor, custom integrations and AI model keys are one click away', async () => {
    setup({ props: { vaultActive: true } }); await flushPromises();
    await wrapper.find('[data-action="integrations"]').trigger('click');
    await wrapper.find('[data-action="add-integration"]').trigger('click');
    await wrapper.find('[data-action="ai-models"]').trigger('click');
    expect(wrapper.emitted('open-integrations')).toHaveLength(1);
    expect(wrapper.emitted('add-account')).toHaveLength(1);
    expect(wrapper.emitted('open-ai-models')).toHaveLength(1);
  });
  it('a sign-in’s detail lists its plugins, offers ones it could turn on, and signs out through the host', async () => {
    const docs = { name: 'google-docs-plugin', displayName: 'Google Docs', category: 'productivity', tools: [tool('google-docs-api', { authProvider: 'google' })] };
    const { dispatch } = setup({ installed: [gmail, calendar], available: [gmail, calendar, docs], connected: ['google'] }); await flushPromises();
    await wrapper.find('[data-card="google"] .ap-row-open').trigger('click'); await flushPromises();
    const account = detail().find('.ap-account-detail');
    expect(account.findAll('[data-section="turns-on"] [data-plugin]').map((p) => p.attributes('data-plugin'))).toEqual(['gmail-plugin', 'google-calendar-plugin']);
    await account.find('[data-section="suggested"] [data-action="install"]').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('marketplace/installPlugin', { pluginName: 'google-docs-plugin' });
    await detail().find('[data-action="disconnect"]').trigger('click');
    expect(wrapper.emitted('disconnect')[0][0]).toMatchObject({ providerId: 'google' });
    await detail().find('[data-plugin="gmail-plugin"]').trigger('click'); await flushPromises();
    expect(detail().find('.ap-detail-name').text()).toBe('Gmail');
    expect(detail().find('[data-action="open-account"]').text()).toContain('Google');
  });
});

describe('Building', () => {
  it('Build opens the Forge on the chosen view', async () => {
    const { dispatch } = setup(); await flushPromises();
    await wrapper.find('[data-action="build"]').trigger('click');
    await wrapper.find('.ap-menu [data-forge="pack-studio"]').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('connectors/setActiveTab', 'pack-studio');
    expect(wrapper.emitted('build-app')).toHaveLength(1);
    expect(wrapper.find('.ap-menu').exists()).toBe(false);
  });
  it('Built by me lists the Forge draft, your builds and your published plugins', async () => {
    const mineBuilt = { name: 'invoice-chaser', displayName: 'Invoice Chaser', category: 'finance', tools: [] };
    const minePublished = { name: 'analytics', displayName: 'Analytics', category: 'data', tools: [] };
    const { dispatch } = setup({
      installed: [gmail, mineBuilt, minePublished], available: [], built: ['invoice-chaser'],
      published: [{ asset_type: 'plugin', asset_id: 'analytics', current_version: '0.3.0' }],
      draft: { name: 'weather-thing', tools: [{}, {}] },
    }); await flushPromises();
    expect(tab('mine').text()).toContain('3');
    await tab('mine').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('marketplace/fetchMyPublishedItems');
    expect(wrapper.find('[data-draft="forge"]').text()).toContain('2 tools · not installed');
    expect(wrapper.find('[data-app="analytics"]').text()).toContain('Published · v0.3.0 is live');
    expect(wrapper.find('[data-app="invoice-chaser"]').text()).toContain('Only on this computer');
    await wrapper.find('[data-app="analytics"] [data-forge="mine"]').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('connectors/setActiveTab', 'mine');
  });
});
