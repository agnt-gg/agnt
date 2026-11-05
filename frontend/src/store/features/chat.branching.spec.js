// Main chat: Delete from here, and Fork from here.
//
// Pinned here:
//  1. Delete cuts the local transcript, saves it NOW (a debounced save loses
//     to a reload or another device), and mirrors the cut to the server
//     transcript; a server refusal keeps the local delete.
//  2. Delete never empties a conversation (that is Clear) and never runs
//     under a live turn.
//  3. Fork asks the server to fork its state first and saves the new row
//     under the id the server minted; without a server cut it still forks,
//     under a fresh id of its own — never the source's.
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
  truncateConversation: vi.fn(async () => ({ ok: true, status: 200 })),
  forkConversation: vi.fn(async () => ({ ok: true, status: 200, conversationId: 'srv-fork' })),
}));

const CONV = 'conv-1';

let chat;
let service;
let state;
let commit;
let dispatch;
let rootState;

const conversation = () => [
  { id: 'g', role: 'assistant', content: "Hi! I'm Annie." },
  { id: 'u1', role: 'user', content: 'Find the bug.' },
  { id: 'a1', role: 'assistant', content: 'It is in parse().' },
  { id: 'u2', role: 'user', content: 'Fix it.' },
  { id: 'a2', role: 'assistant', content: 'Fixed.' },
];

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem('token', 'tok');
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'out-fork', output: { id: 'out-fork', title: 'Fork: Bug hunt' } }),
  }));
  chat = (await import('./chat.js')).default;
  service = await import('@/services/chatService.js');
  service.truncateConversation.mockClear();
  service.forkConversation.mockClear();
  state = {
    activeConversationId: CONV,
    conversations: {
      [CONV]: { conversationId: 'srv-1', messages: conversation(), isStreaming: false, _activeStreams: 0, savedOutputId: 'out-1', savedOutputTitle: 'Bug hunt' },
    },
  };
  rootState = { contentOutputs: { outputs: [{ id: 'out-1', title: 'Bug hunt (renamed)' }] } };
  commit = vi.fn((type, payload) => chat.mutations[type](state, payload));
  dispatch = vi.fn(() => Promise.resolve());
});

const del = (payload) => chat.actions.deleteFromMessage({ commit, state, dispatch }, { conversationId: CONV, ...payload });
const fork = (payload) => chat.actions.forkFromMessage({ state, dispatch, rootState }, { conversationId: CONV, ...payload });
const ids = () => state.conversations[CONV].messages.map((m) => m.id);

describe('deleteFromMessage', () => {
  it('cuts here and after, saves now, and mirrors the cut to the server', async () => {
    expect(await del({ messageId: 'u2' })).toEqual({ ok: true, removed: 2, serverSynced: true });
    expect(ids()).toEqual(['g', 'u1', 'a1']);
    expect(dispatch).toHaveBeenCalledWith('autosaveConversation', { debounce: false, conversationId: CONV });
    expect(service.truncateConversation).toHaveBeenCalledWith('srv-1', { anchorText: 'Fix it.', sameTextAfter: 0, mode: 'before' });
  });

  it('deleting a reply keeps the message it answered', async () => {
    await del({ messageId: 'a1' });
    expect(ids()).toEqual(['g', 'u1']);
    expect(service.truncateConversation).toHaveBeenCalledWith('srv-1', { anchorText: 'Find the bug.', sameTextAfter: 0, mode: 'through' });
  });

  it('keeps the local delete when the server refuses the cut', async () => {
    service.truncateConversation.mockResolvedValueOnce({ ok: false, status: 409, error: 'anchor-not-found' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await del({ messageId: 'u2' })).toEqual({ ok: true, removed: 2, serverSynced: false });
    expect(ids()).toEqual(['g', 'u1', 'a1']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not call the server for a conversation it has never seen', async () => {
    state.conversations[CONV].conversationId = 'temp-1';
    expect(await del({ messageId: 'u2' })).toMatchObject({ ok: true, serverSynced: false });
    expect(service.truncateConversation).not.toHaveBeenCalled();
  });

  it('refuses to empty the conversation, to run under a live turn, or an unknown message', async () => {
    state.conversations[CONV].messages.shift(); // no greeting: u1 is now first
    expect(await del({ messageId: 'u1' })).toEqual({ ok: false, reason: 'would-empty' });
    state.conversations[CONV].isStreaming = true;
    expect(await del({ messageId: 'a1' })).toEqual({ ok: false, reason: 'streaming' });
    state.conversations[CONV].isStreaming = false;
    expect(await del({ messageId: 'nope' })).toEqual({ ok: false, reason: 'not-found' });
    expect(commit).not.toHaveBeenCalled();
    expect(service.truncateConversation).not.toHaveBeenCalled();
  });
});

describe('forkFromMessage', () => {
  const savedBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

  it('forks the server state, then saves the fork under the id the server minted', async () => {
    expect(await fork({ messageId: 'u2' })).toEqual({ ok: true, outputId: 'out-fork', conversationId: 'srv-fork', contextCopied: true });
    expect(service.forkConversation).toHaveBeenCalledWith('srv-1', { anchorText: 'Fix it.', sameTextAfter: 0, mode: 'through' });

    expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:3333/content-outputs/save');
    const body = savedBody();
    expect(body).toMatchObject({ conversationId: 'srv-fork', contentType: 'conversation', title: 'Fork: Bug hunt (renamed)' });
    expect(body.id).toBeUndefined(); // a new row, never the source's
    const saved = JSON.parse(body.content);
    expect(saved.conversationId).toBe('srv-fork');
    expect(saved.messages.map((m) => m.id)).toEqual(['g', 'u1', 'a1', 'u2']);
    expect(dispatch).toHaveBeenCalledWith('contentOutputs/applyOutputMeta', expect.objectContaining({ output: { id: 'out-fork', title: 'Fork: Bug hunt' } }), { root: true });
  });

  it('leaves the source conversation exactly as it was', async () => {
    await fork({ messageId: 'a1' });
    expect(ids()).toEqual(['g', 'u1', 'a1', 'u2', 'a2']);
    expect(service.forkConversation).toHaveBeenCalledWith('srv-1', { anchorText: 'Find the bug.', sameTextAfter: 0, mode: 'turn' });
  });

  it('still forks, under a fresh id, when the server cannot place the cut', async () => {
    service.forkConversation.mockResolvedValueOnce({ ok: false, status: 409, error: 'anchor-not-found' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fork({ messageId: 'u2' });
    expect(result).toMatchObject({ ok: true, outputId: 'out-fork', contextCopied: false });
    expect(result.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.conversationId).not.toBe('srv-1');
    expect(savedBody().conversationId).toBe(result.conversationId);
    warn.mockRestore();
  });

  it('reports a save that failed', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fork({ messageId: 'u2' })).toEqual({ ok: false, reason: 'save-failed' });
    error.mockRestore();
  });

  it('refuses an agent chat, a live turn, a missing message and a signed-out session', async () => {
    state.conversations[CONV].agentId = 'agent-1';
    expect(await fork({ messageId: 'u2' })).toEqual({ ok: false, reason: 'agent-chat' });
    state.conversations[CONV].agentId = null;
    state.conversations[CONV]._activeStreams = 1;
    expect(await fork({ messageId: 'u2' })).toEqual({ ok: false, reason: 'streaming' });
    state.conversations[CONV]._activeStreams = 0;
    expect(await fork({ messageId: 'nope' })).toEqual({ ok: false, reason: 'not-found' });
    localStorage.removeItem('token');
    expect(await fork({ messageId: 'u2' })).toEqual({ ok: false, reason: 'signed-out' });
    expect(service.forkConversation).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
