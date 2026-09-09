import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('@/services/chatService.js', () => ({
  streamChat: vi.fn(async () => {}), toChatHistory: () => [], reattachRun: vi.fn(),
  cancelRun: vi.fn(), fetchConversation: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: () => ({ provider: 'openai-codex', model: 'gpt-6-astra' }),
  resolveChannelRouting: () => ({ mode: 'default' }), resolveChannelEnabledTools: () => [],
}));
import chat from './chatUnified.js';
import { streamChat } from '@/services/chatService.js';

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

it.each([true, false, undefined])('unified chat carries priority %s without changing reasoning or routing', async (codexPriority) => {
  const state = {
    conversations: {}, streamingChannels: {}, loadingSuggestionsChannels: {},
    expandedToolCalls: {}, runningToolCalls: {}, messageStates: {}, abortControllers: {},
    pendingSteers: {}, imageCaches: {}, dataCaches: {}, _migrated: {},
  };
  const commit = (type, payload) => chat.mutations[type]?.(state, payload);
  await chat.actions.sendMessage({
    state, commit, dispatch: vi.fn(async () => {}), rootState: { aiProvider: { codexPriority, reasoningValue: 'max' } },
  }, { channelKey: 'agent:fixture', chatType: 'agent', content: 'fixture' });
  expect(streamChat).toHaveBeenCalledTimes(1);
  expect(streamChat.mock.calls[0][0]).toMatchObject({
    reasoningValue: 'max', provider: undefined, routingMode: 'default',
    codexPriority: codexPriority === true || undefined,
  });
  expect(fetch).not.toHaveBeenCalled();
});
