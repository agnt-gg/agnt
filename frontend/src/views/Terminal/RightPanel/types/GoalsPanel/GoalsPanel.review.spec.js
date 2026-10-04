/**
 * The review section must show the evaluator's verdict and every check's
 * proof, for a goal in review.
 *
 * Reproduces the real bug: the panel captured the goal when it was opened;
 * the evaluation arrived later on a NEW store object, so the checklist stayed
 * "Checked automatically when the work is evaluated" on an evaluated goal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const ROOT = 'C:/Users/Studio/AppData/Roaming/AGNT/projects';
const REPORT = `${ROOT}/agnt-gg-seo/weekly/2026-09-14.md`;
const out = (content, writes) => JSON.stringify({ content, toolExecutions: writes.map((path) => ({ name: 'edit_file', arguments: { path } })) });
const snapshot = () => ({
  id: 'g1',
  title: 'Weekly SEO review',
  status: 'needs_review',
  success_criteria: { deliverables: ['Dated report at C:\\…\\agnt-gg-seo\\weekly\\<week_start>.md'], qualityChecks: ['Receipts table scoring every shipped change'] },
  tasks: [
    { id: 't1', title: 'Verify cron ran', status: 'completed', output: out([{ type: 'text', text: 'checked' }], [`${ROOT}/seo-ro-probe.mjs`]) },
    { id: 't2', title: 'Score every receipt', status: 'completed', output: out([{ type: 'text', text: 'done' }], [REPORT]) },
  ],
});
const evaluation = {
  overall_score: 90.8,
  evaluation_data: {
    checklist: [
      { id: 'c1', text: 'Dated report at C:\\…\\agnt-gg-seo\\weekly\\<week_start>.md', met: true, evidence: 'Task 2 wrote agnt-gg-seo\\weekly\\2026-09-14.md.' },
      { id: 'c2', text: 'Receipts table scoring every shipped change', met: false, evidence: 'Task 1 left C4 without a delta.' },
    ],
  },
};

const state = reactive({ goals: [] });
const store = {
  state,
  getters: reactive({
    'goals/getGoalById': (id) => state.goals.find((g) => g.id === id),
    'goals/allGoals': [],
    'goals/getIterations': () => [],
    'goals/getLiveIteration': () => null,
    'goals/getGoalProgress': () => 100,
  }),
  dispatch: vi.fn(async (action, id) => {
    if (action === 'goals/fetchGoalEvaluation') {
      // Exactly what the store does: a NEW object replaces the old one.
      const i = state.goals.findIndex((g) => g.id === id);
      state.goals.splice(i, 1, { ...state.goals[i], evaluation });
    }
  }),
};
vi.mock('vuex', async (orig) => ({ ...(await orig()), useStore: () => store }));
const getFile = vi.hoisted(() => vi.fn());
vi.mock('@/services/fileSystemService.js', () => ({ getFile }));
const openLocalPath = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/utils/openLocalFile.js', () => ({ openLocalPath }));

import GoalsPanel from './GoalsPanel.vue';

function mountPanel() {
  const goal = snapshot();
  state.goals = [goal];
  return mount(GoalsPanel, {
    props: { selectedGoalId: 'g1', goals: [goal] },
    global: { stubs: { Tooltip: { template: '<span><slot /></span>' }, ArtifactCards: true, BoundedJson: true, ListSummaryPanel: true, BaseButton: true }, directives: { tooltip: {} } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFile.mockResolvedValue({ content: '# Weekly\n## Receipts\n| change | delta |\n|---|---|\n| C4 | |\n## Headline\nok' });
});

describe('reviewing a goal', () => {
  it('shows the evaluation that arrived after the goal was opened', async () => {
    const w = mountPanel();
    await flushPromises();
    expect(w.text()).not.toContain('Not checked yet');
    expect(w.find('.review-verdict').text()).toContain('1 of 2 checks met');
    expect(w.find('.review-verdict').text()).toContain('evaluator score 91%');
    expect(w.find('.review-verdict').text()).toContain('Not met: Receipts table');
    expect(w.findAll('.goal-checklist li.is-met')).toHaveLength(1);
    expect(w.find('.goal-checklist li.is-missed .check-tag').text()).toBe('Not met');
    w.unmount();
  });

  it('shows the deliverable, readable here, apart from scratch files', async () => {
    const w = mountPanel();
    await flushPromises();
    expect(getFile).toHaveBeenCalledWith(REPORT);
    expect(w.find('.goal-deliverable .review-file').text()).toContain('2026-09-14.md');
    expect(w.find('.review-preview').html()).toContain('Receipts');
    expect(w.find('.review-other summary').text()).toBe('Other files it wrote · 1');
    await w.find('.goal-deliverable .raw-toggle').trigger('click');
    expect(openLocalPath).toHaveBeenCalledWith(REPORT);
    w.unmount();
  });

  it('every check carries its proof: the task, the file, the report section', async () => {
    const w = mountPanel();
    await flushPromises();
    // Unmet checks come first: they are what the reviewer must decide on.
    const [missed, met] = w.findAll('.goal-checklist li');
    expect(missed.classes()).toContain('is-missed');
    expect(met.findAll('.proof-chip').map((c) => c.text())).toEqual(['Task 2 · Score every receipt', '2026-09-14.md']);
    const chips = missed.findAll('.proof-chip').map((c) => c.text());
    expect(chips).toEqual(['Task 1 · Verify cron ran', 'Receipts in the report']);
    await missed.findAll('.proof-chip')[1].trigger('click');
    expect(missed.find('.check-excerpt').html()).toContain('C4');
    expect(missed.find('.check-excerpt-head').text()).toBe('From 2026-09-14.md · Receipts');
    await missed.find('.detail-close-btn').trigger('click');
    expect(missed.find('.check-excerpt').exists()).toBe(false);
    w.unmount();
  });

  it('a task chip opens the work on that task', async () => {
    const w = mountPanel();
    await flushPromises();
    Element.prototype.scrollIntoView = vi.fn();
    await w.findAll('.goal-checklist li')[0].find('.proof-chip').trigger('click');
    await flushPromises();
    expect(w.find('.goal-work').attributes('open')).toBeDefined();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    w.unmount();
  });

  it('before evaluation it says so, and the unchecked plan is shown', async () => {
    store.dispatch.mockImplementation(async () => {});
    const w = mountPanel();
    await flushPromises();
    expect(w.find('.review-verdict').text()).toContain('Not checked yet');
    expect(w.findAll('.goal-checklist li.is-open')).toHaveLength(2);
    w.unmount();
  });
});
