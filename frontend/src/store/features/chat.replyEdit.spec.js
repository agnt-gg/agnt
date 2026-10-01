// Main chat: editing the latest assistant reply in place.
//
// Pinned here:
//  1. The edit changes only the reply's closing text, saves immediately, and
//     mirrors to the server transcript with the text it replaced.
//  2. THE CACHE CONTRACT: the history sent on the next turn is byte-identical
//     to the unedited one in every entry before the edited reply's closing
//     round. That prefix is what the provider has cached.
//  3. Refusals: streaming, a reply that is no longer the latest, empty text.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));
vi.mock('@/services/chatService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveReplyEdit: vi.fn(async () => ({ ok: true, status: 200 })),
}));

const CONV = 'conv-1';

let chat;
let buildChatHistory;
let saveReplyEdit;
let state;
let commit;
let dispatch;

const conversation = () => [
  { id: 'u1', role: 'user', content: 'Find the bug.' },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Looking. It is in parse().',
    contentParts: [
      { type: 'text', text: 'Looking. ' },
      { type: 'tool_call', toolCallId: 'tc-1' },
      { type: 'text', text: 'It is in parse().' },
    ],
    toolCalls: [{ id: 'tc-1', name: 'grep_files', args: { pattern: 'parse' }, result: 'parse.js:10' }],
  },
  { id: 'u2', role: 'user', content: 'Fix it.' },
  {
    id: 'a2',
    role: 'assistant',
    content: 'Editing. Fixed: off-by-one on line 10.',
    contentParts: [
      { type: 'text', text: 'Editing. ' },
      { type: 'tool_call', toolCallId: 'tc-2' },
      { type: 'text', text: 'Fixed: off-by-one on line 10.' },
    ],
    toolCalls: [{ id: 'tc-2', name: 'edit_file', args: { path: 'parse.js' }, result: 'ok' }],
    reasoning: 'the loop bound',
    reasoning_content: 'the loop bound',
  },
];

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  global.fetch = vi.fn();
  const mod = await import('./chat.js');
  chat = mod.default;
  buildChatHistory = mod.buildChatHistory;
  saveReplyEdit = (await import('@/services/chatService.js')).saveReplyEdit;
  saveReplyEdit.mockClear();
  state = {
    activeConversationId: CONV,
    conversations: {
      [CONV]: { conversationId: 'srv-1', messages: conversation(), isStreaming: false, _activeStreams: 0 },
    },
  };
  commit = vi.fn((type, payload) => chat.mutations[type](state, payload));
  dispatch = vi.fn();
});

const edit = (payload) => chat.actions.editLastReply({ commit, state, dispatch }, payload);
const messages = () => state.conversations[CONV].messages;

describe('editLastReply', () => {
  it('replaces only the closing text, saves now, and mirrors to the server', async () => {
    const result = await edit({ conversationId: CONV, messageId: 'a2', content: '  Fixed: bound was <= not <.  ' });

    expect(result).toEqual({ ok: true, serverSynced: true });
    const reply = messages()[3];
    expect(reply.contentParts[2].text).toBe('Fixed: bound was <= not <.');
    expect(reply.content).toBe('Editing. Fixed: bound was <= not <.');
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply).not.toHaveProperty('reasoning');
    expect(dispatch).toHaveBeenCalledWith('autosaveConversation', { debounce: false, conversationId: CONV });
    expect(saveReplyEdit).toHaveBeenCalledWith('srv-1', {
      previousText: 'Fixed: off-by-one on line 10.',
      content: 'Fixed: bound was <= not <.',
    });
  });

  it('keeps the cached prefix of the next request byte-identical', async () => {
    const before = buildChatHistory(messages(), 'anthropic');
    await edit({ conversationId: CONV, messageId: 'a2', content: 'Fixed: bound was <= not <.' });
    const after = buildChatHistory(messages(), 'anthropic');

    expect(after).toHaveLength(before.length);
    const last = before.length - 1;
    // Everything up to the closing round — every earlier turn, and this
    // reply's own tool round — is exactly what the provider already cached.
    expect(JSON.stringify(after.slice(0, last))).toBe(JSON.stringify(before.slice(0, last)));
    expect(after[last]).toEqual({ role: 'assistant', content: 'Fixed: bound was <= not <.' });
    expect(before[last]).toEqual({ role: 'assistant', content: 'Fixed: off-by-one on line 10.' });
  });

  it('refuses while the conversation is streaming', async () => {
    state.conversations[CONV].isStreaming = true;
    expect(await edit({ conversationId: CONV, messageId: 'a2', content: 'x' })).toEqual({ ok: false, reason: 'streaming' });
    expect(commit).not.toHaveBeenCalled();
    expect(saveReplyEdit).not.toHaveBeenCalled();
  });

  it('refuses an earlier reply', async () => {
    expect(await edit({ conversationId: CONV, messageId: 'a1', content: 'x' })).toEqual({ ok: false, reason: 'not-latest-reply' });
    expect(messages()[1].content).toBe('Looking. It is in parse().');
  });

  it('refuses empty text', async () => {
    expect(await edit({ conversationId: CONV, messageId: 'a2', content: '   ' })).toEqual({ ok: false, reason: 'empty' });
  });

  it('is a no-op when the text did not change', async () => {
    expect(await edit({ conversationId: CONV, messageId: 'a2', content: 'Fixed: off-by-one on line 10.' }))
      .toEqual({ ok: true, unchanged: true });
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not call the server for a conversation that has no server id yet', async () => {
    state.conversations[CONV].conversationId = 'temp-123';
    expect(await edit({ conversationId: CONV, messageId: 'a2', content: 'New.' })).toEqual({ ok: true, serverSynced: false });
    expect(saveReplyEdit).not.toHaveBeenCalled();
  });

  it('keeps the local edit when the server refuses', async () => {
    saveReplyEdit.mockResolvedValueOnce({ ok: false, status: 409, error: 'text-mismatch' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await edit({ conversationId: CONV, messageId: 'a2', content: 'New.' })).toEqual({ ok: true, serverSynced: false });
    expect(messages()[3].contentParts[2].text).toBe('New.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('SCOPED_EDIT_LAST_REPLY', () => {
  it('ignores a message that is no longer the latest reply', () => {
    state.conversations[CONV].messages.push({ id: 'u3', role: 'user', content: 'and?' });
    chat.mutations.SCOPED_EDIT_LAST_REPLY(state, { conversationId: CONV, messageId: 'a2', content: 'x' });
    expect(messages()[3].contentParts[2].text).toBe('Fixed: off-by-one on line 10.');
  });
});
