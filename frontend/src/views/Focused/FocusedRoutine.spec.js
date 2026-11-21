import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import FocusedRoutine from './FocusedRoutine.vue';

const SCHEDULE = { id: 'daily', target_type: 'goal', target_id: 'g-news', cron: '0 9 * * *', timezone: 'UTC', enabled: 1, next_run: new Date(Date.now() + 3600e3).toISOString(), run_count: 92 };
const GOAL = { id: 'g-news', title: 'AI news digest', description: 'Email me the news', status: 'validated' };

function mountRoutine() {
  const fireNow = vi.fn(async () => ({ runId: 'r9' }));
  const updateSchedule = vi.fn(async () => {});
  const fetchRunHistory = vi.fn(async () => []);
  const store = createStore({
    modules: {
      schedules: { namespaced: true, getters: { allSchedules: () => [SCHEDULE] }, actions: { fireNow, updateSchedule, fetchRunHistory, fetchSchedules: () => {} } },
      goals: { namespaced: true, getters: { allGoals: () => [GOAL] }, actions: { fetchGoals: () => {}, fetchGoalTasks: async () => null } },
    },
  });
  const nav = { go: vi.fn(), toast: vi.fn(), confirm: vi.fn(), openScreen: vi.fn() };
  const wrapper = mount(FocusedRoutine, { props: { scheduleId: 'daily' }, global: { plugins: [store], provide: { focusedNav: nav }, stubs: { CustomSelect: { props: ['modelValue', 'options'], template: '<div class="custom-select"></div>' } } } });
  return { wrapper, nav, fireNow, updateSchedule, fetchRunHistory };
}

describe('FocusedRoutine', () => {
  it('is one compact card under the routine’s name, with its runs below', async () => {
    const { wrapper } = mountRoutine();
    await flushPromises();
    expect(wrapper.find('.page-head h1').text()).toBe('AI news digest');
    expect(wrapper.find('.page-head p').text()).toMatch(/^Every day 9:00 · next \w{3}, \d{1,2}:\d{2}$/);
    const form = wrapper.find('[data-testid="routine-form"]');
    expect(form.findAll('.props > span').map((s) => s.text())).toEqual(['What it does', 'When', 'Active']);
    expect(form.find('textarea').element.value).toBe('Email me the news');
    expect(wrapper.find('[data-testid="routine-runs"]').exists()).toBe(true);
  });

  it('Run now fires the routine and refreshes its runs; Save keeps the same goal when only the time changed', async () => {
    const { wrapper, fireNow, fetchRunHistory, updateSchedule, nav } = mountRoutine();
    await flushPromises();
    expect(fetchRunHistory).toHaveBeenCalledTimes(1);
    await wrapper.find('[data-testid="routine-run-now"]').trigger('click');
    await flushPromises();
    expect(fireNow).toHaveBeenCalledWith(expect.anything(), 'daily');
    expect(fetchRunHistory).toHaveBeenCalledTimes(2);

    await wrapper.find('input[type="time"]').setValue('07:30');
    await wrapper.find('[data-testid="routine-form"]').trigger('submit');
    await flushPromises();
    expect(updateSchedule).toHaveBeenCalledWith(expect.anything(), { id: 'daily', patch: { cron: '30 7 * * *', timezone: 'UTC', enabled: true } });
    expect(nav.go).toHaveBeenCalledWith({ page: 'scheduled' });
  });
});
