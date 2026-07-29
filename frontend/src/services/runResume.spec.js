/**
 * runResume — the single boot-time sweep that reattaches every abandoned turn.
 *
 * One call site serves both chat stores. The marker says which store owns each
 * run, so a new chat surface inherits resume for free.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const listInflightRuns = vi.fn();
vi.mock('./inflightRuns.js', () => ({
  listInflightRuns: (...args) => listInflightRuns(...args),
}));

import { resumeInflightRuns } from './runResume.js';

const makeStore = () => ({ dispatch: vi.fn(() => Promise.resolve(true)) });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 'a-token');
  listInflightRuns.mockReturnValue([]);
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
