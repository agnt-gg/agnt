/**
 * In Studio, My routines / My files (and New routine, New agent) open inside the Team screen's center
 * panel instead of leaving for the Goals or Files screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createStore } from 'vuex';

const { route, push, stub } = vi.hoisted(() => {
  const { reactive, defineComponent, h } = require('vue');
  return {
    route: reactive({ fullPath: '/team', query: {} }),
    push: vi.fn(async () => {}),
    stub: (name) => defineComponent({ name, props: ['location', 'item', 'isNew'], setup: () => () => h('div', { class: name }) }),
  };
});
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push }) }));
vi.mock('@/views/One/team/useTeam.js', () => ({ useTeam: () => ({ state: { team: { id: 't' }, spaces: [], members: [], inbox: [] }, loadSpaces: vi.fn() }), teamApi: {} }));
vi.mock('@/views/One/team/OneTeamPage.vue', () => ({ default: stub('OneTeamPage') }));
vi.mock('@/views/Focused/FocusedScheduled.vue', () => ({ default: stub('FocusedScheduled') }));
vi.mock('@/views/Focused/FocusedLibrary.vue', () => ({ default: stub('FocusedLibrary') }));
vi.mock('@/views/Terminal/CenterPanel/BaseScreen.vue', () => ({
  default: defineComponent({ name: 'BaseScreen', props: ['leftPanelProps'], emits: ['panel-action'], setup: (_, { slots }) => () => h('div', { class: 'base' }, slots.default?.()) }),
}));
vi.mock('@/views/_components/common/SimpleModal.vue', () => ({ default: stub('SimpleModal') }));
import Team from './Team.vue';

const store = createStore({ getters: { 'agents/allAgents': () => [], 'schedules/allSchedules': () => [] } });
let w;
const action = async (...args) => { w.findComponent({ name: 'BaseScreen' }).vm.$emit('panel-action', ...args); await flushPromises(); };
beforeEach(() => { push.mockClear(); route.fullPath = '/team'; w = mount(Team, { global: { plugins: [store] } }); });

describe('Studio Team screen: pages open in its center panel', () => {
  it('My routines shows the routines page in the center, lights the row, and does not leave /team', async () => {
    expect(w.find('.OneTeamPage').exists()).toBe(true);
    await action('team-pick', 'mine-routines');
    expect(w.find('[data-inline="scheduled"] .FocusedScheduled').exists()).toBe(true);
    expect(w.find('.OneTeamPage').exists()).toBe(false);
    expect(w.findComponent({ name: 'BaseScreen' }).props('leftPanelProps')).toEqual({ active: 'mine-routines' });
    expect(push).not.toHaveBeenCalled();
  });
  it('My files shows the files page in the center', async () => {
    await action('team-pick', 'mine-files');
    expect(w.findComponent({ name: 'FocusedLibrary' }).props('location')).toMatchObject({ page: 'library', tab: 'files' });
    expect(w.findComponent({ name: 'BaseScreen' }).props('leftPanelProps')).toEqual({ active: 'mine-files' });
  });
  it('a teamspace row brings the team page back', async () => {
    await action('team-pick', 'mine-routines');
    await action('team-go', { view: 'space', space: 's1' });
    expect(push).toHaveBeenCalled();
    route.fullPath = '/team?view=space&space=s1';
    await flushPromises();
    expect(w.find('.OneTeamPage').exists()).toBe(true);
  });
});
