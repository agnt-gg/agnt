import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import Goals from './Goals.vue';
import GoalCard from './components/GoalCard.vue';
import { objectivesApi } from './goalObjectives.js';
import { matchesObjective, unlinkedCount, objectiveProgress, servesTitle, NO_OBJECTIVE } from './goalObjectives.js';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('./goalObjectives.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, objectivesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), retire: vi.fn(), link: vi.fn() } };
});

const SIGNUPS = { id: 'o-signups', title: 'Grow trial sign-ups 20%', target: '+20% by Dec 31', current: '+12%', goals: 2, done: 1 };
const SUPPORT = { id: 'o-support', title: 'Answer support in 1 hour', target: '1 h', current: '1 h 40 min', goals: 1, done: 0 };
const goals = [
  { id: 'g1', title: 'Referral program', status: 'planning', task_count: 0, objective_id: 'o-signups' },
  { id: 'g2', title: 'Pricing page', status: 'validated', objective_id: 'o-signups' },
  { id: 'g3', title: 'Macro library', status: 'executing', objective_id: 'o-support' },
  { id: 'g4', title: 'Clean CRM', status: 'planning', task_count: 0, objective_id: null },
];
// CustomSelect as a native <select>, so a choice is one setValue.
const CustomSelect = {
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
};
const wrappers = [];
function setup() {
  const updateGoal = vi.fn();
  const store = createStore({
    getters: {
      'goals/allGoals': () => goals,
      'goals/isLoading': () => false,
      'goals/isCreatingGoal': () => false,
      'goals/getLiveIteration': () => () => null,
      'goals/getGoalTaskProgress': () => () => null,
      'goals/getGoalById': () => (id) => goals.find((goal) => goal.id === id),
      'schedules/schedulesForGoal': () => () => [],
    },
    mutations: { 'goals/UPDATE_GOAL': (_state, payload) => updateGoal(payload) },
  });
  vi.spyOn(store, 'dispatch').mockResolvedValue([]);
  const wrapper = mount(Goals, {
    global: {
      plugins: [store],
      stubs: {
        // Fires base-mounted like the real BaseScreen, so the screen loads its objectives.
        BaseScreen: { template: '<main><slot /></main>', emits: ['base-mounted'], mounted() { this.$emit('base-mounted'); }, methods: { scrollToBottom() {}, triggerPanelMethod() {} } },
        Tooltip: { template: '<span><slot /></span>' }, CustomSelect, SimpleModal: true, ScheduleGoalModal: true, GoalsPanel: true, ShareButton: true,
      },
      directives: { tooltip: () => {} },
    },
  });
  wrappers.push(wrapper);
  return { wrapper, updateGoal };
}
const cardIds = (wrapper) => wrapper.findAllComponents(GoalCard).map((card) => card.props('goal').id);
afterEach(() => { wrappers.splice(0).forEach((w) => w.unmount()); vi.clearAllMocks(); });

describe('objectives above the goals board', () => {
  it('shows each objective with its target, where it stands, and its goals done; one filters the board', async () => {
    objectivesApi.list.mockResolvedValue([SIGNUPS, SUPPORT]);
    const { wrapper } = setup();
    await flushPromises();
    const tile = wrapper.get('[data-objective="o-signups"]');
    expect(tile.text()).toContain('Grow trial sign-ups 20%');
    expect(tile.text()).toContain('Now +12% of +20% by Dec 31');
    expect(tile.text()).toContain('1 of 2 goals done');
    await tile.trigger('click');
    expect(cardIds(wrapper)).toEqual(['g1', 'g2']);
    await tile.trigger('click');
    expect(cardIds(wrapper)).toHaveLength(4);
    const unlinked = wrapper.get('[data-testid="objectives-unlinked"]');
    expect(unlinked.text()).toContain('1 goal serves no objective');
    await unlinked.trigger('click');
    expect(cardIds(wrapper)).toEqual(['g4']);
  });

  it('each card says what it serves, and changing it links the goal', async () => {
    objectivesApi.list.mockResolvedValue([SIGNUPS, SUPPORT]);
    objectivesApi.link.mockResolvedValue({ goalId: 'g4', objectiveId: 'o-support' });
    const { wrapper, updateGoal } = setup();
    await flushPromises();
    const card = wrapper.findAllComponents(GoalCard).find((c) => c.props('goal').id === 'g4');
    const serves = card.get('[data-testid="goal-serves"]');
    expect(serves.classes()).toContain('is-none');
    await serves.get('select').setValue('o-support');
    await flushPromises();
    expect(objectivesApi.link).toHaveBeenCalledWith('g4', 'o-support');
    expect(updateGoal).toHaveBeenCalledWith({ id: 'g4', objective_id: 'o-support' });
    // Counts are read again from the server after a link.
    expect(objectivesApi.list).toHaveBeenCalledTimes(2);
  });

  it('adds an objective from the strip, and says so plainly when objectives cannot load', async () => {
    objectivesApi.list.mockResolvedValueOnce([]).mockResolvedValue([SIGNUPS]);
    objectivesApi.create.mockResolvedValue(SIGNUPS);
    const { wrapper } = setup();
    await flushPromises();
    // No objectives yet: cards show no Serves line, the strip offers to add one.
    expect(wrapper.find('[data-testid="goal-serves"]').exists()).toBe(false);
    await wrapper.get('[data-testid="objective-add"]').trigger('click');
    const form = wrapper.get('[data-testid="objective-form"]');
    const [title, target] = form.findAll('input');
    await title.setValue('Grow trial sign-ups 20%');
    await target.setValue('+20% by Dec 31');
    await form.trigger('submit');
    await flushPromises();
    expect(objectivesApi.create).toHaveBeenCalledWith({ title: 'Grow trial sign-ups 20%', target: '+20% by Dec 31', current: '' });
    expect(wrapper.find('[data-objective="o-signups"]').exists()).toBe(true);

    objectivesApi.list.mockRejectedValue(new Error('Objectives are unavailable right now'));
    const failing = setup();
    await flushPromises();
    expect(failing.wrapper.get('.objective-error').text()).toBe('Objectives are unavailable right now');
  });
});

describe('objective helpers', () => {
  it('filters, counts unlinked goals against live objectives, and measures progress by goals done', () => {
    const live = [SIGNUPS];
    expect(matchesObjective({ objective_id: 'o-signups' }, 'o-signups', live)).toBe(true);
    expect(matchesObjective({ objective_id: 'o-support' }, 'o-signups', live)).toBe(false);
    // A goal pointing at a retired objective counts as serving none.
    expect(matchesObjective({ objective_id: 'o-retired' }, NO_OBJECTIVE, live)).toBe(true);
    expect(matchesObjective({ objective_id: null }, null, live)).toBe(true);
    expect(unlinkedCount(goals, [])).toBe(0);
    expect(unlinkedCount(goals, live)).toBe(2);
    expect(objectiveProgress(SIGNUPS)).toBe(50);
    expect(objectiveProgress({ goals: 0, done: 0 })).toBe(0);
    expect(servesTitle(goals[0], live)).toBe('Grow trial sign-ups 20%');
    expect(servesTitle(goals[3], live)).toBe('');
  });
});
