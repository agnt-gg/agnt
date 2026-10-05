import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent } from 'vue';
import AppsSection from './AppsSection.vue';
import { apiFetch } from '@/utils/apiFetch.js';

vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: vi.fn() }));
const confirm = vi.fn();
const modalStub = defineComponent({ setup(_, { expose }) { expose({ showModal: confirm }); return () => null; } });
const available = [
  { name: 'research', displayName: 'Research', category: 'research', agents: [{ slug: 'researcher' }], tools: [{ type: 'search', schema: { title: 'Search', authProvider: 'google' } }], widgets: [{ slug: 'board' }], skills: [{ slug: 'source-check' }], workflows: [{ slug: 'digest' }] },
  { name: 'calculator', displayName: 'Calculator', category: 'utility', tools: [] },
];
let wrapper;
function setup(options = {}) {
  const store = createStore({ modules: {
    apps: { namespaced: true, state: () => ({ installed: options.installed || [], available: options.available || available, error: null }), getters: { installed: s => s.installed, available: s => s.available } },
    appAuth: { namespaced: true, state: () => ({ allProviders: [{ id: 'google', name: 'Google' }], connectionHealth: { providers: [] } }), getters: { connectedApps: () => options.connected || [] } },
    widgetDefinitions: { namespaced: true, getters: { allDefinitions: () => [{ id: 'w1' }] } },
  } });
  const dispatch = vi.spyOn(store, 'dispatch').mockImplementation(async (action, payload) => {
    if (action === 'marketplace/checkPurchaseStatus') return false;
    if (action === 'marketplace/installPlugin') {
      if (options.failInstall) throw new Error('Download failed');
      store.state.apps.installed.push({ ...available.find(p => p.name === payload.pluginName) });
    }
    return [];
  });
  wrapper = mount(AppsSection, { global: { plugins: [store], stubs: { SimpleModal: modalStub, SvgIcon: { template: '<span />' } } } });
  return { store, dispatch };
}
async function open(name = 'research') { await flushPromises(); await wrapper.find(`[data-app="${name}"] .card-title`).trigger('click'); await flushPromises(); }
beforeEach(() => {
  vi.clearAllMocks(); confirm.mockResolvedValue(true);
  apiFetch.mockImplementation(async url => ({ ok: true, json: async () => url.includes('/inspect/') ? { success: true, valid: true, integrityState: 'verified', detected: {}, trustTier: 'community' } : { success: true, assets: [] } }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

describe('Studio Apps catalog and detail', () => {
  it('shows uninstalled no-auth packages, filters, resets empty search and switches Installed', async () => {
    setup({ installed: [available[1]] }); await flushPromises();
    expect(wrapper.findAll('.apps-card')).toHaveLength(2);
    await wrapper.find('input').setValue('nothing-matches'); expect(wrapper.text()).toContain('No matching plugins');
    await wrapper.find('.apps-empty button').trigger('click'); expect(wrapper.findAll('.apps-card')).toHaveLength(2);
    await wrapper.findAll('.apps-nav nav button')[1].trigger('click'); expect(wrapper.findAll('.apps-card')).toHaveLength(1);
    expect(wrapper.find('.apps-card').text()).toContain('Calculator');
  });
  it('shows all five inventory types and delegates real connections to Connectors', async () => {
    setup(); await open();
    expect(wrapper.findAll('.asset-group')).toHaveLength(5);
    expect(wrapper.text()).toContain('Researcher');
    await wrapper.find('.app-connection button').trigger('click');
    expect(wrapper.emitted('connect')[0][0]).toMatchObject({ providerId: 'google', name: 'Google' });
    expect(wrapper.text()).not.toContain('Already connected');
  });
  it('inspects and asks consent before invoking the existing installer exactly once', async () => {
    const { dispatch } = setup(); await open(); await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/plugins/inspect/research'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('full access'), confirmText: 'Install plugin' }));
    expect(dispatch.mock.calls.filter(([a]) => a === 'marketplace/installPlugin')).toEqual([['marketplace/installPlugin', { pluginName: 'research' }]]);
    expect(wrapper.text()).toContain('Research installed.');
    expect(wrapper.text()).toContain('Manage installed plugin');
  });
  it('admits only one install while an inspection is pending', async () => {
    let resolveInspection;
    apiFetch.mockReturnValue(new Promise(resolve => { resolveInspection = resolve; }));
    const { dispatch } = setup(); await open();
    await wrapper.find('.apps-primary').trigger('click');
    await wrapper.find('.apps-primary').trigger('click');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    resolveInspection({ ok: true, json: async () => ({ success: true, valid: true, integrityState: 'verified' }) });
    await flushPromises();
    expect(dispatch.mock.calls.filter(([action]) => action === 'marketplace/installPlugin')).toHaveLength(1);
  });
  it('does not install on cancelled consent', async () => {
    confirm.mockResolvedValue(false); const { dispatch } = setup(); await open(); await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it.each(['mismatch', 'unavailable'])('blocks install on %s inspection and shows an actionable error', async (state) => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => state === 'mismatch' ? { success: true, integrityState: 'mismatch' } : { success: false, error: 'Inspection unavailable' } });
    const { dispatch } = setup(); await open(); await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it('shows an install failure without changing the installed count or claiming success', async () => {
    setup({ failInstall: true }); await open(); await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Download failed');
    expect(wrapper.text()).not.toContain('Research installed.');
    expect(wrapper.find('.apps-primary').attributes('disabled')).toBeUndefined();
  });
  it('paid apps use purchase checkout rather than bypassing it', async () => {
    const { dispatch } = setup({ available: [{ ...available[0], price: 9, marketplace_item_id: 'item1' }] });
    await open(); await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('marketplace/purchaseItem', { itemId: 'item1' });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(dispatch.mock.calls.some(([a]) => a === 'marketplace/installPlugin')).toBe(false);
  });
  it('opens only a widget whose installed ID is in the existing widget store', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, assets: [{ asset_type: 'widget', asset_slug: 'board', local_id: 'w1' }] }) });
    setup({ installed: [available[0]] }); await open();
    const widgetGroup = wrapper.findAll('.asset-group')[2];
    await widgetGroup.find('button').trigger('click');
    expect(wrapper.emitted('open-widget')).toEqual([['w1']]);
    expect(widgetGroup.findAll('.asset-item')).toHaveLength(1);
  });
  it('ignores late asset responses when another package is selected', async () => {
    let resolve;
    apiFetch.mockReturnValue(new Promise(r => { resolve = r; }));
    setup({ installed: [available[0]] }); await open(); await wrapper.find('.apps-back').trigger('click'); await open('calculator');
    resolve({ ok: true, json: async () => ({ success: true, assets: [{ asset_type: 'widget', asset_slug: 'stale-widget', local_id: 'w1' }] }) });
    await flushPromises(); expect(wrapper.text()).not.toContain('Stale Widget'); expect(wrapper.find('.detail-identity').text()).toContain('Calculator');
  });
  it('shows load failures without erasing cached packages', async () => {
    const { dispatch } = setup(); await flushPromises();
    dispatch.mockRejectedValue(new Error('Network unavailable'));
    // Trigger a failed install to expose retry; the subsequent retry refresh must preserve the catalog.
    await open(); await wrapper.find('.apps-primary').trigger('click'); await flushPromises();
    await wrapper.find('[role="alert"] button').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Network unavailable');
    await wrapper.find('.apps-back').trigger('click'); expect(wrapper.findAll('.apps-card')).toHaveLength(2);
  });
});
