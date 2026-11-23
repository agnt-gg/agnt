import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import MkLibrary from './MkLibrary.vue';
import MkFiles from './MkFiles.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import { LIBRARY_TABS, teamLocation } from '@/views/One/team/teamModel.js';

vi.mock('@/composables/useMarketplaceInstall', () => ({ useMarketplaceInstall: () => ({ handleInstall: vi.fn() }) }));
vi.mock('@/services/fileSystemService.js', () => ({ getTree: vi.fn(async () => ({ items: [] })) }));

// The Library shows every kind of asset you own, your files and the Market; there are no "Templates".
function mountLibrary(tab, { agents = [], workflows = [], picks = {}, dir } = {}) {
  const dispatch = vi.fn(async () => {});
  const store = createStore({
    state: { marketplace: { myInstalls: [] } },
    getters: {
      'agents/allAgents': () => agents, 'workflows/allWorkflows': () => workflows, 'tools/customTools': () => [],
      'skills/allSkills': () => [], 'widgetDefinitions/allDefinitions': () => [],
      'marketplace/shelfItems': () => [], 'marketplace/shelfStatus': () => 'ready',
      'marketplace/shelfItemsByType': () => (type) => picks[type] || [],
    },
  });
  store.dispatch = dispatch;
  const ctx = { go: vi.fn(), openLibrary: vi.fn(), openMarket: vi.fn(), toast: vi.fn() };
  const wrapper = mount(MkLibrary, { props: { tab, dir }, global: { plugins: [store], provide: { teamCtx: ctx }, directives: { tooltip: {} }, stubs: { SimpleModal: true } } });
  return { wrapper, dispatch, ctx };
}

describe('Library', () => {
  it('has a tab for every asset kind, Files and the Market; no Templates, and Connections live on Apps', () => {
    expect(LIBRARY_TABS.map((t) => t.id)).toEqual(['agents', 'workflows', 'tools', 'skills', 'widgets', 'files', 'market']);
    expect(teamLocation({ view: 'library', tab: 'templates' }).tab).toBe('agents');
    expect(teamLocation({ view: 'library', tab: 'connections' }).tab).toBe('agents');
    const { wrapper } = mountLibrary('agents');
    // Your own kinds as tabs; the Market, somewhere to get more, as a link after them.
    expect(wrapper.findAll('.tabs .tab').map((b) => b.text().replace(/\d+$/, ''))).toEqual(['Agents', 'Workflows', 'Tools', 'Skills', 'Widgets', 'Files', 'Get more from the Market']);
    expect(wrapper.get('.tabs .v2-tab-link').attributes('data-tab')).toBe('market');
  });
  it('Files shows your workspace in the page, at the folder the route names', async () => {
    const { wrapper, ctx } = mountLibrary('files', { dir: 'Reports' });
    await flushPromises();
    expect(wrapper.find('.tabs .tab.is-active').text()).toBe('Files');
    expect(wrapper.findComponent(MkFiles).props('dir')).toBe('Reports');
    expect(wrapper.findComponent(MarketplaceShelf).exists()).toBe(false);
    expect(wrapper.find('.page-head .primary').exists()).toBe(false);
    await wrapper.findAll('.tabs .tab').find((b) => b.text().startsWith('Files')).trigger('click');
    expect(ctx.go).toHaveBeenCalledWith({ view: 'library', tab: 'files' });
  });
  it('loads every kind so each tab shows its real count', async () => {
    const { wrapper, dispatch } = mountLibrary('agents', { agents: [{ id: 'a1', name: 'Scout' }], workflows: [{ id: 'w1', name: 'Brief' }, { id: 'w2', name: 'Chase' }] });
    await flushPromises();
    for (const action of ['agents/fetchAgents', 'workflows/fetchWorkflows', 'tools/fetchTools', 'skills/fetchSkills', 'widgetDefinitions/fetchDefinitions']) expect(dispatch).toHaveBeenCalledWith(action);
    const count = (label) => wrapper.findAll('.tabs .tab').find((b) => b.text().startsWith(label)).find('.count').text();
    expect(count('Agents')).toBe('1');
    expect(count('Workflows')).toBe('2');
  });
  it('shows your workflows as cards that open in their editor, with New workflow', async () => {
    const { wrapper, ctx } = mountLibrary('workflows', { workflows: [{ id: 'w1', name: 'Morning brief', description: 'Emails the day', status: 'listening' }] });
    await flushPromises();
    const card = wrapper.find('.cards .card');
    expect(card.text()).toContain('Morning brief');
    expect(card.text()).toContain('Running');
    await card.trigger('click');
    expect(ctx.openLibrary).toHaveBeenCalledWith('workflows', 'w1');
    await wrapper.find('.page-head .primary').trigger('click');
    expect(ctx.openLibrary).toHaveBeenLastCalledWith('workflows', null, true);
  });
  it('searches and sorts your own, with one create button and badges only for exceptions', async () => {
    localStorage.clear();
    const { wrapper } = mountLibrary('workflows', { workflows: [
      { id: 'w1', name: 'Brief', status: 'stopped', created_at: '2026-01-01 09:00:00', updated_at: '2026-11-20 12:00:00' },
      { id: 'w2', name: 'Archive', status: 'error', created_at: '2026-06-01 09:00:00', updated_at: '2026-06-02 09:00:00' },
      { id: 'w3', name: 'Chase', status: 'listening' },
    ] });
    await flushPromises();
    const names = () => wrapper.findAll('.cards .card h4').map((n) => n.text());
    expect(names()).toEqual(['Archive', 'Brief', 'Chase']);
    expect(wrapper.findAll('[data-testid="library-bar"] .seg button').map((b) => b.text())).toEqual(['Name', 'Recently changed', 'Newest']);
    await wrapper.find('[data-sort="recent"]').trigger('click');
    expect(names()).toEqual(['Brief', 'Archive', 'Chase']);
    expect(localStorage.getItem('agnt:library-sort')).toBe('recent');
    // A stopped workflow is normal; only running and needing a look get a badge.
    expect(wrapper.findAll('.cards .card .tag').map((t) => t.text())).toEqual(['Needs a look', 'Running']);
    // One way to make another: the page's button, no dashed card.
    expect(wrapper.find('[data-action="new-asset"]').exists()).toBe(false);
    await wrapper.find('[data-testid="library-bar"] input').setValue('arch');
    expect(names()).toEqual(['Archive']);
    await wrapper.find('[data-testid="library-bar"] input').setValue('zzz');
    expect(wrapper.text()).toContain('No workflows match “zzz”.');
    await wrapper.find('[data-action="clear-search"]').trigger('click');
    expect(names()).toHaveLength(3);
    // With your own to show, the Market picks step aside (the Market tab has them).
    expect(wrapper.findComponent(MarketplaceShelf).exists()).toBe(false);
  });
  it('each kind shows its Market picks when you have none, so the empty list has examples to add', async () => {
    const { wrapper } = mountLibrary('agents', { picks: { agent: [{ id: 'l1', asset_id: 'scout', name: 'Lead Scout', asset_type: 'agent' }] } });
    await flushPromises();
    const shelf = wrapper.findComponent(MarketplaceShelf);
    expect(shelf.exists()).toBe(true);
    expect(shelf.props()).toMatchObject({ assetType: 'agent', variant: 'catalogue', dismissible: false });
    expect(wrapper.text()).toContain('No agents yet. Make one, or add one from the picks below.');
  });
  it('with no picks for that kind, the empty list points at the Market instead', async () => {
    const { wrapper } = mountLibrary('skills');
    await flushPromises();
    expect(wrapper.findComponent(MarketplaceShelf).props('assetType')).toBe('skill');
    expect(wrapper.text()).toContain('No skills yet. Make one, or add one from the Market.');
  });
  it('opening a pick goes to its Market listing', async () => {
    const { wrapper, ctx } = mountLibrary('agents');
    wrapper.findComponent(MarketplaceShelf).vm.$emit('browse', { id: 'l1', asset_id: 'scout' });
    expect(ctx.openMarket).toHaveBeenCalledWith('scout');
  });
  it('the Market loads the catalog only when opened', async () => {
    const { dispatch } = mountLibrary('market');
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('marketplace/fetchShelfItems', {});
  });
});
