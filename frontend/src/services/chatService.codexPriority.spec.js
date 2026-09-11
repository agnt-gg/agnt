import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from './chatService.js';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status: 503, statusText: 'synthetic stop', text: async () => '',
  })));
});
afterEach(() => vi.unstubAllGlobals());

for (const multipart of [false, true]) {
  describe(multipart ? 'multipart priority' : 'JSON priority', () => {
    it.each([undefined, false, true, 'false'])('serializes %s without changing max reasoning', async (codexPriority) => {
      await expect(streamChat({
        chatType: 'orchestrator', messages: [{ role: 'user', content: 'fixture' }],
        provider: 'openai-codex', model: 'gpt-6-astra', reasoningValue: 'max', codexPriority,
        files: multipart ? [new File(['fixture'], 'fixture.txt')] : [], onEvent: () => {},
      })).rejects.toThrow('synthetic stop');
      expect(fetch).toHaveBeenCalledTimes(1);
      const body = fetch.mock.calls[0][1].body;
      const fields = multipart ? Object.fromEntries(body.entries()) : JSON.parse(body);
      expect(fields.reasoningValue).toBe('max');
      if (codexPriority === undefined) expect(fields).not.toHaveProperty('codexPriority');
      else expect(fields.codexPriority).toBe(multipart ? String(codexPriority === true) : codexPriority === true);
    });
  });
}
