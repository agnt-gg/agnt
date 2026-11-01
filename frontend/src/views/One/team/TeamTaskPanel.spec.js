import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import TeamTaskPanel from './TeamTaskPanel.vue';
import { teamApi } from './useTeam.js';

vi.mock('./useTeam.js', () => ({ teamApi: { task: vi.fn(), moveTask: vi.fn(), updateTask: vi.fn() } }));

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
