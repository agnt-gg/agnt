import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchActiveRuns = vi.fn(async () => []);
vi.mock('./chatService.js', () => ({ fetchActiveRuns: (...a) => fetchActiveRuns(...a) }));
vi.mock('./inflightRuns.js', () => ({ listInflightRuns: () => [] }));
vi.mock('./clientId.js', () => ({ isOwnAnnouncement: () => false }));

const { catchUpAfterResume, pendingCatchUp, resetCatchUpStateForTests, CATCH_UP_MIN_INTERVAL_MS } = await import('./runResume.js');

const CATCH_UP_ACTIONS = ['chatUnified/catchUpChannels', 'chat/catchUpConversations'];
const makeStore = (impl) => ({ dispatch: vi.fn(impl || (async () => ({ checked: 1, updated: 0 }))) });
const passes = (store) => store.dispatch.mock.calls.filter(([type]) => type === 'chatUnified/catchUpChannels').length;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  resetCatchUpStateForTests();
  localStorage.setItem('token', 't');
});

describe('catching up after the page was away', () => {
  it('refreshes both chat stores first, then rejoins whatever the server says is still running', async () => {
    const store = makeStore();
    const result = await catchUpAfterResume(store, { reason: 'reconnect' });
    await flush();
    expect(store.dispatch.mock.calls.map(([type]) => type)).toEqual(CATCH_UP_ACTIONS);
    expect(result).toEqual({ channels: { checked: 1, updated: 0 }, conversations: { checked: 1, updated: 0 } });
    expect(fetchActiveRuns).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a signed-in session', async () => {
    localStorage.removeItem('token');
    const store = makeStore();
    expect(await catchUpAfterResume(store, { reason: 'reconnect' })).toBeNull();
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('coalesces overlapping triggers into one extra pass', async () => {
    const releases = [];
    const store = makeStore(() => new Promise((resolve) => releases.push(resolve)));
    const first = catchUpAfterResume(store, { reason: 'visible' });
    const second = catchUpAfterResume(store, { reason: 'reconnect' });
    const third = catchUpAfterResume(store, { reason: 'reconnect' });
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(pendingCatchUp()).toBe(first);

    releases.splice(0).forEach((release) => release({ checked: 1, updated: 0 }));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release({ checked: 1, updated: 0 }));
    await first;

    expect(passes(store)).toBe(2);
    expect(pendingCatchUp()).toBeNull();
  });

  it('a quick look-away does not refetch, a socket reconnect always does', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const store = makeStore();
    await catchUpAfterResume(store, { reason: 'visible' });
    await catchUpAfterResume(store, { reason: 'visible' });
    expect(passes(store)).toBe(1);

    await catchUpAfterResume(store, { reason: 'reconnect' });
    expect(passes(store)).toBe(2);

    vi.setSystemTime(1_000_000 + CATCH_UP_MIN_INTERVAL_MS + 1);
    await catchUpAfterResume(store, { reason: 'visible' });
    expect(passes(store)).toBe(3);
  });

  it('a failing refresh is reported and clears the in-flight marker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = makeStore(async () => { throw new Error('offline'); });
    expect(await catchUpAfterResume(store, { reason: 'reconnect' })).toBeNull();
    expect(pendingCatchUp()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
