import { it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/services/fileSystemService.js', () => ({ getTree: vi.fn(async () => ({ items: new Array(42).fill({ name: 'x', type: 'file' }) })) }));
vi.mock('@/views/Terminal/_components/MarketplaceShelf.vue', () => ({ default: { template: '<div></div>' } }));
const { default: FocusedLibrary } = await import('./FocusedLibrary.vue');

it('every Library tab has a count, Files included', async () => {
  const list = (n) => () => new Array(n).fill(0).map((_, i) => ({ id: String(i), name: `Item ${i}` }));
  const store = createStore({
    modules: {
      agents: { namespaced: true, getters: { allAgents: list(3) }, actions: { fetchAgents: () => {} } },
      workflows: { namespaced: true, getters: { allWorkflows: list(2) }, actions: { fetchWorkflows: () => {} } },
      tools: { namespaced: true, getters: { customTools: list(1) }, actions: { fetchTools: () => {} } },
      skills: { namespaced: true, getters: { allSkills: list(4) }, actions: { fetchSkills: () => {} } },
      widgetDefinitions: { namespaced: true, getters: { allDefinitions: list(5) }, actions: { fetchDefinitions: () => {} } },
      marketplace: { namespaced: true, getters: { myPublishedItems: () => [] }, actions: { fetchMyPublishedItems: () => {} } },
    },
  });
  const wrapper = mount(FocusedLibrary, {
    props: { location: { page: 'library', tab: 'agents' } },
    global: { plugins: [store], provide: { focusedNav: { go: vi.fn(), ask: vi.fn() } }, directives: { tooltip: {} }, stubs: { FocusedPage: { template: '<div><slot name="tabs" /><slot /></div>' } } },
  });
  await flushPromises();
  const counts = Object.fromEntries(wrapper.findAll('button').filter((b) => b.find('.focused-count').exists()).map((b) => [b.text().replace(/[\d,]+$/, '').trim(), b.find('.focused-count').text()]));
  expect(counts).toEqual({ Agents: '3', Workflows: '2', Tools: '1', Skills: '4', Widgets: '5', Files: '42' });
});
