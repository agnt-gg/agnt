// "This conversation → Working now" — the section that listed
//
//   agent-9956fbdf-27b4-465d-a5b1-7ee7f9e62a04
//   agent-6cb19168-8768-45c0-9e35-d6adece56fd6
//   agent-49cbb058-5b8e-4a7c-a27a-6c1653e40e53
//
// under a heading that says "this conversation": three runs from OTHER
// threads, all finished the day before, named by their ids. These tests
// mount the real panel over a real store seeded with exactly that snapshot
// and pin the contract: only this thread's work under "Working now", by
// name; other busy threads under their own heading; never a uuid.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const push = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const HERE = 'conv-here';
const THERE = 'conv-there';
const UUIDS = [
  '9956fbdf-27b4-465d-a5b1-7ee7f9e62a04',
  '6cb19168-8768-45c0-9e35-d6adece56fd6',
  '49cbb058-5b8e-4a7c-a27a-6c1653e40e53',
];

/** A row exactly as executionHistory.js builds it from /executions/agents/list. */
const agentRow = (executionId, over = {}) => ({
  id: `agent-${executionId}`,
  agentExecutionId: executionId,
  type: 'agent',
  workflowName: 'Orchestrator',
  agentName: 'Orchestrator',
  status: 'running',
  startTime: '2026-09-08T20:10:24.228Z',
  endTime: null,
  conversationId: THERE,
  parentExecutionId: null,
  isAgentExecution: true,
  ...over,
});

let store;
let chatMod;
let fetchExecutions;

const conv = (id) => store.state.chat.conversations[id];

const mountPanel = (props = {}) =>
  mount(chatMod.ChatPanel, {
    props: { messages: [], ...props },
    global: {
      plugins: [store],
      directives: { tooltip: {} },
      stubs: {
        InspectorShell: { props: ['caption', 'live', 'closable'], template: '<div><slot /><slot name="footer" /></div>' },
        InspSection: { props: ['title'], template: '<section :data-title="title"><h4>{{ title }}</h4><slot /></section>' },
        EntityInspector: true,
        ArtifactPreview: true,
      },
    },
  });

const sectionText = (w, title) => {
  const s = w.findAll('section').find((el) => el.attributes('data-title') === title);
  return s ? s.text() : null;
};
const otherChatsSection = (w) => w.findAll('section').find((el) => /^Other chats/.test(el.attributes('data-title') || '')) || null;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  push.mockClear();
  const chat = (await import('@/store/features/chat.js')).default;
  const ChatPanel = (await import('./ChatPanel.vue')).default;
  chatMod = { ChatPanel };
  fetchExecutions = vi.fn(async () => {});

  store = createStore({
    modules: {
      chat,
      shell: { namespaced: true, getters: { inspect: () => null }, actions: { inspect: vi.fn(), clearInspect: vi.fn() } },
      insights: { namespaced: true, getters: { escalatedInsights: () => [] } },
      aiProvider: { namespaced: true, state: { selectedModel: 'test-model' } },
      executionHistory: {
        namespaced: true,
        state: { rows: [] },
        getters: { getExecutions: (s) => s.rows },
        mutations: { SET(s, rows) { s.rows = rows; } },
        actions: { fetchExecutions },
      },
    },
  });
  for (const id of [HERE, THERE]) store.commit('chat/ENSURE_CONVERSATION', id);
  store.commit('chat/SET_ACTIVE_CONVERSATION', HERE);
});

describe('REGRESSION: the exact snapshot the user saw', () => {
  it('shows none of the other threads’ runs, and never an id', async () => {
    // Boot-time snapshot: three runs from another conversation, all still
    // "running" as far as this stale copy knows.
    store.commit('executionHistory/SET', UUIDS.map((u) => agentRow(u)));
    const w = mountPanel();
    await w.vm.$nextTick();

    const working = sectionText(w, 'Working now');
    expect(working).toContain('Nothing is running.');
    for (const u of UUIDS) expect(w.text()).not.toContain(u);
    expect(w.text()).not.toMatch(/agent-[0-9a-f]{8}-/);
    // Those threads are not open here and not streaming here: no "Other chats" either.
    expect(otherChatsSection(w)).toBeNull();
  });
});

describe('Working now is this conversation’s work, by name', () => {
  it('lists a run of this thread from the snapshot as "Annie", with an age, not an id', async () => {
    store.commit('executionHistory/SET', [agentRow(UUIDS[0], { conversationId: HERE })]);
    const w = mountPanel();
    await w.vm.$nextTick();
    const working = sectionText(w, 'Working now');
    expect(working).toContain('Annie');
    expect(working).not.toContain(UUIDS[0]);
    expect(working).not.toContain('Nothing is running.');
  });

  it('a sub-agent this thread spawned shows under Working now, by its own name', async () => {
    store.commit('executionHistory/SET', [
      agentRow('child-1', { conversationId: HERE, agentName: 'Scout', workflowName: 'Scout', parentExecutionId: UUIDS[0] }),
    ]);
    const w = mountPanel();
    await w.vm.$nextTick();
    expect(sectionText(w, 'Working now')).toContain('Scout');
  });

  it('the live card represents the running turn; the same run is not listed again beneath it', async () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: true });
    store.commit('chat/SCOPED_RUN_STARTED', { conversationId: HERE, executionId: UUIDS[0], agentName: 'Orchestrator', startedAt: Date.now() });
    // and the snapshot has caught up with the same run
    store.commit('executionHistory/SET', [agentRow(UUIDS[0], { conversationId: HERE })]);
    const w = mountPanel({ activeAgentName: '' });
    await w.vm.$nextTick();
    const working = sectionText(w, 'Working now');
    expect(working).toContain('Annie is working…');
    expect(w.findAll('section[data-title="Working now"] .li')).toHaveLength(0);
  });

  it('a run the stream reported finished is gone even while the snapshot still says running', async () => {
    store.commit('executionHistory/SET', [agentRow(UUIDS[0], { conversationId: HERE })]);
    store.commit('chat/SCOPED_RUN_STARTED', { conversationId: HERE, executionId: UUIDS[0], agentName: 'Orchestrator', startedAt: Date.now() });
    store.commit('chat/SCOPED_RUN_ENDED', { conversationId: HERE, executionId: UUIDS[0], status: 'completed', endedAt: Date.now() });
    const w = mountPanel();
    await w.vm.$nextTick();
    expect(sectionText(w, 'Working now')).toContain('Nothing is running.');
  });
});

describe('Other chats — busy threads under their own heading', () => {
  it('a streaming thread that is not on screen is listed with who and what, and opens on click', async () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: true });
    conv(THERE).savedOutputId = 'out-there';
    conv(THERE).savedOutputTitle = 'Marketplace audit';
    const w = mountPanel();
    await w.vm.$nextTick();

    expect(sectionText(w, 'Working now')).toContain('Nothing is running.');
    const other = otherChatsSection(w);
    expect(other).toBeTruthy();
    expect(other.attributes('data-title')).toBe('Other chats · 1');
    expect(other.text()).toContain('Annie');
    expect(other.text()).toContain('Marketplace audit');

    await other.find('.li').trigger('click');
    expect(push).toHaveBeenCalledWith('/chat?content-id=out-there');
  });

  it('the conversation on screen is never listed under Other chats', async () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: HERE, value: true });
    const w = mountPanel();
    await w.vm.$nextTick();
    expect(otherChatsSection(w)).toBeNull();
  });

  it('an unsaved busy thread is shown but not navigable', async () => {
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: true });
    const w = mountPanel();
    await w.vm.$nextTick();
    const other = otherChatsSection(w);
    expect(other.text()).toContain('Untitled chat');
    await other.find('.li').trigger('click');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the snapshot is refreshed when it can have gone stale', () => {
  it('on mount, when the conversation on screen changes, and (forced) when its turn ends', async () => {
    const w = mountPanel();
    await w.vm.$nextTick();
    expect(fetchExecutions).toHaveBeenCalledTimes(1);

    store.commit('chat/SET_ACTIVE_CONVERSATION', THERE);
    await w.vm.$nextTick();
    expect(fetchExecutions).toHaveBeenCalledTimes(2);

    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: true });
    await w.vm.$nextTick();
    expect(fetchExecutions).toHaveBeenCalledTimes(2); // starting a turn is not a reason

    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: THERE, value: false });
    await w.vm.$nextTick();
    expect(fetchExecutions).toHaveBeenCalledTimes(3);
    expect(fetchExecutions.mock.calls[2][1]).toEqual({ forceRefresh: true });
  });
});
