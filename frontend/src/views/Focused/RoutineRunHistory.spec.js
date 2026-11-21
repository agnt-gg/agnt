import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import RoutineRunHistory from './RoutineRunHistory.vue';

const sqliteAgo = (min) => new Date(Date.now() - min * 60e3).toISOString().replace('T', ' ').slice(0, 19);
const OUTPUT = { tasks: [{ title: 'Rank and summarize', status: 'completed', error: null, content: '## Top stories\n\n- **One** <img src=x onerror=alert(1)>', truncated: true, files: ['digest.html'] }] };

function mountHistory({ runs, outputs = {}, goal = null, runCount = runs.length }) {
  const fetchRun = vi.fn(async (_, { runId }) => ({ id: runId, output: outputs[runId] || null }));
  const fetchGoalTasks = vi.fn(async () => goal);
  const store = createStore({
    modules: {
      schedules: { namespaced: true, actions: { fetchRunHistory: async () => runs, fetchRun } },
      goals: { namespaced: true, actions: { fetchGoalTasks } },
    },
  });
  const nav = { openScreen: vi.fn() };
  const wrapper = mount(RoutineRunHistory, { props: { routine: { id: 'daily', goalId: 'g-news', runCount } }, global: { plugins: [store], provide: { focusedNav: nav } } });
  return { wrapper, fetchRun, fetchGoalTasks, nav };
}

describe('RoutineRunHistory', () => {
  it('lists every run newest first and opens the newest with what it produced, sanitised', async () => {
    const { wrapper, fetchRun, nav } = mountHistory({
      runs: [
        { id: 'old', status: 'failed', fired_at: sqliteAgo(2 * 1440), duration_ms: 5000, error: 'smtp down', has_output: 0 },
        { id: 'new', status: 'completed', fired_at: sqliteAgo(60), duration_ms: 134000, has_output: 1 },
      ],
      outputs: { new: OUTPUT },
    });
    await flushPromises();
    const rows = wrapper.findAll('[data-run]');
    expect(rows.map((r) => r.attributes('data-run'))).toEqual(['new', 'old']);
    expect(rows[0].text()).toContain('Done · 2m 14s · 1h ago');
    expect(fetchRun).toHaveBeenCalledTimes(1);
    const detail = wrapper.find('[data-testid="run-detail"]');
    expect(detail.find('h2').text()).toBe('Top stories');
    expect(detail.find('[onerror]').exists()).toBe(false);
    expect(detail.text()).toContain('digest.html');
    expect(detail.text()).toContain('Shortened here');
    expect(wrapper.find('.rr-sum').text()).toBe('2 runs · 50% finished in the last 30 days');

    // An older run from before outputs were kept says so, with its error.
    await rows[1].find('button').trigger('click');
    await flushPromises();
    const older = wrapper.find('[data-testid="run-detail"]');
    expect(older.text()).toContain('smtp down');
    expect(older.text()).toContain('finished before AGNT kept what each run produced');
    expect(fetchRun).toHaveBeenCalledTimes(1);
    await older.find('button.link').trigger('click');
    expect(nav.openScreen).toHaveBeenCalledWith('GoalsScreen', { select: { kind: 'goal', id: 'g-news' } });
  });

  it('the newest run without a kept output shows the goal’s results, when they are that run’s', async () => {
    const fired = sqliteAgo(60);
    const { wrapper, fetchGoalTasks } = mountHistory({
      runs: [{ id: 'new', status: 'completed', fired_at: fired, has_output: 0 }],
      goal: { id: 'g-news', tasks: [{ title: 'Search', status: 'completed', order_index: 1, started_at: sqliteAgo(59), output: { content: 'Found 12 stories.' } }] },
    });
    await flushPromises();
    expect(fetchGoalTasks).toHaveBeenCalledWith(expect.anything(), 'g-news');
    const detail = wrapper.find('[data-testid="run-detail"]');
    expect(detail.text()).toContain('From the routine’s latest results.');
    expect(detail.text()).toContain('Found 12 stories.');
  });

  it('shows 50 runs at a time and says when the history is cut', async () => {
    const runs = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, status: 'completed', fired_at: sqliteAgo(i * 60 + 1), has_output: 0 }));
    const { wrapper } = mountHistory({ runs, runCount: 318 });
    await flushPromises();
    expect(wrapper.findAll('[data-run]')).toHaveLength(50);
    expect(wrapper.find('.rr-sum').text()).toMatch(/^Latest 120 of 318 runs/);
    await wrapper.find('.rr-more').trigger('click');
    expect(wrapper.findAll('[data-run]')).toHaveLength(100);
  });
});
