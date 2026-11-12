import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import TeamTaskPanel from './TeamTaskPanel.vue';
import { teamApi } from './useTeam.js';

vi.mock('./useTeam.js', () => ({ teamApi: {
  task: vi.fn(), moveTask: vi.fn(), updateTask: vi.fn(),
  tasks: vi.fn(async () => []), lead: vi.fn(async () => ({ leadAgentId: null, leadRules: '' })),
  answer: vi.fn(async () => ({})), retry: vi.fn(async () => ({})),
} }));

// CustomSelect as a native <select>: same props and event, so a choice is one `setValue`.
const CustomSelect = {
  props: ['modelValue', 'options', 'disabled'],
  emits: ['update:modelValue'],
  template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
};
const spaces = [{ id: 'ws-gen', name: 'General', is_default: true }, { id: 'ws-sales', name: 'Sales' }, { id: 'ws-ops', name: 'Ops' }];
const card = (over = {}) => ({ id: 't1', workspaceId: 'ws-sales', title: 'Ship it', status: 'todo', assignee: null, due: '', createdBy: 'me', revision: 3, private: false, comments: [], ...over });

function mountPanel({ me = 'me', role = 'member', confirm = true, task = card() } = {}) {
  teamApi.task.mockResolvedValue(task);
  const ctx = {
    spaces: computed(() => spaces), people: computed(() => []), me: computed(() => me), role: computed(() => role),
    canWrite: computed(() => role !== 'viewer'), version: ref(0), lastSignal: ref(null),
    go: vi.fn(), toast: vi.fn(), confirm: vi.fn(async () => confirm), prompt: vi.fn(),
  };
  const wrapper = mount(TeamTaskPanel, {
    props: { workspaceId: task.private ? 'ws-gen' : task.workspaceId, taskId: 't1', spaceName: task.private ? 'My Space' : 'Sales' },
    global: { provide: { teamCtx: ctx }, directives: { tooltip: {} }, stubs: { CustomSelect, TeamAvatar: true } },
  });
  return { wrapper, ctx };
}
const visible = (w) => w.get('[data-testid="visible-to"]');

describe('a card\'s "Visible to"', () => {
  beforeEach(() => { teamApi.task.mockReset(); teamApi.moveTask.mockReset(); });

  it('is a choice, not a label: where it is now, every teamspace, and Only you for its maker', async () => {
    const { wrapper } = mountPanel();
    await flushPromises();
    expect(visible(wrapper).element.value).toBe('ws-sales');
    expect(visible(wrapper).attributes('disabled')).toBeUndefined();
    expect(visible(wrapper).findAll('option').map((o) => o.text())).toEqual(['Only you (My Space)', '💬 General', '💼 Sales', '⚙️ Ops']);
  });

  it('moves the card after you confirm, then opens it where it went', async () => {
    teamApi.moveTask.mockResolvedValue(card({ workspaceId: 'ws-ops', revision: 4 }));
    const { wrapper, ctx } = mountPanel();
    await flushPromises();
    await visible(wrapper).setValue('ws-ops');
    await flushPromises();
    expect(ctx.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Move this card to Ops?' }));
    expect(teamApi.moveTask).toHaveBeenCalledWith('ws-sales', 't1', { to: 'ws-ops', private: false, expectedRevision: 3 });
    expect(ctx.go).toHaveBeenCalledWith({ view: 'space', space: 'ws-ops', tab: 'board', task: 't1' });
  });

  it('Only you makes it private in your home teamspace and opens My tasks', async () => {
    teamApi.moveTask.mockResolvedValue(card({ workspaceId: 'ws-gen', private: true, revision: 4 }));
    const { wrapper, ctx } = mountPanel();
    await flushPromises();
    await visible(wrapper).setValue('private');
    await flushPromises();
    expect(teamApi.moveTask).toHaveBeenCalledWith('ws-sales', 't1', { to: 'ws-gen', private: true, expectedRevision: 3 });
    expect(ctx.go).toHaveBeenCalledWith({ view: 'mine' });
  });

  it('a private card shows Only you, and can be shared into a teamspace', async () => {
    teamApi.moveTask.mockResolvedValue(card({ workspaceId: 'ws-sales' }));
    const { wrapper } = mountPanel({ task: card({ workspaceId: 'ws-gen', private: true }) });
    await flushPromises();
    expect(visible(wrapper).element.value).toBe('private');
    await visible(wrapper).setValue('ws-sales');
    await flushPromises();
    expect(teamApi.moveTask).toHaveBeenCalledWith('ws-gen', 't1', { to: 'ws-sales', private: false, expectedRevision: 3 });
  });

  it('cancelling changes nothing', async () => {
    const { wrapper } = mountPanel({ confirm: false });
    await flushPromises();
    await visible(wrapper).setValue('ws-ops');
    await flushPromises();
    expect(teamApi.moveTask).not.toHaveBeenCalled();
  });

  it('someone else\'s card: an admin may move it but is not offered Only you; a member cannot move it', async () => {
    const admin = mountPanel({ me: 'boss', role: 'admin' });
    await flushPromises();
    expect(visible(admin.wrapper).attributes('disabled')).toBeUndefined();
    expect(visible(admin.wrapper).findAll('option').map((o) => o.text())).not.toContain('Only you (My Space)');
    const member = mountPanel({ me: 'jess', role: 'member' });
    await flushPromises();
    expect(visible(member.wrapper).attributes('disabled')).toBeDefined();
  });
});

describe('a stopped card', () => {
  const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const stopped = (over = {}) => card({
    status: 'todo', assignee: { kind: 'agent', id: 'qb' }, agentState: 'blocked', agentStateAt: ago(42),
    stopReason: 'prices disagree', decision: { reason: 'prices disagree', options: ['Use the signed price ($34)', 'Use the supplier price ($38)'] },
    checks: [{ label: 'Prices match in two sources', ok: false, detail: '$38 vs $34' }, { label: 'Within budget', ok: true, detail: '' }],
    heldUp: [{ id: 't9', title: 'Send the revised quote', status: 'doing', workspaceId: 'ws-sales' }],
    comments: [
      { id: 'c0', author: { kind: 'person', id: 'me' }, body: 'Please quote 240 seats', createdAt: ago(60) },
      { id: 'c1', author: { kind: 'agent', id: 'qb' }, body: 'Two prices.', createdAt: ago(43) },
      { id: 'c2', author: { kind: 'system', id: 'qb' }, body: 'Asked the team lead to decide first.', createdAt: ago(42) },
    ],
    ...over,
  });
  beforeEach(() => { vi.clearAllMocks(); teamApi.lead.mockResolvedValue({ leadAgentId: null, leadRules: '' }); });

  it('says why it stopped, what was tried since you last touched it, the checks, and what it holds up', async () => {
    const { wrapper } = mountPanel({ task: stopped() });
    await flushPromises();
    const box = wrapper.get('[data-testid="stop-box"]').text();
    expect(box).toContain('stopped and needs a decision');
    expect(box).toContain('Prices disagree.');
    expect(box).toContain('Stopped 42m ago');
    expect(box).toContain('holding up 1 card');
    const ladder = wrapper.get('[data-testid="ladder"]').findAll('li').map((li) => li.text());
    expect(ladder).toHaveLength(3);
    expect(ladder[0]).toContain('Two prices.');
    expect(ladder[1]).toContain('Asked the team lead to decide first.');
    expect(ladder[2]).toContain('Now with you.');
    expect(wrapper.get('[data-testid="checks"]').text()).toContain('$38 vs $34');
    expect(wrapper.get('[data-testid="held-up"]').text()).toContain('Send the revised quote');
  });

  it('a choice answers the stop and the agent carries on', async () => {
    const { wrapper, ctx } = mountPanel({ task: stopped() });
    await flushPromises();
    await wrapper.findAll('.choices button').find((b) => b.text() === 'Use the signed price ($34)').trigger('click');
    await flushPromises();
    expect(teamApi.answer).toHaveBeenCalledWith('ws-sales', 't1', 'Use the signed price ($34)', { addRule: false });
    expect(ctx.toast).toHaveBeenCalledWith('Sent. The agent carries on with your answer.');
  });

  it('an answer can become one of the team lead\u2019s rules', async () => {
    teamApi.lead.mockResolvedValue({ leadAgentId: 'lead', leadRules: '' });
    const owner = mountPanel({ role: 'owner', task: stopped() });
    await flushPromises();
    await owner.wrapper.get('.rule input').setValue(true);
    await owner.wrapper.get('.own-answer input').setValue('Keep the signed price');
    await owner.wrapper.get('.own-answer').trigger('submit');
    await flushPromises();
    expect(teamApi.answer).toHaveBeenCalledWith('ws-sales', 't1', 'Keep the signed price', { addRule: true });
    const member = mountPanel({ role: 'member', task: stopped() });
    await flushPromises();
    expect(member.wrapper.find('.rule').exists()).toBe(false);
  });

  it('a failed run offers Try again and Take it myself instead of choices', async () => {
    const { wrapper } = mountPanel({ task: stopped({ decision: null, stopReason: 'not published here yet', checks: [] }) });
    await flushPromises();
    expect(wrapper.get('[data-testid="stop-box"]').text()).toContain('Not published here yet.');
    await wrapper.findAll('.choices button').find((b) => b.text() === 'Try again').trigger('click');
    await flushPromises();
    expect(teamApi.retry).toHaveBeenCalledWith('ws-sales', 't1');
  });

  it('Waits on lists the other open cards on the board and saves the choice', async () => {
    teamApi.tasks.mockResolvedValue([card({ id: 't1' }), card({ id: 't2', title: 'Pricing page', status: 'doing' }), card({ id: 't3', title: 'Old', status: 'done' })]);
    teamApi.updateTask.mockResolvedValue({});
    const { wrapper } = mountPanel();
    await flushPromises();
    const select = wrapper.get('[data-testid="waits-on"]');
    expect(select.findAll('option').map((o) => o.text())).toEqual(['Nothing', 'Pricing page']);
    await select.setValue('t2');
    await flushPromises();
    expect(teamApi.updateTask).toHaveBeenCalledWith('ws-sales', 't1', { waitsOn: 't2', expectedRevision: 3 });
  });
});

