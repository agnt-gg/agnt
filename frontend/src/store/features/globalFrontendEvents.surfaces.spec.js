// EVERY chat surface must deliver EVERY window-scoped frontend event.
//
// The bug this pins: `set_background_image` worked in a sidebar/forge chat and
// did nothing at all in the main Annie chat. Two independent SSE reducers exist
// — chat.js (main terminal chat) and chatUnified.js (all channel chats) — and
// the re-dispatch of window-scoped events was hand-written in the second one
// only. Nothing failed; the event was simply dropped, so the user saw a tool
// report success while the screen never changed.
//
// The table below is derived from the registry, not hand-written, so adding a
// type to GLOBAL_FRONTEND_EVENTS immediately requires BOTH reducers to deliver
// it. That is the property that makes this class of bug non-recurring.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GLOBAL_FRONTEND_EVENTS } from '@/services/globalFrontendEvents.js';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));

const CONV = 'conv-1';
const CHANNEL = 'widget:w1';
const TYPES = Object.entries(GLOBAL_FRONTEND_EVENTS);

let seen;
const listeners = [];

function captureAll() {
  for (const windowEventName of Object.values(GLOBAL_FRONTEND_EVENTS)) {
    const fn = (e) => seen.push({ name: windowEventName, detail: e.detail });
    window.addEventListener(windowEventName, fn);
    listeners.push([windowEventName, fn]);
  }
}

beforeEach(() => {
  seen = [];
  captureAll();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  while (listeners.length) {
    const [name, fn] = listeners.pop();
    window.removeEventListener(name, fn);
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('main chat (chat.js) delivers global frontend events', () => {
  const emit = async (data) => {
    const mod = await import('./chat.js');
    const state = {
      activeConversationId: CONV,
      unreadOutputIds: {},
      messages: [],
      conversations: { [CONV]: { conversationId: CONV, messages: [], isStreaming: true } },
    };
    const commit = vi.fn((type, payload) => {
      const fn = mod.default.mutations[type];
      if (fn) fn(state, payload);
    });
    mod.handleScopedStreamEvent({ commit, state, dispatch: vi.fn() }, 'frontend_event', data, CONV);
  };

  it.each(TYPES)('%s -> %s', async (eventType, windowEventName) => {
    await emit({ eventType, eventData: { probe: eventType } });
    expect(seen).toEqual([{ name: windowEventName, detail: { probe: eventType } }]);
  });

  it('ignores a channel-scoped event type', async () => {
    await emit({ eventType: 'widget:saved', eventData: { id: 'w1' } });
    expect(seen).toEqual([]);
  });
});

describe('channel chats (chatUnified.js) deliver global frontend events', () => {
  const emit = async (data, onFrontendEvent) => {
    const mod = await import('./chatUnified.js');
    mod.handleStreamEvent({
      commit: vi.fn(),
      channelKey: CHANNEL,
      eventName: 'frontend_event',
      data,
      onFrontendEvent,
    });
  };

  it.each(TYPES)('%s -> %s', async (eventType, windowEventName) => {
    await emit({ eventType, eventData: { probe: eventType } });
    expect(seen).toEqual([{ name: windowEventName, detail: { probe: eventType } }]);
  });

  // The channel callback drives per-page side effects (widget saved, file
  // written). Routing global events to the window must not stop it firing.
  it('still forwards every event to the channel callback', async () => {
    const onFrontendEvent = vi.fn();
    await emit({ eventType: 'appearance:background', eventData: { url: '/x.png' } }, onFrontendEvent);
    expect(onFrontendEvent).toHaveBeenCalledWith('appearance:background', { url: '/x.png' });
  });

  it('routes a tool_end frontendEvents array: global to window, rest to callback', async () => {
    const mod = await import('./chatUnified.js');
    const onFrontendEvent = vi.fn();
    mod.handleStreamEvent({
      commit: vi.fn(),
      channelKey: CHANNEL,
      eventName: 'tool_end',
      data: {
        assistantMessageId: 'm1',
        toolCall: {
          id: 't1',
          name: 'set_background_image',
          result: {
            success: true,
            frontendEvents: [
              { type: 'appearance:background', data: { url: '/x.png', kind: 'image' } },
              { type: 'widget:saved', data: { id: 'w1' } },
            ],
          },
        },
      },
      onFrontendEvent,
    });

    expect(seen).toEqual([{ name: 'agnt:appearance-background', detail: { url: '/x.png', kind: 'image' } }]);
    expect(onFrontendEvent).toHaveBeenCalledWith('widget:saved', { id: 'w1' }, expect.any(Object));
  });
});
