import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Node 22+ / some jsdom combos leave `localStorage` undefined at module load
// (user.config.js reads it at import time). Provide a minimal store first.
function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
  }
}
ensureLocalStorage();

const {
  resolveLiteProviderModel,
  listConversations,
  loadConversation,
  newConversationId,
} = await import('./mobileLiteApi.js');

describe('mobileLiteApi', () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('resolveLiteProviderModel prefers localStorage provider/model', () => {
    localStorage.setItem('selectedProvider', 'openai');
    localStorage.setItem('selectedModel', 'gpt-4o');
    expect(resolveLiteProviderModel()).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    });
  });

  it('resolveLiteProviderModel prefers orchestrator channel override', () => {
    localStorage.setItem('selectedProvider', 'openai');
    localStorage.setItem('selectedModel', 'gpt-4o');
    localStorage.setItem(
      'agnt_chat_channel_configs',
      JSON.stringify({
        'orchestrator:default': { provider: 'anthropic', model: 'claude-sonnet-4' },
      }),
    );
    expect(resolveLiteProviderModel()).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
    });
  });

  it('listConversations maps snake_case content_type rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          outputs: [
            {
              id: '1',
              title: 'Hello',
              content_type: 'conversation',
              conversation_id: 'c1',
              updated_at: '2026-01-01',
            },
            { id: '2', title: 'Widget', content_type: 'html' },
          ],
        }),
      })),
    );
    localStorage.setItem('token', 't');
    const list = await listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: '1',
      title: 'Hello',
      conversationId: 'c1',
    });
  });

  it('loadConversation parses JSON content from row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: 'out-1',
          title: 'Fallback',
          conversation_id: 'from-row',
          content: JSON.stringify({
            conversationId: 'from-payload',
            title: 'From payload',
            messages: [{ id: 'm1', role: 'user', content: 'hi' }],
          }),
        }),
      })),
    );
    localStorage.setItem('token', 't');
    const conv = await loadConversation('out-1');
    expect(conv.outputId).toBe('out-1');
    expect(conv.title).toBe('From payload');
    expect(conv.conversationId).toBe('from-payload');
    expect(conv.messages).toHaveLength(1);
  });

  it('newConversationId returns a non-empty string', () => {
    expect(String(newConversationId()).length).toBeGreaterThan(8);
  });
});
