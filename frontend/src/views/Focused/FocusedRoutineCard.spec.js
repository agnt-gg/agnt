import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import FocusedRoutineCard from './FocusedRoutineCard.vue';

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const row = { id: 's1', goalId: 'g1', label: 'Chase unpaid invoices', cadence: 'Every Monday at 9:00', next: Date.now() + 86400e3, enabled: true };

function setup(runs) {
  const fireNow = vi.fn(async () => ({ fired: true }));
  const store = createStore({
    modules: {
      schedules: { namespaced: true, actions: { fetchRunHistory: vi.fn(async () => runs), fireNow } },
    },
  });
  const nav = { openScreen: vi.fn(), toast: vi.fn() };
  const wrapper = mount(FocusedRoutineCard, { props: { row }, global: { plugins: [store], provide: { focusedNav: nav } } });
  return { wrapper, nav, fireNow };
}

describe('routine card', () => {
  it('shows its real number and last three runs; a run opens its goal run', async () => {
    const runs = [
      { id: 'r1', fired_at: hoursAgo(2), status: 'completed', run_target_id: 'g1' },
      { id: 'r2', fired_at: hoursAgo(30), status: 'failed', run_target_id: 'g1' },
      { id: 'r3', fired_at: hoursAgo(200), status: 'completed', run_target_id: 'g1' },
      { id: 'r4', fired_at: hoursAgo(400), status: 'completed', run_target_id: 'g1' },
    ];
    const { wrapper, nav } = setup(runs);
    await flushPromises();
    expect(wrapper.find('.tc-kpi-v').text()).toBe('4');
    expect(wrapper.find('.tc-kpi-l').text()).toContain('75% finished');
    expect(wrapper.findAll('.tc-runrow')).toHaveLength(3);
    expect(wrapper.find('.tc-runrow .tc-rtext').text()).toBe('Done');
    await wrapper.find('.tc-runrow').trigger('click');
    expect(nav.openScreen).toHaveBeenCalledWith('GoalsScreen', { select: { kind: 'goal', id: 'g1' } });
  });

  it('Run now starts a run when nothing is pending', async () => {
    const { wrapper, fireNow } = setup([{ id: 'r1', fired_at: hoursAgo(2), status: 'completed' }]);
    await flushPromises();
    await wrapper.find('.tc-rcard-f button').trigger('click');
    await flushPromises();
    expect(fireNow).toHaveBeenCalledTimes(1);
  });

  it('while the last run waits for you, Run now opens it instead of starting another', async () => {
    const { wrapper, fireNow, nav } = setup([{ id: 'r1', fired_at: hoursAgo(1), status: 'needs_review', run_target_id: 'g-run' }]);
    await flushPromises();
    const button = wrapper.find('.tc-rcard-f button');
    expect(button.text()).toContain('Open the last run');
    expect(wrapper.find('.tc-rcard-f .tc-rtext').text()).toContain('waiting for you');
    await button.trigger('click');
    expect(fireNow).not.toHaveBeenCalled();
    expect(nav.openScreen).toHaveBeenCalledWith('GoalsScreen', { select: { kind: 'goal', id: 'g-run' } });
  });
});
