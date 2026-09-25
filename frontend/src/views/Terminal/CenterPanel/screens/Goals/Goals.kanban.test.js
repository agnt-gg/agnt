import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import Goals from './Goals.vue';
import GoalCard from './components/GoalCard.vue';
import { readFileSync } from 'node:fs';
import GoalsToolbar from './components/GoalsToolbar.vue';
import GoalsPanel from '@/views/Terminal/RightPanel/types/GoalsPanel/GoalsPanel.vue';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
const sampleGoals = [
  { id: 'idea', title: 'Incoming idea', status: 'planning', task_count: 0 },
  { id: 'plan', title: 'Prepared plan', status: 'planning', task_count: 2 },
  { id: 'build', title: 'Active build', status: 'executing' },
  { id: 'review', title: 'Candidate result', status: 'needs_review', current_iteration: 1 },
  { id: 'done', title: 'Accepted result', status: 'validated' },
  { id: 'retry', title: 'Queued repair', status: 'queued' },
  { id: 'failed', title: 'Needs repair', status: 'failed' },
];
const wrappers = [];
const stubs = {
  BaseScreen: { template: '<main><slot /></main>', methods: { scrollToBottom() {}, triggerPanelMethod() {} } },
  GoalsPanel: { template: '<aside>Goal detail</aside>' },
  Tooltip: { template: '<span><slot /></span>' },
  CustomSelect: true, SimpleModal: true, ScheduleGoalModal: true,
};
function setup(component, props = {}, goals = sampleGoals, extraStubs = {}) {
  const store = createStore({
    getters: {
      'goals/allGoals': () => goals,
      'goals/isLoading': () => false,
      'goals/isCreatingGoal': () => false,
      'goals/getLiveIteration': () => () => null,
      'goals/getGoalTaskProgress': () => () => null,
      'goals/getGoalById': () => (id) => goals.find((goal) => goal.id === id),
      'goals/getIterations': () => () => [],
    },
  });
  const dispatch = vi.spyOn(store, 'dispatch').mockResolvedValue({ status: 'validated', message: 'Result accepted' });
  const wrapper = mount(component, {
    props,
    global: { plugins: [store], stubs: { ...stubs, ...extraStubs }, directives: { tooltip: () => {} } },
  });
  wrappers.push(wrapper);
  return { wrapper, dispatch };
}
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.restoreAllMocks(); });

describe('Goals five-column board', () => {
  it('renders the exact order, keeps all goals visible, and keeps failures out of Done', () => {
    const { wrapper } = setup(Goals);
    expect(wrapper.findAll('.column-header h3').map((heading) => heading.text())).toEqual(['To do', 'Plan', 'Build', 'Review', 'Done']);
    expect(wrapper.findAllComponents(GoalCard)).toHaveLength(sampleGoals.length);
    expect(wrapper.find('[data-stage="build"]').text()).toContain('Queued repair');
    expect(wrapper.find('[data-stage="build"]').text()).toContain('Needs repair');
    expect(wrapper.find('[data-stage="done"]').text()).not.toContain('Needs repair');
  });

  it('filters with the same stage counts and searches without hiding unknown states', async () => {
    const { wrapper } = setup(Goals);
    const toolbar = wrapper.findComponent(GoalsToolbar);
    const attention = toolbar.findAll('.filter-chip').find((chip) => chip.text().includes('Needs my review'));
    expect(attention.text()).toContain('2');
    await attention.trigger('click');
    expect(wrapper.findAllComponents(GoalCard).map((card) => card.props('goal').id)).toEqual(['plan', 'review']);
    await toolbar.find('input').setValue('Candidate');
    expect(wrapper.findAllComponents(GoalCard).map((card) => card.props('goal').id)).toEqual(['review']);
  });

  it('opens the existing detail exactly once from the new action and returns to the board', async () => {
    const { wrapper, dispatch } = setup(Goals);
    await wrapper.find('[data-stage="plan"] .card-primary-action').trigger('click');
    await flushPromises();
    expect(wrapper.find('.goal-detail-view').exists()).toBe(true);
    expect(dispatch.mock.calls.filter(([action]) => action === 'goals/fetchGoalTasks')).toEqual([['goals/fetchGoalTasks', 'plan']]);
    await wrapper.find('.goal-detail-back').trigger('click');
    expect(wrapper.findAll('[data-stage]')).toHaveLength(5);
  });

  // The header used to be one wrapping flex row: the chips sat on flex:1 and
  // shoved "New goal" onto a second line UNDER a search box that stretched to
  // fill the window. The primary action must sit on the top line, above the
  // filters, and the search box must not be the thing that grows.
  it('puts the primary action on the head row, above a search box that does not stretch', () => {
    const { wrapper } = setup(Goals);
    const toolbar = wrapper.findComponent(GoalsToolbar);

    const head = toolbar.find('.gt-head');
    expect(head.exists()).toBe(true);
    expect(head.find('.new-goal-button').exists()).toBe(true);
    expect(head.find('.gt-title').text()).toBe('GOALS');

    // Search and chips live on the row below, never beside the action.
    const filters = toolbar.find('.gt-filters');
    expect(filters.find('.search-input').exists()).toBe(true);
    expect(filters.find('.filter-chips').exists()).toBe(true);
    expect(filters.find('.new-goal-button').exists()).toBe(false);

    // Order on the page: action row is rendered before the filter row.
    const rows = toolbar.findAll('.gt-head, .gt-filters');
    expect(rows.map((r) => r.classes().find((c) => c.startsWith('gt-')))).toEqual(['gt-head', 'gt-filters']);

    // The chips take the slack, not the input. Read from source because scoped
    // styles are not applied in jsdom, and "does not stretch" is the entire
    // point of the change.
    // Vitest serves modules over http, so import.meta.url is not a file URL
    // here — read from the project root instead.
    const css = readFileSync('src/views/Terminal/CenterPanel/screens/Goals/components/GoalsToolbar.vue', 'utf8');
    const rule = (selector) => css.split(selector + ' {')[1]?.split('}')[0] || '';
    expect(rule('.search-input')).toMatch(/flex:\s*0\s+0\s+240px/);
    expect(rule('.filter-chips')).toMatch(/flex:\s*1/);
  });

  it('opens native creation from the toolbar without starting a goal', async () => {
    const { wrapper, dispatch } = setup(Goals);
    await wrapper.find('.new-goal-button').trigger('click');
    expect(wrapper.vm.showCreateModal).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('Native card actions', () => {
  it.each([
    [sampleGoals[0], 'View idea', 'secondary'],
    [sampleGoals[1], 'Review plan', 'primary'],
    [sampleGoals[2], 'View progress', 'secondary'],
    [sampleGoals[3], 'Review result', 'primary'],
    [sampleGoals[4], 'View result', 'secondary'],
  ])('uses BaseButton for %s', async (goal, label, variant) => {
    const { wrapper } = setup(GoalCard, { goal });
    const button = wrapper.find('button.card-primary-action');
    expect(button.text()).toBe(label);
    expect(button.classes()).toContain('base-button');
    expect(button.classes()).toContain(variant);
    expect(button.attributes('aria-label')).toContain(goal.title);
    await button.trigger('click');
    expect(wrapper.emitted('click')).toEqual([[goal]]);
  });

  it('does not open the detail when pause or schedule is clicked', async () => {
    const goal = sampleGoals[2];
    const { wrapper } = setup(GoalCard, { goal });
    await wrapper.find('.pause-btn').trigger('click');
    await wrapper.find('.schedule-btn').trigger('click');
    expect(wrapper.emitted('pause')).toEqual([[goal]]);
    expect(wrapper.emitted('schedule')).toEqual([[goal]]);
    expect(wrapper.emitted('click')).toBeUndefined();
  });
});

describe('Existing detail handlers with stage-specific labels', () => {
  it('starts the existing runner only after the plan action', async () => {
    const { wrapper, dispatch } = setup(GoalsPanel, { selectedGoalId: 'plan', goals: sampleGoals });
    const button = wrapper.findAll('button').find((button) => button.text().includes('Approve plan & build'));
    expect(button).toBeDefined();
    await button.trigger('click');
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('goals/executeGoalAutonomous', { goalId: 'plan', maxIterations: 50 });
  });

  it('accepts results through reviewGoal rather than re-executing them', async () => {
    const { wrapper, dispatch } = setup(GoalsPanel, { selectedGoalId: 'review', goals: sampleGoals });
    // Opening a result for review loads its evaluation (the checked checklist).
    expect(dispatch).toHaveBeenCalledWith('goals/fetchGoalEvaluation', 'review');
    const button = wrapper.findAll('button').find((button) => button.text().includes('Accept & mark done'));
    expect(button).toBeDefined();
    await button.trigger('click');
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith('goals/reviewGoal', { goalId: 'review', action: 'approve' });
    expect(dispatch.mock.calls.some(([action]) => action === 'goals/executeGoalAutonomous')).toBe(false);
    expect(wrapper.emitted('panel-action')).toContainEqual(['show-feedback', { type: 'success', message: 'Result accepted' }]);
  });
});
