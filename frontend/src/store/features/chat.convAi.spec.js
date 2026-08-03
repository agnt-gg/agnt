// Per-conversation AI override (aiByConv) — the contract that lets one
// conversation pin its own { provider, model } without touching the global
// default or any other conversation.
//
// Pinned here:
//  1. SET_CONV_AI is atomic — a partial pair clears rather than half-applies.
//  2. MIGRATE_CONTEXT_BINDINGS carries the override across the temp→UUID flip.
//  3. setConversationAi persists to /conversations/:id/settings for real ids
//     and skips the network for temp ids; clearConversationAi sends nulls.
//  4. The send path resolves the override OVER the caller-passed (global)
//     pair and marks the turn persistDefault=false — so a floor dispatch or
//     goal auto-fire that passes the global selection still respects the
//     conversation's pin, and the backend never writes the pin back as the
//     account-wide default.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const CONV = 'conv-1';

let chat;
let state;
let commit;

const makeState = () => ({
  activeConversationId: CONV,
  currentConversationId: null,
  unreadOutputIds: {},
  pendingSteer: '',
  messages: [],
  conversations: {},
  activeSkillByConv: {},
  activeGoalByConv: {},
  aiByConv: {},
});

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  global.fetch = vi.fn();
  const mod = await import('./chat.js');
  chat = mod.default;
  state = makeState();
  // Real mutations, real state — only the commit indirection is stubbed.
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
});

describe('SET_CONV_AI mutation', () => {
  it('stores an atomic { provider, model } pair per conversation', () => {
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: { provider: 'anthropic', model: 'claude-x' } });
    expect(state.aiByConv[CONV]).toEqual({ provider: 'anthropic', model: 'claude-x' });
  });

  it('is atomic: a partial pair clears instead of half-applying', () => {
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: { provider: 'anthropic', model: 'claude-x' } });
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: { provider: 'openai' } });
    expect(state.aiByConv[CONV]).toBeUndefined();
  });

  it('null clears the entry', () => {
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: { provider: 'a', model: 'm' } });
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: null });
    expect(state.aiByConv[CONV]).toBeUndefined();
  });

  it('does not leak into other conversations', () => {
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: { provider: 'a', model: 'm' } });
    chat.mutations.SET_CONV_AI(state, { conversationId: 'conv-2', ai: { provider: 'b', model: 'n' } });
    expect(state.aiByConv[CONV]).toEqual({ provider: 'a', model: 'm' });
    expect(state.aiByConv['conv-2']).toEqual({ provider: 'b', model: 'n' });
  });
});

describe('MIGRATE_CONTEXT_BINDINGS', () => {
  it('carries the AI override from the temp id to the server id', () => {
    const tempId = 'temp-123';
    chat.mutations.SET_CONV_AI(state, { conversationId: tempId, ai: { provider: 'groq', model: 'llama' } });
    chat.mutations.MIGRATE_CONTEXT_BINDINGS(state, { oldId: tempId, newId: 'uuid-9' });
    expect(state.aiByConv[tempId]).toBeUndefined();
    expect(state.aiByConv['uuid-9']).toEqual({ provider: 'groq', model: 'llama' });
  });
});

describe('setConversationAi / clearConversationAi actions', () => {
  const runAction = (action, payload) => {
    const dispatch = vi.fn((type, p) => {
      const fn = chat.actions[type];
      if (fn) return fn({ commit, state, dispatch }, p);
      return Promise.resolve();
    });
    return chat.actions[action]({ commit, state, dispatch }, payload);
  };

  it('persists a real conversation id via PATCH /conversations/:id/settings', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await runAction('setConversationAi', { conversationId: CONV, provider: 'anthropic', model: 'claude-x' });

    expect(state.aiByConv[CONV]).toEqual({ provider: 'anthropic', model: 'claude-x' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(`http://localhost:3333/conversations/${CONV}/settings`);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ provider: 'anthropic', model: 'claude-x' });
  });

  it('skips the network for temp- ids (persisted later by the migration path)', async () => {
    await runAction('setConversationAi', { conversationId: 'temp-42', provider: 'a', model: 'm' });
    expect(state.aiByConv['temp-42']).toEqual({ provider: 'a', model: 'm' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clearConversationAi clears Vuex and PATCHes nulls', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: { provider: 'a', model: 'm' } });

    await runAction('clearConversationAi', { conversationId: CONV });

    expect(state.aiByConv[CONV]).toBeUndefined();
    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ provider: null, model: null });
  });

  it('survives a failed PATCH without losing the Vuex state', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    await runAction('setConversationAi', { conversationId: CONV, provider: 'a', model: 'm' });
    expect(state.aiByConv[CONV]).toEqual({ provider: 'a', model: 'm' });
  });
});

describe('send path resolves the conversation override', () => {
  /** Mock a stream that ends immediately — we only care about the request. */
  const mockEmptyStream = () => {
    global.fetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true }) }) },
    });
  };

  const send = async () => {
    const dispatch = vi.fn(() => Promise.resolve());
    await chat.actions.startStreamingConversation(
      { commit, state, dispatch, rootState: { aiProvider: {} } },
      { userInput: 'hello', provider: 'global-provider', model: 'global-model' },
    );
    // The orchestrator request is the only fetch this path makes.
    const call = global.fetch.mock.calls.find(([url]) => String(url).includes('/orchestrator/chat'));
    expect(call).toBeTruthy();
    return JSON.parse(call[1].body);
  };

  it('override wins over the caller-passed global pair and disables default write-back', async () => {
    mockEmptyStream();
    chat.mutations.SET_CONV_AI(state, { conversationId: CONV, ai: { provider: 'pinned-p', model: 'pinned-m' } });

    const body = await send();

    expect(body.provider).toBe('pinned-p');
    expect(body.model).toBe('pinned-m');
    expect(body.persistDefault).toBe(false);
  });

  it('without an override the caller pair is used and persistDefault is omitted', async () => {
    mockEmptyStream();

    const body = await send();

    expect(body.provider).toBe('global-provider');
    expect(body.model).toBe('global-model');
    expect('persistDefault' in body).toBe(false);
  });
});
