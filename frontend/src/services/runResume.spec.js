/**
 * runResume — the single boot-time sweep that reattaches every abandoned turn.
 *
 * One call site serves both chat stores. The marker says which store owns each
 * run, so a new chat surface inherits resume for free.
 *
 * It now draws on TWO sources, because the local marker cannot cross a browser
 * boundary: localStorage is per-profile, so a run started in Chrome left no
 * trace Safari or the Mac app could read. The server list is what makes a task
 * started on one machine resumable on another.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const listInflightRuns = vi.fn();
vi.mock('./inflightRuns.js', () => ({
  listInflightRuns: (...args) => listInflightRuns(...args),
}));

const fetchActiveRuns = vi.fn();
vi.mock('./chatService.js', () => ({
  fetchActiveRuns: (...args) => fetchActiveRuns(...args),
}));

import { resumeInflightRuns, mergeRunSources, adoptAnnouncedRun, findChannelForConversation } from './runResume.js';
// The REAL client id, not a mock: echo suppression is the thing under test, and
// a stubbed identity would prove nothing about it.
import { getClientId } from './clientId.js';

const makeStore = (chatUnifiedConversations = {}) => ({
  dispatch: vi.fn(() => Promise.resolve(true)),
  state: { chatUnified: { conversations: chatUnifiedConversations } },
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 'a-token');
  listInflightRuns.mockReturnValue([]);
  fetchActiveRuns.mockResolvedValue([]);
});

describe('routing a marker to the store that owns it', () => {
  it('sends a channel-keyed run to the sidebar store', async () => {
    listInflightRuns.mockReturnValue([
      { conversationId: 'c1', chatType: 'agent', channelKey: 'agent:7', startedAt: Date.now() },
    ]);
    const store = makeStore();

    await resumeInflightRuns(store);

    expect(store.dispatch).toHaveBeenCalledWith('chatUnified/reattachChannel', {
      channelKey: 'agent:7',
      conversationId: 'c1',
    });
  });

  it('sends a run with no channel to the main chat store', async () => {
    listInflightRuns.mockReturnValue([
      { conversationId: 'c2', chatType: 'orchestrator', channelKey: null, startedAt: Date.now() },
    ]);
    const store = makeStore();

    await resumeInflightRuns(store);

    expect(store.dispatch).toHaveBeenCalledWith('chat/reattachConversation', 'c2');
  });

  it('resumes several abandoned turns at once', async () => {
    listInflightRuns.mockReturnValue([
      { conversationId: 'c1', channelKey: 'agent:1', startedAt: Date.now() },
      { conversationId: 'c2', channelKey: null, startedAt: Date.now() },
      { conversationId: 'c3', channelKey: 'tool:3', startedAt: Date.now() },
    ]);
    const store = makeStore();

    const result = await resumeInflightRuns(store);

    expect(store.dispatch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ attempted: 3, resumed: 3 });
  });

  it('counts only the runs that were actually still alive', async () => {
    listInflightRuns.mockReturnValue([
      { conversationId: 'c1', channelKey: 'agent:1', startedAt: Date.now() },
      { conversationId: 'c2', channelKey: 'agent:2', startedAt: Date.now() },
    ]);
    const store = makeStore();
    store.dispatch
      .mockResolvedValueOnce(true)   // still running
      .mockResolvedValueOnce(false); // already finished (204)

    expect(await resumeInflightRuns(store)).toEqual({ attempted: 2, resumed: 1 });
  });
});

describe('does nothing when there is nothing to do', () => {
  it('skips entirely with no markers', async () => {
    const store = makeStore();
    expect(await resumeInflightRuns(store)).toEqual({ attempted: 0, resumed: 0 });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('skips when not signed in', async () => {
    localStorage.removeItem('token');
    listInflightRuns.mockReturnValue([
      { conversationId: 'c1', channelKey: 'agent:1', startedAt: Date.now() },
    ]);
    const store = makeStore();

    // Every reattach would 401 and clear markers a logged-in session could
    // still have used.
    expect(await resumeInflightRuns(store)).toEqual({ attempted: 0, resumed: 0 });
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('tolerates being called without a store', async () => {
    expect(await resumeInflightRuns(null)).toEqual({ attempted: 0, resumed: 0 });
  });
});

describe('picking up a run this client never started', () => {
  it('reattaches a run known only to the server — the cross-device case', async () => {
    // No local marker: this browser has never seen the conversation.
    listInflightRuns.mockReturnValue([]);
    fetchActiveRuns.mockResolvedValue([
      { conversationId: 'c-remote', chatType: 'orchestrator', active: true, channelKey: null, startedAt: Date.now() },
    ]);
    const store = makeStore();

    const result = await resumeInflightRuns(store);

    expect(store.dispatch).toHaveBeenCalledWith('chat/reattachConversation', 'c-remote');
    expect(result).toEqual({ attempted: 1, resumed: 1 });
  });

  it('asks the server even when there are no local markers', async () => {
    // The old code returned early on an empty marker list, which is exactly
    // the state every OTHER device is in. Asking unconditionally is the fix.
    await resumeInflightRuns(makeStore());
    expect(fetchActiveRuns).toHaveBeenCalled();
  });

  it('routes a server run to the surface that owns it', async () => {
    fetchActiveRuns.mockResolvedValue([
      { conversationId: 'c-ws', chatType: 'orchestrator', active: true, channelKey: 'workspace:ws-1', startedAt: Date.now() },
    ]);
    const store = makeStore();

    await resumeInflightRuns(store);

    expect(store.dispatch).toHaveBeenCalledWith('chatUnified/reattachChannel', {
      channelKey: 'workspace:ws-1',
      conversationId: 'c-ws',
    });
  });

  it('reattaches each conversation once when both sources report it', async () => {
    listInflightRuns.mockReturnValue([{ conversationId: 'c-dup', channelKey: null, startedAt: Date.now() }]);
    fetchActiveRuns.mockResolvedValue([{ conversationId: 'c-dup', active: true, channelKey: null, startedAt: Date.now() }]);
    const store = makeStore();

    const result = await resumeInflightRuns(store);

    // Two SSE reattaches to one conversation would replay the turn twice.
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(1);
  });

  it('falls back to local markers when the server cannot be reached', async () => {
    fetchActiveRuns.mockResolvedValue([]); // the service swallows its own errors
    listInflightRuns.mockReturnValue([{ conversationId: 'c-local', channelKey: null, startedAt: Date.now() }]);
    const store = makeStore();

    // Degrades to exactly the behaviour that shipped before the endpoint
    // existed, rather than losing resume altogether.
    expect(await resumeInflightRuns(store)).toEqual({ attempted: 1, resumed: 1 });
  });

  it('does not call the server when signed out', async () => {
    localStorage.removeItem('token');
    await resumeInflightRuns(makeStore());
    expect(fetchActiveRuns).not.toHaveBeenCalled();
  });
});

describe('merging the two sources', () => {
  const local = { conversationId: 'c1', channelKey: 'workspace:ws-1', startedAt: 1 };

  it('keeps one entry per conversation', () => {
    expect(mergeRunSources([local], [{ conversationId: 'c1', active: true }])).toHaveLength(1);
  });

  it('lets the server override a stale local marker', () => {
    // The marker records only that a turn STARTED; it cannot know the run has
    // since ended, so the server's view has to win.
    const [run] = mergeRunSources([{ ...local, active: true }], [{ conversationId: 'c1', active: false, ended: true }]);
    expect(run).toMatchObject({ active: false, ended: true });
  });

  it('keeps the local channelKey when the server has none yet', () => {
    // A conversation younger than its first autosave has no stored row, so the
    // server returns channelKey null. Taking that literally would drop a
    // workspace turn into the main chat window.
    const [run] = mergeRunSources([local], [{ conversationId: 'c1', active: true, channelKey: null }]);
    expect(run.channelKey).toBe('workspace:ws-1');
  });

  it('prefers the server channelKey when it has one', () => {
    const [run] = mergeRunSources([local], [{ conversationId: 'c1', channelKey: 'artifact:a-9' }]);
    expect(run.channelKey).toBe('artifact:a-9');
  });

  it('ignores entries with no conversation id from either side', () => {
    expect(mergeRunSources([{ channelKey: 'x' }], [{ active: true }])).toEqual([]);
  });

  it('handles either side being absent', () => {
    expect(mergeRunSources([], [])).toEqual([]);
    expect(mergeRunSources(undefined, undefined)).toEqual([]);
    expect(mergeRunSources([local], [])).toHaveLength(1);
  });
});

describe('attaching to a run announced by another client', () => {
  // The push half of resume: a client that is already open and idle polls
  // nothing, so before this it needed a reload to notice a turn started
  // elsewhere.

  it('attaches to a run this client has never seen', async () => {
    const store = makeStore();

    const adopted = await adoptAnnouncedRun(store, {
      conversationId: 'c-announced', chatType: 'orchestrator', originClientId: 'some-other-client',
    });

    expect(store.dispatch).toHaveBeenCalledWith('chat/reattachConversation', 'c-announced');
    expect(adopted).toBe(true);
  });

  it('IGNORES its own announcement', async () => {
    // The sender is already streaming this turn over its own SSE connection.
    // Attaching again forks the conversation in the UI — and for a new
    // conversation the sender cannot recognise the id yet, which is exactly
    // why identity is carried explicitly.
    const store = makeStore();

    const adopted = await adoptAnnouncedRun(store, {
      conversationId: 'c-mine', chatType: 'orchestrator', originClientId: getClientId(),
    });

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(adopted).toBe(false);
  });

  it('treats an unlabelled announcement as someone else\'s', async () => {
    // Failing to attach is the bug being fixed; attaching twice is recoverable.
    // So a missing origin resolves towards attaching.
    const store = makeStore();

    await adoptAnnouncedRun(store, { conversationId: 'c-unlabelled', chatType: 'orchestrator' });

    expect(store.dispatch).toHaveBeenCalledWith('chat/reattachConversation', 'c-unlabelled');
  });

  it('routes to the channel that owns the conversation', async () => {
    const store = makeStore({ 'workspace:ws-1': { conversationId: 'c-ws' } });

    await adoptAnnouncedRun(store, {
      conversationId: 'c-ws', chatType: 'workspace', originClientId: 'other',
    });

    expect(store.dispatch).toHaveBeenCalledWith('chatUnified/reattachChannel', {
      channelKey: 'workspace:ws-1',
      conversationId: 'c-ws',
    });
  });

  it('prefers the owning channel over the main chat', async () => {
    // chatType alone would send this to the main chat window — the wrong
    // surface, leaving the one the user is looking at still spinning.
    const store = makeStore({ 'artifact:a-9': { conversationId: 'c-both' } });

    await adoptAnnouncedRun(store, {
      conversationId: 'c-both', chatType: 'orchestrator', originClientId: 'other',
    });

    expect(store.dispatch).toHaveBeenCalledWith('chatUnified/reattachChannel', expect.objectContaining({
      channelKey: 'artifact:a-9',
    }));
  });

  it('does not invent a main-chat conversation for an embedded surface', async () => {
    // No local channel owns it and it is not a main-chat type: this client has
    // nowhere to put the turn, and adopting it would add a conversation the
    // user never opened here. The surface hydrates it when opened.
    const store = makeStore();

    const adopted = await adoptAnnouncedRun(store, {
      conversationId: 'c-widget', chatType: 'widget', originClientId: 'other',
    });

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(adopted).toBe(false);
  });

  it('adopts agent chats, matching the delta mirror\'s own rule', async () => {
    const store = makeStore();
    await adoptAnnouncedRun(store, {
      conversationId: 'c-agent', chatType: 'agent', originClientId: 'other',
    });
    expect(store.dispatch).toHaveBeenCalledWith('chat/reattachConversation', 'c-agent');
  });

  it('announces the attach at DECISION time, not when the run finishes', async () => {
    // Caught by a real two-tab run: the handler used to log from the dispatch's
    // RESOLVED VALUE, and both reattach actions resolve only when the run ends
    // (the SSE connection is held open for the whole turn). So attaching to a
    // ten-minute task printed nothing for ten minutes — indistinguishable, to
    // anyone watching a console, from not attaching at all.
    //
    // A dispatch that NEVER settles is the whole point of the test: it is what
    // an in-flight run actually looks like.
    const store = {
      dispatch: vi.fn(() => new Promise(() => {})),
      state: { chatUnified: { conversations: {} } },
    };
    const logs = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));

    try {
      adoptAnnouncedRun(store, {
        conversationId: 'c-ten-minutes', chatType: 'orchestrator', originClientId: 'other',
      });
      expect(logs.join('\n')).toMatch(/Attaching to run announced elsewhere: c-ten-minutes/);
      expect(store.dispatch).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('names the surface it is attaching to', async () => {
    const store = makeStore({ 'workspace:ws-2': { conversationId: 'c-ws2' } });
    const logs = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    try {
      await adoptAnnouncedRun(store, { conversationId: 'c-ws2', chatType: 'workspace', originClientId: 'other' });
      // Which surface claimed the run is the first thing worth knowing when a
      // turn lands somewhere the user was not looking.
      expect(logs.join('\n')).toMatch(/c-ws2 → workspace:ws-2/);
    } finally {
      spy.mockRestore();
    }
  });

  it('says nothing when it declines', async () => {
    const store = makeStore();
    const logs = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    try {
      await adoptAnnouncedRun(store, { conversationId: 'c-own', chatType: 'orchestrator', originClientId: getClientId() });
      await adoptAnnouncedRun(store, { conversationId: 'c-widget2', chatType: 'widget', originClientId: 'other' });
      // A decline that announces itself as an attach is worse than silence.
      expect(logs.join('\n')).not.toMatch(/Attaching to run announced elsewhere/);
    } finally {
      spy.mockRestore();
    }
  });

  it('ignores a malformed announcement', async () => {
    const store = makeStore();
    expect(await adoptAnnouncedRun(store, {})).toBe(false);
    expect(await adoptAnnouncedRun(store, { chatType: 'orchestrator' })).toBe(false);
    expect(await adoptAnnouncedRun(null, { conversationId: 'c' })).toBe(false);
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});

describe('finding the surface that owns a conversation', () => {
  it('finds the channel holding the conversation id', () => {
    const store = makeStore({ 'workspace:a': { conversationId: 'c1' }, 'widget:b': { conversationId: 'c2' } });
    expect(findChannelForConversation(store, 'c2')).toBe('widget:b');
  });

  it('returns null when no channel holds it', () => {
    expect(findChannelForConversation(makeStore({ 'workspace:a': { conversationId: 'c1' } }), 'c9')).toBeNull();
  });

  it('survives a store with no channel state at all', () => {
    expect(findChannelForConversation({ state: {} }, 'c1')).toBeNull();
    expect(findChannelForConversation(undefined, 'c1')).toBeNull();
    expect(findChannelForConversation(makeStore(), null)).toBeNull();
  });

  it('ignores channels that have never held a conversation', () => {
    const store = makeStore({ 'workspace:empty': { conversationId: null }, 'workspace:real': { conversationId: 'c1' } });
    expect(findChannelForConversation(store, 'c1')).toBe('workspace:real');
    expect(findChannelForConversation(store, null)).toBeNull();
  });
});

describe('one bad reattach cannot block the others', () => {
  it('still resumes the remaining runs when one rejects', async () => {
    listInflightRuns.mockReturnValue([
      { conversationId: 'c1', channelKey: 'agent:1', startedAt: Date.now() },
      { conversationId: 'c2', channelKey: 'agent:2', startedAt: Date.now() },
    ]);
    const store = makeStore();
    store.dispatch
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);

    const result = await resumeInflightRuns(store);

    expect(result).toEqual({ attempted: 2, resumed: 1 });
    expect(store.dispatch).toHaveBeenCalledTimes(2);
  });
});
