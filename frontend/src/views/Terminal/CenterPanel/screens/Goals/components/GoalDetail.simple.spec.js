import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import GoalDetail from './GoalDetail.vue';

const state = reactive({ goals: [] });
const store = { getters: { 'goals/getGoalById': id => state.goals.find(goal => goal.id === id) }, dispatch: vi.fn() };
vi.mock('vuex', () => ({ useStore: () => store }));
const getFile = vi.hoisted(() => vi.fn().mockResolvedValue({ content: '# Report\n## Metrics\nText\n## Receipts\nText' }));
vi.mock('@/services/fileSystemService.js', () => ({ getFile }));
const inspector = { props: ['artifact'], emits: ['close', 'expand'], template: '<div class="preview-stub">{{ artifact.name }}<button @click="$emit(\'close\')">Close preview</button></div>' };
const makeGoal = (overrides = {}) => ({
  id: 'g1', title: 'Research the market', description: 'Compare leading products.', status: 'needs_review', current_iteration: 1,
  tasks: [{ id: 't1', title: 'Write recommendation', status: 'completed', output: JSON.stringify({ content: 'The comparison and recommendation are ready.', toolExecutions: [{ name: 'write_file', arguments: { path: 'C:/work/report.md' } }] }) }],
  ...overrides,
});
const mountGoal = () => mount(GoalDetail, { props: { goalId: 'g1', goals: state.goals }, global: { stubs: { ArtifactInspector: inspector } } });
function button(wrapper, text) { const found = wrapper.findAll('button').find(button => button.text().includes(text)); if (!found) throw Error('Missing button: ' + text); return found; }
beforeEach(() => { state.goals = [makeGoal()]; store.dispatch.mockReset().mockResolvedValue({}); getFile.mockClear(); });

describe('approved simple Studio goal detail', () => {
  it('shows one result and collapsed tasks, with no tabs, score dashboard, metadata cards, or eager report read', async () => {
    const wrapper = mountGoal(); await flushPromises();
    expect(wrapper.findAll('[role="tab"], [role="tablist"], .gd-score, .gd-meta, .gd-verdict')).toHaveLength(0);
    expect(wrapper.find('.gd-result-summary').text()).toBe('The comparison and recommendation are ready.');
    expect(wrapper.find('.gd-tasks').element.open).toBe(false);
    expect(wrapper.text()).toContain('1 of 1 complete');
    expect(wrapper.findAll('.gd-file')).toHaveLength(1);
    expect(getFile).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('keeps file previews available without adding a tabbed goal workspace', async () => {
    const wrapper = mountGoal(); await flushPromises();
    await wrapper.find('.gd-file').trigger('click');
    expect(wrapper.find('.preview-stub').text()).toContain('report.md');
    await button(wrapper, 'Close preview').trigger('click');
    expect(wrapper.find('.preview-stub').exists()).toBe(false);
    expect(wrapper.find('.gd-file').exists()).toBe(true);
    wrapper.unmount();
  });
  it.each([
    ['executing', 'Pause goal'], ['queued', 'Pause goal'], ['paused', 'Resume'], ['planning', 'Run goal'], ['failed', 'Run goal'],
  ])('offers the relevant action for %s, not disabled approval controls', async (status, action) => {
    state.goals = [makeGoal({ status })]; const wrapper = mountGoal(); await flushPromises();
    expect(button(wrapper, action).exists()).toBe(true);
    expect(wrapper.findAll('button').some(button => button.text() === 'Approve result')).toBe(false);
    wrapper.unmount();
  });
  it('retains feedback on failure and never starts a run implicitly', async () => {
    const wrapper = mountGoal(); await flushPromises();
    await button(wrapper, 'Request changes').trigger('click');
    await wrapper.find('textarea').setValue('  Add pricing.  ');
    store.dispatch.mockRejectedValueOnce(Error('Offline'));
    await button(wrapper, 'Send feedback').trigger('click'); await flushPromises();
    expect(wrapper.find('textarea').element.value).toBe('  Add pricing.  ');
    expect(wrapper.find('[role="alert"]').text()).toContain('Offline');
    store.dispatch.mockResolvedValueOnce({ message: 'Returned for revision' });
    await button(wrapper, 'Send feedback').trigger('click'); await flushPromises();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(store.dispatch).toHaveBeenCalledWith('goals/reviewGoal', { goalId: 'g1', action: 'reject', feedback: 'Add pricing.' });
    expect(store.dispatch.mock.calls.some(([action]) => action === 'goals/executeGoalAutonomous')).toBe(false);
    wrapper.unmount();
  });
});
