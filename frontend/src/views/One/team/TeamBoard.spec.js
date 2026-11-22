import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import TeamBoard from './TeamBoard.vue';
import { teamApi } from './useTeam.js';

vi.mock('./useTeam.js', () => ({ teamApi: { tasks: vi.fn(), limits: vi.fn(), setLimit: vi.fn(), updateTask: vi.fn(), createTask: vi.fn() } }));

const old = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const card = (over) => ({ id: over.id, title: over.id, status: 'todo', assignee: { kind: 'agent', id: 'a1' }, due: '', revision: 1, agentState: null, statusChangedAt: old(1), updatedAt: old(1), sendBackCount: 0, approvedAt: null, ...over });

function mountBoard({ tasks, limits = { doing: null, review: null }, role = 'member' }) {
  teamApi.tasks.mockResolvedValue(tasks);
  teamApi.limits.mockResolvedValue(limits);
  const ctx = {
    people: computed(() => []), me: computed(() => 'me'), canWrite: computed(() => role !== 'viewer'),
    version: ref(0), lastSignal: ref(null), toast: vi.fn(),
  };
  const wrapper = mount(TeamBoard, {
    props: { workspaceId: 'ws', agents: [{ id: 'a1', name: 'Quote Builder' }] },
    global: { provide: { teamCtx: ctx }, stubs: { TeamAvatar: true, MkIcon: true } },
    attachTo: document.body,
  });
  return { wrapper, ctx };
}
const column = (w, id) => w.get(`[data-column="${id}"]`);

describe('the team board shows flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a full Review says assistants wait, how many reviews make room, and opens the oldest review', async () => {
    const { wrapper } = mountBoard({
      tasks: [
        card({ id: 'newer', status: 'review', agentState: 'waiting', statusChangedAt: old(2) }),
        card({ id: 'oldest', status: 'review', agentState: 'waiting', statusChangedAt: old(30) }),
        card({ id: 'held', agentState: 'queued', stopReason: 'Review is full', agentStateAt: old(1) }),
      ],
      limits: { doing: null, review: 2 },
    });
    await flushPromises();
    const review = column(wrapper, 'review');
    expect(review.get('[data-testid="limit-review"]').text()).toBe('2 of 2');
    expect(review.text()).toContain('Assistants wait until Review has fewer than 2 cards: 1 review makes room.');
    await review.get('.limit-note button').trigger('click');
    expect(wrapper.emitted('open-task')[0]).toEqual(['oldest']);
    // The oldest review shows its age in amber.
    expect(review.findAll('.age.is-warn').map((a) => a.text())).toEqual(['1d in Review']);
    wrapper.unmount();
  });

  it('cards say why an assistant waits or stopped, which card goes next, and how a result was accepted', async () => {
    const { wrapper } = mountBoard({
      tasks: [
        card({ id: 'second', agentState: 'queued', stopReason: 'In progress is full', agentStateAt: old(1) }),
        card({ id: 'first', agentState: 'queued', stopReason: 'In progress is full', agentStateAt: old(3) }),
        card({ id: 'stuck', agentState: 'blocked', stopReason: 'not published here yet' }),
        card({ id: 'clean', status: 'done', approvedAt: old(1), sendBackCount: 0 }),
        card({ id: 'reworked', status: 'done', approvedAt: old(1), sendBackCount: 2 }),
      ],
    });
    await flushPromises();
    const todo = column(wrapper, 'todo').text();
    expect(todo).toContain('Waiting: In progress is full');
    expect(todo).toContain('Stopped: not published here yet');
    const nextUp = wrapper.findAll('.tcard').filter((c) => c.text().includes('Next up for assistants'));
    expect(nextUp.map((c) => c.get('.tcard-title').text())).toEqual(['first']);
    const done = column(wrapper, 'done').text();
    expect(done).toContain('Accepted first time');
    expect(done).toContain('Sent back 2×');
    wrapper.unmount();
  });

  it('sets a work limit with the stepper and saves it for the column', async () => {
    teamApi.setLimit.mockResolvedValue({ doing: null, review: 3 });
    const { wrapper, ctx } = mountBoard({ tasks: [card({ id: 'r1', status: 'review', agentState: 'waiting' })] });
    await flushPromises();
    const chip = wrapper.get('[data-testid="limit-review"]');
    expect(chip.text()).toBe('Set limit');
    await chip.trigger('click');
    expect(wrapper.get('[data-testid="limit-draft-review"]').text()).toBe('1');
    const raise = wrapper.get('[aria-label="Raise the limit"]');
    await raise.trigger('click');
    await raise.trigger('click');
    await wrapper.findAll('.limit-pop button').find((b) => b.text() === 'Save limit').trigger('click');
    await flushPromises();
    expect(teamApi.setLimit).toHaveBeenCalledWith('ws', 'review', 3);
    expect(ctx.toast).toHaveBeenCalledWith('Review limit is 3.');
    wrapper.unmount();
  });

  it('limit chips are read-only when the board cannot be edited, and My Space boards have none', async () => {
    const { wrapper } = mountBoard({ tasks: [], limits: { doing: 2, review: null }, role: 'viewer' });
    await flushPromises();
    expect(wrapper.get('[data-testid="limit-doing"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="limit-review"]').text()).toBe('No limit');
    wrapper.unmount();

    teamApi.tasks.mockResolvedValue([]);
    const mine = mount(TeamBoard, {
      props: { workspaceId: 'ws', private: true },
      global: { provide: { teamCtx: { people: computed(() => []), me: computed(() => 'me'), canWrite: computed(() => true), version: ref(0), lastSignal: ref(null), toast: vi.fn() } }, stubs: { TeamAvatar: true, MkIcon: true } },
    });
    await flushPromises();
    expect(mine.find('[data-testid="limit-review"]').exists()).toBe(false);
    expect(teamApi.limits).toHaveBeenCalledTimes(1);
    mine.unmount();
  });
});
