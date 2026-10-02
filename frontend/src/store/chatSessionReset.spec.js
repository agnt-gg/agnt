/**
 * Switching accounts must not carry one account's chat into the next.
 *
 * THE BUG: signing in as a second account on the same install opened onto the
 * first account's conversation. resetUserScopedData cleared every store in
 * USER_SCOPED_MODULES, but neither chat store was in it, chatUnified persists
 * every channel in ONE browser-wide localStorage key, and the Chat screen is
 * kept alive, so it went on showing what it had.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(String(k), String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
    },
    configurable: true,
  });
}
ensureLocalStorage();

vi.mock('@/services/chatService.js', () => ({ cancelRun: vi.fn(async () => {}), reattachRun: vi.fn(), fetchConversation: vi.fn() }));

const { default: chat } = await import('./features/chat.js');
const { default: chatUnified } = await import('./features/chatUnified.js');
const { ACCOUNT_SCOPED_STORAGE_KEYS, clearAccountScopedStorage } = await import('./_utils/accountScopedStorage.js');
const { createNewSessionLanding } = await import('@/views/Terminal/CenterPanel/screens/Chat/newSessionLanding.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** What survives a session end in the chat store, and why. */
const CHAT_SESSION_PRESERVED = new Set([
  'mainChatWindow', // emptied in place; components hold the instance
  'page', // which screen is showing, not account data
  'streamEventCallbacks', // registered once by the kept-alive Chat screen
  'autosaveEnabled', // a device behaviour switch, not account data
]);

/** Compare state values by shape, so a fresh Map equals the initial empty Map. */
const shape = (value) => {
  if (value instanceof Map) return { map: [...value.entries()] };
  if (value instanceof Set) return { set: [...value] };
  return value;
};

describe('chat RESET_FOR_SESSION_END', () => {
  const initial = chat.state;

  function dirtyState() {
    const abort = vi.fn();
    const cancel = vi.fn();
    const convAbort = vi.fn();
    const convCancel = vi.fn();
    const callbacks = [() => {}];
    const state = {};
    for (const key of Object.keys(initial)) state[key] = `account-a:${key}`;
    Object.assign(state, {
      mainChatWindow: initial.mainChatWindow,
      page: 'chat',
      autosaveEnabled: false,
      streamEventCallbacks: callbacks,
      streamAbortController: { abort },
      streamReader: { cancel },
      autosaveDebounceTimer: setTimeout(() => {}, 60_000),
      conversations: {
        'conv-a': {
          messages: [{ role: 'user', content: 'account A secret' }],
          streamAbortController: { abort: convAbort },
          streamReader: { cancel: convCancel },
          autosaveDebounceTimer: setTimeout(() => {}, 60_000),
        },
      },
    });
    return { state, abort, cancel, convAbort, convCancel, callbacks };
  }

  it('resets every field to its initial value except the declared survivors', () => {
    const { state } = dirtyState();
    chat.mutations.RESET_FOR_SESSION_END(state);

    const leaked = Object.keys(initial).filter(
      (key) => !CHAT_SESSION_PRESERVED.has(key) && JSON.stringify(shape(state[key])) !== JSON.stringify(shape(initial[key])),
    );
    expect(leaked, `fields still holding the previous account's value: ${leaked.join(', ')}`).toEqual([]);
  });

  it('stops every live stream and timer, not just the one on screen', () => {
    const { state, abort, cancel, convAbort, convCancel } = dirtyState();
    chat.mutations.RESET_FOR_SESSION_END(state);
    expect(abort).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(convAbort).toHaveBeenCalledOnce();
    expect(convCancel).toHaveBeenCalledOnce();
    expect(state.conversations).toEqual({});
    expect(state.activeConversationId).toBeNull();
  });

  it('keeps the screen\u2019s stream subscriptions, which are registered only once', () => {
    const { state, callbacks } = dirtyState();
    chat.mutations.RESET_FOR_SESSION_END(state);
    expect(state.streamEventCallbacks).toBe(callbacks);
    expect(state.autosaveEnabled).toBe(false);
  });
});

describe('chatUnified RESET_FOR_SESSION_END', () => {
  const freshState = () => ({
    conversations: {},
    streamingChannels: {},
    loadingSuggestionsChannels: {},
    expandedToolCalls: {},
    runningToolCalls: {},
    messageStates: {},
    abortControllers: {},
    pendingSteers: {},
    imageCaches: {},
    dataCaches: {},
    _migrated: {},
  });

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('clears the browser-wide cache, including a write still queued for the previous account', () => {
    const state = freshState();
    chatUnified.mutations.SET_CONVERSATION(state, {
      channelKey: 'orchestrator:default',
      conversation: { messages: [{ role: 'user', content: 'account A secret' }], conversationId: 'c-a' },
    });
    localStorage.setItem('unifiedChatConversations', '{"stale":true}');
    localStorage.setItem('agentChatConversations', '{"legacy":true}');

    chatUnified.mutations.RESET_FOR_SESSION_END(state);
    vi.advanceTimersByTime(10_000); // the debounced write must not land after the clear

    expect(state.conversations).toEqual({});
    expect(localStorage.getItem('unifiedChatConversations')).toBeNull();
    expect(localStorage.getItem('agentChatConversations')).toBeNull();
  });

  it('aborts every channel that is still streaming', () => {
    const state = freshState();
    const abort = vi.fn();
    state.abortControllers = { 'agent:x': { abort } };
    chatUnified.mutations.RESET_FOR_SESSION_END(state);
    expect(abort).toHaveBeenCalledOnce();
    expect(state.abortControllers).toEqual({});
  });
});

describe('account-scoped browser storage', () => {
  beforeEach(() => localStorage.clear());

  it('removes drafts, in-flight runs and context status, and leaves device preferences', () => {
    for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) localStorage.setItem(key, 'account A');
    localStorage.setItem('currentTheme', 'dark');

    clearAccountScopedStorage();

    for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('currentTheme')).toBe('dark');
  });

  it('covers the three stores it names (anti-vacuity)', () => {
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toEqual(['chatDraftsV1', 'agnt_inflight_runs', 'agnt_last_context_status']);
  });

  it('resetUserScopedData runs every chat reset', () => {
    const src = fs.readFileSync(path.resolve(HERE, './state.js'), 'utf8');
    const action = src.slice(src.indexOf('async resetUserScopedData('));
    expect(action).toMatch(/commit\('chat\/RESET_FOR_SESSION_END'\)/);
    expect(action).toMatch(/commit\('chatUnified\/RESET_FOR_SESSION_END'\)/);
    expect(action).toMatch(/clearAccountScopedStorage\(\)/);
  });
});

describe('the kept-alive Chat screen re-lands for a new session', () => {
  it('does nothing on the first verification at boot', () => {
    const land = vi.fn();
    const watcher = createNewSessionLanding(land);
    watcher('valid', 'unknown');
    expect(land).not.toHaveBeenCalled();
  });

  it('lands once after signing straight in as another account', () => {
    const land = vi.fn();
    const watcher = createNewSessionLanding(land);
    watcher('valid', 'unknown'); // boot
    watcher('unknown', 'valid'); // new token arrives
    watcher('valid', 'unknown'); // verified as the other account
    watcher('valid', 'valid');
    expect(land).toHaveBeenCalledOnce();
  });

  it('lands once after sign-out then sign-in', () => {
    const land = vi.fn();
    const watcher = createNewSessionLanding(land);
    watcher('valid', 'unknown');
    watcher('invalid', 'valid');
    watcher('unknown', 'invalid');
    watcher('valid', 'unknown');
    expect(land).toHaveBeenCalledOnce();
  });

  it('does not land while still signed out', () => {
    const land = vi.fn();
    const watcher = createNewSessionLanding(land);
    watcher('valid', 'unknown');
    watcher('invalid', 'valid');
    expect(land).not.toHaveBeenCalled();
  });
});
