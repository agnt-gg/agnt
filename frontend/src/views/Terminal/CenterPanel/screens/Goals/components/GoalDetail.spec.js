import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, nextTick } from 'vue';
import GoalDetail from './GoalDetail.vue';
import GoalDetailEvidence from './GoalDetailEvidence.vue';
import { briefText, goalResultText, taskOutputText, OUTPUT_LIMIT } from '../goalDetailModel.js';

const REPORT = 'C:/work/weekly/report.md';
const htmlFile = 'C:/work/site/index.html';
const state = reactive({ goals: [] });
const store = { getters: { 'goals/getGoalById': id => state.goals.find(goal => goal.id === id) }, dispatch: vi.fn() };
vi.mock('vuex', () => ({ useStore: () => store }));
const makeGoal = () => ({ id: 'g1', title: 'Weekly review', status: 'needs_review', current_iteration: 4, max_iterations: 50, priority: 'high', tasks: [{ id: 't1', title: 'Verify baseline', status: 'completed', output: JSON.stringify({ content: [{ type: 'text', text: 'Work completed.' }], toolExecutions: [{ name: 'write_file', arguments: { path: REPORT } }, { name: 'write_file', arguments: { path: htmlFile } }] }) }] });
const inspectorStub = { props: ['artifact'], emits: ['close', 'expand'], template: '<div class="inline-inspector">{{ artifact.name }} {{ artifact.kind }}<button class="close-preview" @click="$emit(\'close\')">Close</button></div>' };
const mountGoal = () => mount(GoalDetail, { props: { goalId: 'g1', goals: state.goals }, global: { stubs: { ArtifactInspector: inspectorStub } } });
function button(wrapper, text) { const found = wrapper.findAll('button').find(button => button.text().includes(text)); if (!found) throw Error('Missing button: ' + text); return found; }
async function openDetails(wrapper) { wrapper.element.open = true; await wrapper.trigger('toggle'); await nextTick(); }
beforeEach(() => { state.goals = [makeGoal()]; store.dispatch.mockReset().mockResolvedValue({}); });

describe('goal detail actions and lifecycle', () => {
  it('follows a replacement store object and loads the goal exactly once', async () => {
    const wrapper = mountGoal(); await flushPromises();
    state.goals.splice(0, 1, { ...makeGoal(), title: 'Updated goal', status: 'validated' });
    await nextTick();
    expect(wrapper.text()).toContain('Updated goal'); expect(wrapper.find('.gd-status').text()).toBe('Approved');
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(store.dispatch).toHaveBeenCalledWith('goals/fetchGoalTasks', 'g1');
    wrapper.unmount();
  });
  it('opens full task work on demand without navigating', async () => {
    const wrapper = mountGoal(); await flushPromises();
    expect(wrapper.find('.gd-rendered').exists()).toBe(false);
    await openDetails(wrapper.find('.gd-tasks'));
    await openDetails(wrapper.find('.gd-task'));
    expect(wrapper.find('.gd-rendered').text()).toContain('Work completed.');
    wrapper.unmount();
  });
  it('previews HTML through the existing inspector and closes back to the same goal', async () => {
    const wrapper = mountGoal(); await flushPromises();
    const row = wrapper.findAll('.gd-file').find(row => row.text().includes('index.html'));
    await row.trigger('click');
    expect(wrapper.find('.inline-inspector').text()).toContain('index.html html');
    await wrapper.find('.close-preview').trigger('click');
    expect(wrapper.findAll('.gd-file')).toHaveLength(2);
    expect(wrapper.find('.gd-title').text()).toBe('Weekly review');
    wrapper.unmount();
  });
  it('dispatches approval once during a pending request and shows the result', async () => {
    const wrapper = mountGoal(); await flushPromises(); let finish;
    store.dispatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await button(wrapper, 'Approve result').trigger('click'); await button(wrapper, 'Approve result').trigger('click');
    expect(store.dispatch.mock.calls.filter(([action]) => action === 'goals/reviewGoal')).toHaveLength(1);
    finish({ status: 'validated', message: 'Accepted' }); await flushPromises();
    expect(wrapper.text()).toContain('Accepted'); wrapper.unmount();
  });
  it('labels an unrun proposal as plan approval; approval preserves server-owned execution', async () => {
    state.goals = [{ ...makeGoal(), current_iteration: 0, tasks: [{ id: 't1', status: 'pending', title: 'Plan' }] }];
    const wrapper = mountGoal(); await flushPromises();
    await button(wrapper, 'Approve plan').trigger('click'); await flushPromises();
    expect(store.dispatch).toHaveBeenCalledWith('goals/reviewGoal', { goalId: 'g1', action: 'approve' });
    expect(wrapper.findAll('button').some(button => button.text() === 'Pause goal')).toBe(false);
    expect(store.dispatch.mock.calls.some(([action]) => action === 'goals/executeGoalAutonomous')).toBe(false);
    wrapper.unmount();
  });
  it.each([
    ['executing', 'Pause goal', 'goals/pauseGoal', 'g1'],
    ['queued', 'Pause goal', 'goals/pauseGoal', 'g1'],
    ['paused', 'Resume', 'goals/resumeGoal', 'g1'],
    ['planning', 'Run goal', 'goals/executeGoalAutonomous', { goalId: 'g1', maxIterations: 50 }],
    ['failed', 'Run goal', 'goals/executeGoalAutonomous', { goalId: 'g1', maxIterations: 50 }],
    ['stopped', 'Run goal', 'goals/executeGoalAutonomous', { goalId: 'g1', maxIterations: 50 }],
  ])('preserves %s control dispatch', async (status, label, action, payload) => {
    state.goals[0].status = status; const wrapper = mountGoal(); await flushPromises();
    await button(wrapper, label).trigger('click'); await flushPromises();
    expect(store.dispatch).toHaveBeenCalledWith(action, payload); wrapper.unmount();
  });
  it('blocks actions after a failed load and enables them after a successful retry', async () => {
    store.dispatch.mockRejectedValueOnce(Error('Forbidden'));
    const wrapper = mountGoal(); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('Forbidden');
    await button(wrapper, 'Approve result').trigger('click'); expect(store.dispatch).toHaveBeenCalledTimes(1);
    await button(wrapper, 'Retry loading').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await button(wrapper, 'Approve result').trigger('click'); expect(store.dispatch).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
  it('ignores a previous goal load failure and resets open task/preview/feedback state', async () => {
    let rejectOld; store.dispatch.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOld = reject; }));
    const wrapper = mountGoal(); await flushPromises();
    state.goals.push({ ...makeGoal(), id: 'g2', title: 'Second goal' });
    await wrapper.setProps({ goalId: 'g2' }); await flushPromises();
    rejectOld(Error('Old failure')); await flushPromises();
    expect(wrapper.text()).not.toContain('Old failure');
    await openDetails(wrapper.find('.gd-tasks'));
    await button(wrapper, 'Request changes').trigger('click');
    await wrapper.find('textarea').setValue('Old feedback');
    await wrapper.find('.gd-file').trigger('click');
    await wrapper.setProps({ goalId: 'g1' }); await flushPromises();
    expect(wrapper.find('.inline-inspector').exists()).toBe(false);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('.gd-tasks').element.open).toBe(false);
    wrapper.unmount();
  });
  it('does not publish an old mutation notice after a goal switch', async () => {
    const wrapper = mountGoal(); await flushPromises(); let finish;
    store.dispatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await button(wrapper, 'Approve result').trigger('click');
    state.goals.push({ ...makeGoal(), id: 'g2', title: 'Second goal' });
    await wrapper.setProps({ goalId: 'g2' }); await flushPromises();
    finish({ message: 'Old result accepted' }); await flushPromises();
    expect(wrapper.text()).not.toContain('Old result accepted');
    expect(wrapper.emitted('panel-action')).toBeUndefined(); wrapper.unmount();
  });
  it('rejects whitespace feedback and retains the draft when cancel is disabled during sending', async () => {
    const wrapper = mountGoal(); await flushPromises();
    await button(wrapper, 'Request changes').trigger('click');
    await wrapper.find('textarea').setValue('   ');
    expect(button(wrapper, 'Send feedback').element.disabled).toBe(true);
    await wrapper.find('textarea').setValue('Do not lose this.');
    let finish; store.dispatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await button(wrapper, 'Send feedback').trigger('click');
    expect(button(wrapper, 'Cancel').element.disabled).toBe(true);
    await wrapper.find('textarea').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('textarea').element.value).toBe('Do not lose this.');
    finish({}); await flushPromises(); expect(wrapper.find('textarea').exists()).toBe(false); wrapper.unmount();
  });
});

describe('concise evidence boundaries', () => {
  it('bounds excerpts and unwraps task output without thinking/tool blocks', () => {
    expect(briefText('a '.repeat(10000))).toHaveLength(278);
    expect(briefText('# Heading\n**Read** [the report](file:///work/a.md)')).toBe('Heading Read the report');
    expect(taskOutputText({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'answer' }, { type: 'tool_use', name: 'test' }] })).toBe('answer');
    expect(taskOutputText('x'.repeat(500000))).toHaveLength(OUTPUT_LIMIT);
    expect(goalResultText([{ status: 'completed', output: 'First' }, { status: 'failed', output: 'Do not call this the result' }])).toBe('First');
    expect(goalResultText([{ status: 'completed', output: 'First' }, { status: 'completed', output: 'Latest' }])).toBe('Latest');
    expect(goalResultText([])).toBe('');
  });
  it('sanitises hostile task HTML and never renders summary text as HTML', async () => {
    state.goals[0].tasks[0].output = '<img src=x onerror="alert(1)"><script>alert(2)</script><iframe src="https://example.com"></iframe>Output';
    const wrapper = mountGoal(); await flushPromises();
    expect(wrapper.find('.gd-result-summary img').exists()).toBe(false);
    await openDetails(wrapper.find('.gd-tasks')); await openDetails(wrapper.find('.gd-task'));
    expect(wrapper.find('.gd-rendered').html()).not.toContain('onerror');
    expect(wrapper.find('.gd-rendered script').exists()).toBe(false);
    expect(wrapper.find('.gd-rendered iframe').exists()).toBe(false); wrapper.unmount();
  });
  it('does not invent a successful result for empty, failed or running goals', async () => {
    const wrapper = mount(GoalDetailEvidence, { props: { goal: { id: 'g1', status: 'planning' }, tasks: [] } });
    expect(wrapper.find('.gd-result-summary').text()).toBe('No result yet.');
    await wrapper.setProps({ goal: { id: 'g1', status: 'failed' } });
    expect(wrapper.find('.gd-result-summary').text()).toContain('Execution failed.');
    await wrapper.setProps({ goal: { id: 'g1', status: 'executing' }, tasks: [{ title: 'Compare products', status: 'running' }] });
    expect(wrapper.find('.gd-result-summary').text()).toBe('Working on: Compare products'); wrapper.unmount();
  });
  it('keeps overflow files collapsed and includes files linked in answers', async () => {
    const tasks = [{ status: 'completed', output: { content: 'Files: file:///C:/work/answer.md', toolExecutions: Array.from({ length: 5 }, (_, index) => ({ name: 'write_file', arguments: { path: 'C:/work/file' + index + '.md' } })) } }];
    const wrapper = mount(GoalDetailEvidence, { props: { goal: { id: 'g1' }, tasks } });
    expect(wrapper.findAll('.gd-files > .gd-file')).toHaveLength(3);
    expect(wrapper.find('.gd-more-files').element.open).toBe(false);
    expect(wrapper.find('.gd-more-files').text()).toContain('answer.md'); wrapper.unmount();
  });
});
