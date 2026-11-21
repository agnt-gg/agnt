import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import FocusedRoutine from './FocusedRoutine.vue';

const SCHEDULE = { id: 'daily', target_type: 'goal', target_id: 'g-news', cron: '0 9 * * *', timezone: 'UTC', enabled: 1, next_run: new Date(Date.now() + 3600e3).toISOString(), run_count: 92 };
const GOAL = { id: 'g-news', title: 'AI news digest', description: 'Email me the news', status: 'validated' };
const sqliteAgo = (min) => new Date(Date.now() - min * 60e3).toISOString().replace('T', ' ').slice(0, 19);

function mountRoutine({ runs = [] } = {}) {
  const calls = [];
  const record = (name) => vi.fn(async (_, payload) => { calls.push([name, payload]); return {}; });
  const actions = { fireNow: record('fireNow'), updateSchedule: record('updateSchedule'), fetchRunHistory: vi.fn(async () => runs), fetchSchedules: () => {} };
  const reviewGoal = record('reviewGoal');
  const store = createStore({
    modules: {
      schedules: { namespaced: true, getters: { allSchedules: () => [SCHEDULE] }, actions },
      goals: { namespaced: true, getters: { allGoals: () => [GOAL] }, actions: { fetchGoals: () => {}, fetchGoalTasks: async () => null, reviewGoal } },
    },
  });
  const nav = { go: vi.fn(), toast: vi.fn(), confirm: vi.fn(), openScreen: vi.fn() };
  const wrapper = mount(FocusedRoutine, {
    props: { scheduleId: 'daily' },
    global: { plugins: [store], provide: { focusedNav: nav }, directives: { tooltip: {} }, stubs: { CustomSelect: { props: ['modelValue', 'options'], template: '<div class="custom-select"></div>' } } },
  });
  return { wrapper, nav, calls, actions };
}

describe('FocusedRoutine', () => {
  it('shows what the routine does and its runs; the editor waits for Edit', async () => {
    const { wrapper } = mountRoutine();
    await flushPromises();
    expect(wrapper.find('.page-head h1').text()).toBe('AI news digest');
    expect(wrapper.find('.page-head p').text()).toMatch(/^Every day 9:00 · next \w{3}, \d{1,2}:\d{2}$/);
    expect(wrapper.find('[data-testid="routine-what"]').text()).toBe('Email me the news');
    expect(wrapper.find('[data-testid="routine-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="routine-needs-you"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="routine-runs"]').exists()).toBe(true);

    await wrapper.find('[data-testid="routine-edit"]').trigger('click');
    const form = wrapper.find('[data-testid="routine-form"]');
    expect(form.findAll('.props > span').map((s) => s.text())).toEqual(['What it does', 'When']);
    expect(form.find('textarea').element.value).toBe('Email me the news');
  });

  it('a routine waiting on you asks its question; the answer is kept on its goal and it runs again', async () => {
    const runs = [{ id: 'r1', status: 'needs_input', fired_at: sqliteAgo(3 * 1440), error: 'Needs from you: Pull analytics: an API key', has_output: 0 }];
    const { wrapper, calls, nav } = mountRoutine({ runs });
    await flushPromises();
    const card = wrapper.find('[data-testid="routine-needs-you"]');
    expect(card.text()).toContain('Pull analytics: an API key');
    expect(card.text()).toContain('Asked 3d ago');
    expect(wrapper.find('[data-testid="routine-answer"]').attributes('disabled')).toBeDefined();
    await card.find('textarea').setValue('Use the key in Settings > Analytics');
    await card.trigger('submit');
    await flushPromises();
    expect(calls).toEqual([
      ['reviewGoal', { goalId: 'g-news', action: 'reject', feedback: 'Use the key in Settings > Analytics' }],
      ['fireNow', 'daily'],
    ]);
    expect(nav.toast).toHaveBeenCalledWith('Sent. It is running again with your answer.');
  });

  it('Active pauses at once; Save after a time change stays on the routine', async () => {
    const { wrapper, calls, nav } = mountRoutine();
    await flushPromises();
    await wrapper.find('[data-testid="routine-active"]').trigger('click');
    await flushPromises();
    expect(calls[0]).toEqual(['updateSchedule', { id: 'daily', patch: { enabled: false } }]);

    await wrapper.find('[data-testid="routine-edit"]').trigger('click');
    await wrapper.find('input[type="time"]').setValue('07:30');
    await wrapper.find('[data-testid="routine-form"]').trigger('submit');
    await flushPromises();
    expect(calls[1]).toEqual(['updateSchedule', { id: 'daily', patch: { cron: '30 7 * * *', timezone: 'UTC', enabled: true } }]);
    expect(nav.go).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="routine-form"]').exists()).toBe(false);
  });
});
