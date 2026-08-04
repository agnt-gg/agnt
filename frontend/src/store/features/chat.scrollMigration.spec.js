/**
 * A conversation's scroll position follows it through its identity change.
 *
 * A new chat starts life as `temp-<timestamp>` and is renamed to the
 * server-assigned UUID the moment streaming begins. Skill, goal and provider
 * bindings already ride MIGRATE_CONTEXT_BINDINGS across that flip; the reading
 * position has to as well. Left behind under the temp id it is unreachable
 * forever (nothing will ever ask for that id again) AND it occupies an LRU
 * slot that a reachable position could have used — a slow leak that silently
 * evicts positions the user can still get back to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const KEY = 'chatScrollV1';
const OLD = 'temp-1730000000000';
const NEW = 'e7c1b0aa-1111-2222-3333-444455556666';

let chat;
let positions;

const makeState = () => ({
  activeConversationId: OLD,
  activeSkillByConv: {},
  activeGoalByConv: {},
  aiByConv: {},
});

beforeEach(async () => {
  vi.resetModules();
  localStorage.removeItem(KEY);
  chat = (await import('./chat.js')).default;
  positions = await import('@/services/chatScrollPositions.js');
});

describe('MIGRATE_CONTEXT_BINDINGS — the scroll position comes along', () => {
  it('moves the position from the temp id to the server uuid', () => {
    positions.setScrollPosition(OLD, { anchorId: 'm-17', anchorOffset: 240, atBottom: false, window: 80 });

    chat.mutations.MIGRATE_CONTEXT_BINDINGS(makeState(), { oldId: OLD, newId: NEW });

    expect(positions.getScrollPosition(OLD)).toBeNull();
    expect(positions.getScrollPosition(NEW)).toMatchObject({
      anchorId: 'm-17',
      anchorOffset: 240,
      atBottom: false,
      window: 80,
    });
  });

  it('leaves other conversations untouched', () => {
    positions.setScrollPosition(OLD, { anchorId: 'mine', anchorOffset: 0, atBottom: false, window: null });
    positions.setScrollPosition('someone-else', { anchorId: 'theirs', anchorOffset: 0, atBottom: false, window: null });

    chat.mutations.MIGRATE_CONTEXT_BINDINGS(makeState(), { oldId: OLD, newId: NEW });

    expect(positions.getScrollPosition('someone-else').anchorId).toBe('theirs');
  });

  it('is a no-op when nothing was stored — it does not fabricate an entry', () => {
    chat.mutations.MIGRATE_CONTEXT_BINDINGS(makeState(), { oldId: OLD, newId: NEW });
    expect(positions.getScrollPosition(NEW)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('still migrates the Vuex bindings it already owned (no regression)', () => {
    const state = makeState();
    state.activeSkillByConv[OLD] = { id: 'skill-1' };
    state.activeGoalByConv[OLD] = { id: 'goal-1' };
    state.aiByConv[OLD] = { provider: 'anthropic', model: 'claude' };
    positions.setScrollPosition(OLD, { anchorId: 'm1', anchorOffset: 0, atBottom: false, window: null });

    chat.mutations.MIGRATE_CONTEXT_BINDINGS(state, { oldId: OLD, newId: NEW });

    expect(state.activeSkillByConv[NEW]).toEqual({ id: 'skill-1' });
    expect(state.activeGoalByConv[NEW]).toEqual({ id: 'goal-1' });
    expect(state.aiByConv[NEW]).toEqual({ provider: 'anthropic', model: 'claude' });
    expect(positions.getScrollPosition(NEW).anchorId).toBe('m1');
  });

  it('ignores a degenerate rename without disturbing the stored position', () => {
    positions.setScrollPosition(OLD, { anchorId: 'm1', anchorOffset: 0, atBottom: false, window: null });
    chat.mutations.MIGRATE_CONTEXT_BINDINGS(makeState(), { oldId: OLD, newId: OLD });
    expect(positions.getScrollPosition(OLD).anchorId).toBe('m1');
  });
});
