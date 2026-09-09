// Live-run bookkeeping for the chat inspector's "Working now".
//
// The panel used to read the execution-history snapshot, which is fetched
// once at boot: it showed runs from every thread, some of which had finished
// the previous day. The stream itself announces the run it minted
// (`agent_execution_started`) and its end (`agent_execution_completed`), on
// the conversation that owns the stream — so the truth is already here, per
// thread, in real time. These tests pin that it is recorded, scoped, and
// settled when the stream ends by any route.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const HERE = 'conv-here';
const THERE = 'conv-there';
const EXEC = '9956fbdf-27b4-465d-a5b1-7ee7f9e62a04';

let store;
let handleScopedStreamEvent;

const conv = (id) => store.state.chat.conversations[id];
const emit = (id, eventName, data) =>
  handleScopedStreamEvent(
    { commit: (type, payload) => store.commit(`chat/${type}`, payload), state: store.state.chat, dispatch: null },
    eventName, data, id,
  );

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  const mod = await import('./chat.js');
  handleScopedStreamEvent = mod.handleScopedStreamEvent;
  store = createStore({ modules: { chat: mod.default } });
  for (const id of [HERE, THERE]) store.commit('chat/ENSURE_CONVERSATION', id);
  store.commit('chat/SET_ACTIVE_CONVERSATION', HERE);
});

describe('a run is recorded on the conversation whose stream announced it', () => {
  it('agent_execution_started adds a running entry, scoped to that thread only', () => {
    emit(HERE, 'agent_execution_started', { executionId: EXEC, agentName: 'Orchestrator' });
    expect(conv(HERE).liveRuns).toHaveLength(1);
    expect(conv(HERE).liveRuns[0]).toMatchObject({ executionId: EXEC, agentName: 'Orchestrator', status: 'running', endedAt: null });
    expect(typeof conv(HERE).liveRuns[0].startedAt).toBe('number');
    expect(conv(THERE).liveRuns).toEqual([]);
  });

  it('agent_execution_completed records the status the server wrote', () => {
    emit(HERE, 'agent_execution_started', { executionId: EXEC, agentName: 'Orchestrator' });
    emit(HERE, 'agent_execution_completed', { executionId: EXEC, status: 'failed' });
    expect(conv(HERE).liveRuns[0]).toMatchObject({ status: 'failed' });
    expect(typeof conv(HERE).liveRuns[0].endedAt).toBe('number');
  });

  it('a started event without an id is ignored rather than creating a nameless row', () => {
    emit(HERE, 'agent_execution_started', { agentName: 'Orchestrator' });
    expect(conv(HERE).liveRuns).toEqual([]);
  });

  it('re-announcing the same id updates in place and keeps the original start', () => {
    emit(HERE, 'agent_execution_started', { executionId: EXEC, agentName: 'Orchestrator' });
    const first = conv(HERE).liveRuns[0].startedAt;
    store.commit('chat/SCOPED_RUN_STARTED', { conversationId: HERE, executionId: EXEC, agentName: null, startedAt: first + 5000 });
    expect(conv(HERE).liveRuns).toHaveLength(1);
    expect(conv(HERE).liveRuns[0]).toMatchObject({ agentName: 'Orchestrator', startedAt: first });
  });

  it('is bounded: only the most recent runs are kept', () => {
    for (let i = 0; i < 30; i++) {
      store.commit('chat/SCOPED_RUN_STARTED', { conversationId: HERE, executionId: `e${i}`, agentName: 'A', startedAt: i });
    }
    expect(conv(HERE).liveRuns).toHaveLength(20);
    expect(conv(HERE).liveRuns[0].executionId).toBe('e10');
    expect(conv(HERE).liveRuns.at(-1).executionId).toBe('e29');
  });
});

describe('REGRESSION: a run can never stay "running" after its stream is over', () => {
  it('the normal path: completed arrives before done', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: true });
    emit(HERE, 'agent_execution_started', { executionId: EXEC, agentName: 'Orchestrator' });
    emit(HERE, 'agent_execution_completed', { executionId: EXEC, status: 'completed' });
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: false });
    expect(conv(HERE).liveRuns[0].status).toBe('completed');
  });

  it('Stop / dropped socket: no completed event ever arrives, so the stream ending settles it', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: true });
    emit(HERE, 'agent_execution_started', { executionId: EXEC, agentName: 'Orchestrator' });
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: false });
    expect(conv(HERE).liveRuns[0]).toMatchObject({ status: 'completed' });
    expect(typeof conv(HERE).liveRuns[0].endedAt).toBe('number');
  });

  it('settling does not overwrite a status the server already reported', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: true });
    emit(HERE, 'agent_execution_started', { executionId: EXEC, agentName: 'Orchestrator' });
    emit(HERE, 'agent_execution_completed', { executionId: EXEC, status: 'failed' });
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: false });
    expect(conv(HERE).liveRuns[0].status).toBe('failed');
  });

  it('only the conversation whose stream ended is settled', () => {
    for (const id of [HERE, THERE]) {
      store.commit('chat/SCOPED_SET_STREAMING', { conversationId: id, value: true });
      emit(id, 'agent_execution_started', { executionId: `${EXEC}-${id}`, agentName: 'Orchestrator' });
    }
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: false });
    expect(conv(HERE).liveRuns[0].status).toBe('completed');
    expect(conv(THERE).liveRuns[0].status).toBe('running');
  });
});

describe('busyConversations — every thread with work in flight', () => {
  it('lists streaming conversations with title, speaker and since; idle ones are absent', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: true });
    conv(THERE).savedOutputId = 'out-there';
    conv(THERE).savedOutputTitle = 'Marketplace audit';
    emit(THERE, 'agent_execution_started', { executionId: 'x', agentName: 'Orchestrator' });

    const busy = store.getters['chat/busyConversations'];
    expect(busy.map((b) => b.conversationId)).toEqual([THERE]);
    expect(busy[0]).toMatchObject({ outputId: 'out-there', title: 'Marketplace audit' });
    expect(busy[0].speaker.name).toBe('Annie');
    expect(typeof busy[0].since).toBe('number');
  });

  it('falls back to the first user message as a title when the chat is unsaved', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: true });
    store.commit('chat/SCOPED_ADD_MESSAGE', {
      conversationId: THERE,
      message: { id: 'u1', role: 'user', content: '  why does the sidebar list every thread?  ', timestamp: 1 },
    });
    const [b] = store.getters['chat/busyConversations'];
    expect(b.title).toBe('why does the sidebar list every thread?');
    expect(b.outputId).toBeNull();
  });

  it('names the agent holding the floor, not Annie, when an agent is answering', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: true });
    store.commit('chat/SCOPED_ADD_MESSAGE', {
      conversationId: THERE,
      message: { id: 'a1', role: 'assistant', content: '', agentId: 'a9', agentName: 'Scout', timestamp: 2 },
    });
    const [b] = store.getters['chat/busyConversations'];
    expect(b.speaker).toEqual({ id: 'a9', name: 'Scout' });
  });

  it('counts a conversation another device is streaming (isRemoteStreaming)', () => {
    store.commit('chat/SCOPED_SET_REMOTE_STREAMING', { conversationId: THERE, value: true });
    expect(store.getters['chat/busyConversations'].map((b) => b.conversationId)).toEqual([THERE]);
  });

  it('includes the active conversation too — the caller decides what to hide', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: true });
    expect(store.getters['chat/busyConversations'].map((b) => b.conversationId)).toEqual([HERE]);
  });

  it('since is null until the stream has announced a run', () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: true });
    expect(store.getters['chat/busyConversations'][0].since).toBeNull();
  });
});
