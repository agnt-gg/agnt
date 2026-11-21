import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import RoutineRunHistory from './RoutineRunHistory.vue';

const sqliteAgo = (min) => new Date(Date.now() - min * 60e3).toISOString().replace('T', ' ').slice(0, 19);
const OUTPUT = { tasks: [
  { title: 'Search', status: 'completed', error: null, content: 'Found 12 stories.', truncated: false, files: [] },
  { title: 'Rank and summarize', status: 'completed', error: null, content: '## Top stories\n\n- **One** <img src=x onerror=alert(1)>', truncated: false, files: [] },
] };

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
  it('one line per run; the newest opens on its result, steps one click further', async () => {
    const { wrapper, fetchRun } = mountHistory({
      runs: [
        { id: 'old', status: 'failed', fired_at: sqliteAgo(2 * 1440), duration_ms: 5000, error: 'smtp down', has_output: 0 },
        { id: 'new', status: 'completed', fired_at: sqliteAgo(60), duration_ms: 134000, has_output: 1 },
      ],
      outputs: { new: OUTPUT },
    });
    await flushPromises();
    const rows = wrapper.findAll('[data-run]');
    expect(rows.map((r) => r.attributes('data-run'))).toEqual(['new', 'old']);
    expect(rows[0].find('.rr-status').text()).toBe('Done · 2m 14s');
    expect(wrapper.find('.rr-sum').text()).toBe('2 runs · 50% finished');
    expect(fetchRun).toHaveBeenCalledTimes(1);

    const result = wrapper.find('[data-testid="run-result"]');
    expect(result.find('h2').text()).toBe('Top stories');
    expect(result.find('[onerror]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Found 12 stories.');
    await wrapper.find('.rr-steps-toggle').trigger('click');
    expect(wrapper.find('[data-testid="run-steps"]').text()).toContain('Found 12 stories.');

    // A run from before results were kept says so, with its error, and links to Goals.
    await rows[1].find('button').trigger('click');
    await flushPromises();
    const older = wrapper.find('[data-testid="run-detail"]');
    expect(older.text()).toContain('smtp down');
    expect(older.text()).toContain('before AGNT kept each run’s result');
  });

  it('the newest run without a kept result shows the goal’s, when they are that run’s', async () => {
    const { wrapper, fetchGoalTasks } = mountHistory({
      runs: [{ id: 'new', status: 'completed', fired_at: sqliteAgo(60), has_output: 0 }],
      goal: { id: 'g-news', tasks: [{ title: 'Search', status: 'completed', order_index: 1, started_at: sqliteAgo(59), output: { content: 'Found 12 stories.' } }] },
    });
    await flushPromises();
    expect(fetchGoalTasks).toHaveBeenCalledWith(expect.anything(), 'g-news');
    expect(wrapper.find('[data-testid="run-result"]').text()).toBe('Found 12 stories.');
  });

  it('shows 50 runs at a time and reports them to the page', async () => {
    const runs = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, status: 'completed', fired_at: sqliteAgo(i * 60 + 1), has_output: 0 }));
    const { wrapper } = mountHistory({ runs, runCount: 318 });
    await flushPromises();
    expect(wrapper.findAll('[data-run]')).toHaveLength(50);
    expect(wrapper.find('.rr-sum').text()).toMatch(/^318 runs/);
    expect(wrapper.emitted('loaded')[0][0]).toHaveLength(120);
    await wrapper.find('.rr-more').trigger('click');
    expect(wrapper.findAll('[data-run]')).toHaveLength(100);
  });
});
