/**
 * Workspace chat hydration — restarting the app must not eat the conversation.
 *
 * A workspace chat re-reads its transcript from conversation_logs on load. That
 * log is the RAW PROVIDER transcript: the moment a turn calls a canvas tool,
 * `content` is a block array rather than a string. Two defects compounded:
 *
 *   1. the reader coerced the array with String() → "[object Object]";
 *   2. hydration adopted whichever transcript had MORE ROWS, and the provider
 *      format has two extra rows per tool round-trip — so the degraded remote
 *      always beat the good local copy on exactly the turns that broke.
 *
 * Length was standing in for fidelity, and it is not a proxy for fidelity.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchConversation = vi.fn();

vi.mock('@/services/chatService.js', () => ({
  streamChat: vi.fn(),
  toChatHistory: vi.fn(() => []),
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: (...args) => fetchConversation(...args),
}));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(() => ({ provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(() => []),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({
  emitSteer: vi.fn(),
  emitClearSteer: vi.fn(),
}));

const CH = 'workspace:ws-1';
const CONV = 'conv-70893216';

let chatUnified;
let state;
let commit;

const makeState = () => ({
  conversations: {},
  streamingChannels: {},
  loadingSuggestionsChannels: {},
  expandedToolCalls: {},
  runningToolCalls: {},
  messageStates: {},
  abortControllers: {},
  pendingSteers: {},
  imageCaches: {},
  dataCaches: {},
  _migrated: {},
});

/** The canvas turn that broke, exactly as the provider stored it. */
const TOOL_TURN = [
  { role: 'user', content: 'can you make your chat here a little less wide' },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'check the layout' },
      { type: 'text', text: 'Let me look at the current layout first.' },
      { type: 'tool_use', id: 'toolu_01', name: 'get_canvas_state', input: {} },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: '{"widgets":2}' }] },
  {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'toolu_02', name: 'move_canvas_widget', input: { id: 'chat' } },
      { type: 'tool_use', id: 'toolu_03', name: 'move_canvas_widget', input: { id: 'sim' } },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_02', content: 'ok' },
      { type: 'tool_result', tool_use_id: 'toolu_03', content: 'ok' },
    ],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'Done \u2014 chat slimmed to 3 columns. \ud83d\udeeb' }] },
];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  const mod = await import('./chatUnified.js');
  chatUnified = mod.default;
  state = makeState();
  commit = (type, payload) => {
    const fn = chatUnified.mutations[type];
    if (!fn) throw new Error(`Unknown mutation: ${type}`);
    fn(state, payload);
  };
});

const seedLocal = (messages) => {
  state.conversations[CH] = {
    messages,
    conversationId: CONV,
    suggestions: [],
    lastUpdate: Date.now(),
  };
};

const hydrate = () => chatUnified.actions.hydrateWorkspaceChannel({ commit, state }, { channelKey: CH });

describe('hydrateWorkspaceChannel — provider block transcripts', () => {
  it('restores a tool-using turn as words, never as [object Object]', async () => {
    seedLocal([]);
    fetchConversation.mockResolvedValue({ conversationId: CONV, messages: TOOL_TURN });

    const res = await hydrate();
    expect(res.ok).toBe(true);

    const msgs = state.conversations[CH].messages;
    expect(msgs.some((m) => String(m.content).includes('[object Object]'))).toBe(false);
    expect(msgs.map((m) => m.content)).toContain('Let me look at the current layout first.');
    expect(msgs.map((m) => m.content)).toContain('Done \u2014 chat slimmed to 3 columns. \ud83d\udeeb');
  });

  it('drops the tool-result rows so the count matches what the user actually said', async () => {
    seedLocal([]);
    fetchConversation.mockResolvedValue({ conversationId: CONV, messages: TOOL_TURN });

    await hydrate();
    // 6 provider rows, 2 of them pure tool plumbing.
    expect(state.conversations[CH].messages).toHaveLength(4);
  });

  it('carries each tool result back onto the call that requested it', async () => {
    seedLocal([]);
    fetchConversation.mockResolvedValue({ conversationId: CONV, messages: TOOL_TURN });

    await hydrate();
    const calls = state.conversations[CH].messages.flatMap((m) => m.toolCalls || []);
    expect(calls).toHaveLength(3);
    expect(calls.every((tc) => tc.status === 'completed')).toBe(true);
    expect(calls[0]).toMatchObject({ name: 'get_canvas_state', result: '{"widgets":2}' });
  });
});

describe('hydrateWorkspaceChannel — which transcript wins', () => {
  it('does NOT let a row-heavy but meaningless remote clobber good local history', async () => {
    seedLocal([
      { id: 'u1', role: 'user', content: 'can you make your chat here a little less wide' },
      { id: 'a1', role: 'assistant', content: 'Done \u2014 chat slimmed to 3 columns, sim stretched to 9x8.' },
    ]);
    // Six rows against two — and nothing to say.
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: Array.from({ length: 6 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: '[object Object],[object Object]',
      })),
    });

    const res = await hydrate();
    expect(res.reason).toBe('local_newer_or_equal');
    expect(state.conversations[CH].messages[1].content)
      .toBe('Done \u2014 chat slimmed to 3 columns, sim stretched to 9x8.');
  });

  it('still adopts a remote that genuinely continues the conversation', async () => {
    seedLocal([
      { id: 'u1', role: 'user', content: 'can you make your chat here a little less wide' },
    ]);
    fetchConversation.mockResolvedValue({ conversationId: CONV, messages: TOOL_TURN });

    const res = await hydrate();
    expect(res.reason).toBe('hydrated');
    expect(state.conversations[CH].messages.length).toBeGreaterThan(1);
  });

  it('keeps local when the two transcripts say the same thing', async () => {
    const same = [
      { id: 'u1', role: 'user', content: 'hello there' },
      { id: 'a1', role: 'assistant', content: 'hi, what can I build' },
    ];
    seedLocal(same);
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: same.map(({ role, content }) => ({ role, content })),
    });

    expect((await hydrate()).reason).toBe('local_newer_or_equal');
  });

  it('reports the substance it compared, so a bad adoption is diagnosable', async () => {
    seedLocal([{ id: 'a1', role: 'assistant', content: 'a real sentence with real words' }]);
    fetchConversation.mockResolvedValue({
      conversationId: CONV,
      messages: [{ role: 'assistant', content: '[object Object]' }],
    });

    const res = await hydrate();
    expect(res.remoteSubstance).toBe(0);
    expect(res.localSubstance).toBeGreaterThan(0);
  });
});
