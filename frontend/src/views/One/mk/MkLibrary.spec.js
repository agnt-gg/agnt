import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import MkLibrary from './MkLibrary.vue';
import { LIBRARY_TABS, teamLocation } from '@/views/One/team/teamModel.js';

vi.mock('@/composables/useMarketplaceInstall', () => ({ useMarketplaceInstall: () => ({ handleInstall: vi.fn() }) }));

// The Library shows every kind of asset you own, Connections and the Market; there are no "Templates".
function mountLibrary(tab, { agents = [], workflows = [] } = {}) {
  const dispatch = vi.fn(async () => {});
  const store = createStore({
    state: { marketplace: { myInstalls: [] } },
    getters: {
      'agents/allAgents': () => agents, 'workflows/allWorkflows': () => workflows, 'tools/customTools': () => [],
      'skills/allSkills': () => [], 'widgetDefinitions/allDefinitions': () => [],
      'marketplace/shelfItems': () => [], 'marketplace/shelfStatus': () => 'ready',
    },
  });
  store.dispatch = dispatch;
  const ctx = { go: vi.fn(), openLibrary: vi.fn(), toast: vi.fn() };
  const wrapper = mount(MkLibrary, { props: { tab }, global: { plugins: [store], provide: { teamCtx: ctx }, directives: { tooltip: {} }, stubs: { SimpleModal: true } } });
  return { wrapper, dispatch, ctx };
}

describe('Library', () => {
  it('has a tab for every asset kind and the Market; no Templates, and Connections live on Apps', () => {
    expect(LIBRARY_TABS.map((t) => t.id)).toEqual(['agents', 'workflows', 'tools', 'skills', 'widgets', 'market']);
    expect(teamLocation({ view: 'library', tab: 'templates' }).tab).toBe('agents');
    expect(teamLocation({ view: 'library', tab: 'connections' }).tab).toBe('agents');
    const { wrapper } = mountLibrary('agents');
    expect(wrapper.findAll('.tabs .tab').map((b) => b.text().replace(/\d+$/, ''))).toEqual(['Agents', 'Workflows', 'Tools', 'Skills', 'Widgets', 'Market']);
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
  it('the Market loads the catalog only when opened', async () => {
    const { dispatch } = mountLibrary('market');
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('marketplace/fetchShelfItems', {});
  });
});
