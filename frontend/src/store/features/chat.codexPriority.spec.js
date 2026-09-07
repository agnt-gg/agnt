import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
import chat from './chat.js';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) },
  })));
});
afterEach(() => vi.unstubAllGlobals());

for (const multipart of [false, true]) {
  describe(multipart ? 'main chat multipart' : 'main chat JSON', () => {
    it.each([true, false, undefined])('carries priority %s independently when routing is deferred', async (codexPriority) => {
      const state = {
        activeConversationId: 'fixture-conv', currentConversationId: null,
        unreadOutputIds: {}, pendingSteer: '', messages: [], conversations: {},
        activeSkillByConv: {}, activeGoalByConv: {}, aiByConv: {},
      };
      const commit = (type, payload) => chat.mutations[type]?.(state, payload);
      await chat.actions.startStreamingConversation(
        { state, commit, dispatch: vi.fn(async () => {}), rootState: { aiProvider: { codexPriority } } },
        { userInput: 'fixture', reasoningValue: 'max', files: multipart ? [new File(['test'], 'test.txt')] : [] },
      );
      const request = fetch.mock.calls.find(([url]) => String(url).endsWith('/orchestrator/chat'));
      expect(request).toBeTruthy();
      const body = request[1].body;
      const fields = multipart ? Object.fromEntries(body.entries()) : JSON.parse(body);
      expect(fields).not.toHaveProperty('provider');
      expect(fields.reasoningValue).toBe('max');
      if (codexPriority === true) expect(fields.codexPriority).toBe(multipart ? 'true' : true);
      else expect(fields).not.toHaveProperty('codexPriority');
    });
  });
}
