/**
 * SCROLL RESTORE — the transcript belongs to its conversation.
 *
 * Reading position used to be discarded on every conversation switch, every
 * navigation away from the Chat screen (KeepAlive detaches the subtree and the
 * browser zeroes scrollTop on a detached element), and every reload. Worse,
 * opening a saved conversation explicitly called scrollToTop(), so a
 * 200-message chat reopened at message 1.
 *
 * The defect class here is WIRING — storage that nothing reads, a handler that
 * nothing fires, a restore that runs before the DOM exists — and unit tests of
 * the storage module cannot see wiring. So the shared container is mounted for
 * real and driven through a real scroll event, and Chat.vue (whose store and
 * panel dependency graph makes a full mount impractical, the repo's
 * established exception) gets source guards that assert REACHABILITY, not just
 * the presence of a line.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import UnifiedChatContainer from './UnifiedChatContainer.vue';
import MessageItem from '@/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue';
import { getScrollPosition, setScrollPosition } from '@/services/chatScrollPositions.js';
import { SETTLE_TIMEOUT_MS, CAPTURE_DEBOUNCE_MS } from '@/composables/useChatScrollRestore.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../..');
const CHAT_VUE = path.join(SRC, 'views/Terminal/CenterPanel/screens/Chat/Chat.vue');
const KEY = 'chatScrollV1';

vi.mock('@/services/chatChannelConfig.js', () => ({ getChannelConfig: () => null }));

const noopDirective = { mounted() {}, unmounted() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The two waits this file needs, derived from the component's OWN bounds.
 *
 * WHY NOT A FIXED NUMBER (2026-08-07)
 * ──────────────────────────────────
 * These were `sleep(120)` and `sleep(320)`. 120ms is not enough to wait out an
 * open-time restore: the settle loop is bounded by SETTLE_TIMEOUT_MS (600),
 * and capture is suppressed for its entire duration —
 *
 *     if (isRestoring.value) return;      // useChatScrollRestore.js
 *
 * — because saving mid-restore would overwrite the user's real position with
 * an artefact of our own restoration. So when rAF and timer callbacks are
 * delayed, which is exactly what happens under a full parallel suite or on a
 * CI runner, the scroll the test then triggers is CORRECTLY ignored, nothing
 * is recorded, and the assertion sees null.
 *
 * That made the file pass in isolation and fail intermittently in the full
 * run — a flaky gate, which teaches people to re-run rather than to look, and
 * is the one failure mode .github/workflows/test.yml exists to prevent.
 *
 * Measured: with the wait at 0 the failure is deterministic (5 tests, incl.
 * the one CI reported); past the settle bound it is green 3/3.
 *
 * Deriving them from the exported constants means a change to the component's
 * timing can never silently invalidate the test's assumptions again.
 */
const RESTORE_SETTLED = SETTLE_TIMEOUT_MS + 160;
const CAPTURE_FLUSHED = CAPTURE_DEBOUNCE_MS + 150;

const MESSAGES = [
  { id: 'm1', role: 'user', content: 'one' },
  { id: 'm2', role: 'assistant', content: 'two' },
  { id: 'm3', role: 'user', content: 'three' },
];

/** Renders the one thing the anchor machinery depends on. */
const MessageItemStub = {
  props: ['message'],
  template: '<div class="stub-msg" :data-message-id="message.id"></div>',
};

function makeStore(messages = MESSAGES) {
  return createStore({
    modules: {
      chatUnified: {
        namespaced: true,
        state: () => ({}),
        getters: {
          getFormattedMessages: () => () => messages,
          isStreaming: () => () => false,
          isLoadingSuggestions: () => () => false,
          getSuggestions: () => () => [],
          pendingSteer: () => () => null,
          getImageCache: () => () => new Map(),
          getDataCache: () => () => new Map(),
          getMessageStatus: () => () => null,
          getRunningToolsForMessage: () => () => [],
        },
        actions: { initializeChannel: vi.fn(), clearConversation: vi.fn(), setSuggestions: vi.fn() },
      },
      aiProvider: {
        namespaced: true,
        state: () => ({ selectedProvider: null, selectedModel: null }),
        actions: { setProvider: vi.fn(), setModel: vi.fn() },
      },
      agents: { namespaced: true, getters: { allAgents: () => [] } },
    },
  });
}

function mountChat(props = {}) {
  return mount(UnifiedChatContainer, {
    props: { channelKey: 'workspace:ws_A', chatType: 'orchestrator', welcomeMessage: 'hi', ...props },
    attachTo: document.body,
    global: {
      plugins: [makeStore()],
      directives: { tooltip: noopDirective, 'click-outside': noopDirective },
      stubs: {
        teleport: true,
        MessageItem: MessageItemStub,
        ProcessingState: true,
        QuickActions: true,
        ChatScrollControls: true,
        ChatProviderSelector: true,
        ChatToolSelector: true,
      },
    },
  });
}

/**
 * jsdom has no layout: every box is 0x0, so a real element is never
 * "scrollable" and the capture would correctly decline to record anything.
 * Install the geometry the browser would have computed. Message N sits at
 * N*500 in content coordinates; children report VIEWPORT coordinates, which is
 * the conversion measureItems() exists to undo.
 */
function giveLayout(wrapper, { scrollTop = 0, scrollHeight = 2000, clientHeight = 400 } = {}) {
  const el = wrapper.find('.chat-messages').element;
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, writable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, writable: true, value: clientHeight });
  el.getBoundingClientRect = () => ({ top: 0, height: clientHeight });
  [...el.querySelectorAll('[data-message-id]')].forEach((node, i) => {
    node.getBoundingClientRect = () => ({ top: i * 500 - el.scrollTop, height: 500 });
  });
  return el;
}

/**
 * Mount, install layout, and let the open-time restore finish.
 *
 * Capture deliberately stands down while a restore is settling (saving then
 * would overwrite the user's real position with an artefact of our own
 * restoration), so a test that scrolls mid-restore is testing the guard, not
 * the capture. In the app the two never collide: a real user scroll fires
 * wheel/touch/pointer, which aborts the restore outright.
 */
async function openChat(props, { scrollTop = 0, ...layout } = {}) {
  const w = mountChat(props);
  await w.vm.$nextTick();
  const el = giveLayout(w, layout);
  await sleep(RESTORE_SETTLED);
  // Only NOW put the user where the test wants them. Setting it earlier would
  // be overwritten by the open-time restore, which legitimately owns scrollTop
  // until it settles.
  el.scrollTop = scrollTop;
  return { w, el };
}

beforeEach(() => localStorage.removeItem(KEY));

describe('MessageItem — the anchor the whole feature hangs on', () => {
  it('stamps its message id on the OUTERMOST wrapper', () => {
    const w = mount(MessageItem, {
      props: { message: { id: 'msg-42', role: 'assistant', content: 'hi', timestamp: Date.now() } },
      global: {
        plugins: [
          createStore({
            modules: {
              agents: { namespaced: true, state: { agents: [] } },
              chat: { namespaced: true, state: { dataCache: new Map() } },
            },
          }),
        ],
        stubs: { teleport: true },
      },
    });
    // Outermost, not nested: the measured top has to be where the user sees
    // the message start.
    expect(w.element.getAttribute('data-message-id')).toBe('msg-42');
    w.unmount();
  });
});

describe('panel chats — a scroll position is remembered per channel', () => {
  it('THE CORE CASE: scrolling records an anchor under this channel and no other', async () => {
    const { w } = await openChat({ channelKey: 'workspace:ws_A' }, { scrollTop: 600 });

    await w.find('.chat-messages').trigger('scroll');
    await sleep(CAPTURE_FLUSHED);

    expect(getScrollPosition('workspace:ws_A')).toMatchObject({
      atBottom: false,
      anchorId: 'm2',
      anchorOffset: 100,
    });
    expect(getScrollPosition('workspace:ws_B')).toBeNull();
    w.unmount();
  });

  it('records bottom intent when the user is at the bottom', async () => {
    const { w } = await openChat({ channelKey: 'workspace:ws_A' }, { scrollTop: 1600 });

    await w.find('.chat-messages').trigger('scroll');
    await sleep(CAPTURE_FLUSHED);

    expect(getScrollPosition('workspace:ws_A')).toMatchObject({ atBottom: true, anchorId: null });
    w.unmount();
  });

  it('banks the position on unmount — most hosts :key this container, so a switch IS an unmount', async () => {
    const { w } = await openChat({ channelKey: 'workspace:ws_A' }, { scrollTop: 1100 });
    // No scroll event and no debounce elapsed: only the unmount flush can save this.
    w.unmount();

    expect(getScrollPosition('workspace:ws_A')).toMatchObject({ anchorId: 'm3', anchorOffset: 100 });
  });

  it('a flush that lands mid-restore preserves the stored position instead of clobbering it', async () => {
    // Deliberate: mid-settle, scrollTop is wherever the loop has reached
    // against a document that is still growing. The already-stored entry is
    // strictly better information than that, so we keep it.
    setScrollPosition('workspace:ws_A', { anchorId: 'm3', anchorOffset: 0, atBottom: false, window: null });
    const w = mountChat({ channelKey: 'workspace:ws_A' });
    await w.vm.$nextTick();
    giveLayout(w, { scrollTop: 0, scrollHeight: 99999 }); // never settles within the test
    w.unmount();

    expect(getScrollPosition('workspace:ws_A')).toMatchObject({ anchorId: 'm3', atBottom: false });
  });

  it('an in-place channelKey swap banks the OUTGOING channel, not the incoming one', async () => {
    const { w } = await openChat({ channelKey: 'workspace:ws_A' }, { scrollTop: 600 });

    await w.setProps({ channelKey: 'workspace:ws_B' });

    expect(getScrollPosition('workspace:ws_A')).toMatchObject({ anchorId: 'm2' });
    expect(getScrollPosition('workspace:ws_B')).toBeNull();
    w.unmount();
  });

  it('restores a saved position on mount instead of jumping to the bottom', async () => {
    setScrollPosition('workspace:ws_A', { anchorId: 'm2', anchorOffset: 100, atBottom: false, window: null });
    const w = mountChat({ channelKey: 'workspace:ws_A' });
    await w.vm.$nextTick();
    const el = giveLayout(w, { scrollTop: 0 });
    await sleep(RESTORE_SETTLED);
    expect(el.scrollTop).toBe(600);
    w.unmount();
  });

  it('with nothing saved, mount still lands at the bottom — the common case is unchanged', async () => {
    const w = mountChat({ channelKey: 'workspace:ws_fresh' });
    await w.vm.$nextTick();
    const el = giveLayout(w, { scrollTop: 0 });
    await sleep(RESTORE_SETTLED);
    expect(el.scrollTop).toBe(1600);
    w.unmount();
  });
});

describe('main chat screen — source guards', () => {
  let src;
  beforeEach(() => {
    src = fs.readFileSync(CHAT_VUE, 'utf8');
  });

  it('THE BUG: opening a conversation no longer scrolls to the top', () => {
    // Every caller of scrollToTop() was a conversation open. The function is
    // gone; the user-facing control in ChatScrollControls is untouched.
    expect(src).not.toMatch(/const scrollToTop = \(\) => \{/);
    expect(src).not.toMatch(/^\s*scrollToTop\(\);/m);
  });

  it('uses the shared composable rather than a second implementation', () => {
    expect(src).toMatch(/import \{ useChatScrollRestore \} from '@\/composables\/useChatScrollRestore\.js'/);
    expect(src).toMatch(/restore: restoreScroll/);
    expect(src).toMatch(/flushCapture: flushScrollCapture/);
  });

  it('feeds the composable the message window, without which an anchor cannot be found', () => {
    const at = src.indexOf('useChatScrollRestore({');
    const call = src.slice(at, src.indexOf('});', at));
    expect(call).toMatch(/getWindow: \(\) => visibleWindow\.value/);
    expect(call).toMatch(/setWindow:/);
    expect(call).toMatch(/getKey: \(\) => store\.state\.chat\.activeConversationId/);
  });

  it('the canvas actually reports its scrolls', () => {
    expect(src).toMatch(/class="conversation-canvas"[^>]*@scroll\.passive="scheduleScrollCapture"/);
    // ...and the handler is exposed to the template, or the binding is inert.
    expect(src).toMatch(/^\s*scheduleScrollCapture,$/m);
  });

  it('ONE owner for switches: bank the outgoing conversation, restore the incoming', () => {
    const at = src.indexOf("if (mutation.type !== 'chat/SET_ACTIVE_CONVERSATION') return;");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 400);
    // Pin the exact shape. A test that merely asserts these two calls appear
    // somewhere in the file is satisfied by dead code.
    expect(body).toMatch(
      /if \(scrollKeyOnScreen\) flushScrollCapture\(scrollKeyOnScreen\);\s*\n\s*scrollKeyOnScreen = newId;\s*\n\s*if \(newId\) restoreScroll\(newId\);/,
    );
  });

  it('REGRESSION: reacts to the MUTATION, not the derived id', () => {
    // `activeConversationId` also changes when the backend assigns the real id
    // to the conversation the user is ALREADY IN, mid-first-send. A watch
    // cannot tell that from a switch, and would re-file the position under the
    // dead temp id and start a settle loop that suppresses the autoscroll
    // following the response being streamed right then.
    expect(src).toMatch(/store\.subscribe\(\(mutation\) => \{/);

    // Other watchers on this key are fine (monitoring hydration uses one).
    // What must never happen is SCROLL work hanging off the derived value.
    const watchers = [...src.matchAll(/watch\(\s*\n\s*\(\) => store\.state\.chat\.activeConversationId,/g)];
    expect(watchers.length).toBeGreaterThan(0); // the monitoring one still exists
    for (const m of watchers) {
      expect(src.slice(m.index, m.index + 800)).not.toMatch(/restoreScroll|flushScrollCapture/);
    }

    // Pin the GUARD, not just the mention. `if (false && mutation.type === ...)`
    // contains the same substring while being unreachable — a source-contract
    // test that asserts presence does not assert reachability.
    expect(src).toMatch(/\n\s*if \(mutation\.type === 'chat\/MIGRATE_CONVERSATION_ID'\) \{/);

    const at = src.indexOf("mutation.type === 'chat/MIGRATE_CONVERSATION_ID'");
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(at, src.indexOf('return;', at));
    // The identity branch must follow the rename and do nothing else.
    expect(branch).toMatch(/scrollKeyOnScreen = newId;/);
    expect(branch).not.toMatch(/restoreScroll/);
    expect(branch).not.toMatch(/flushScrollCapture/);
  });

  it('unsubscribes on unmount', () => {
    const at = src.indexOf('onUnmounted(() => {');
    expect(src.slice(at, src.indexOf('});', at))).toMatch(/unsubscribeScrollSync\(\);/);
  });

  it('survives KeepAlive: banked on the way out, restored on the way back', () => {
    // Navigating away does not unmount Chat — the subtree is detached and the
    // browser zeroes scrollTop on it.
    expect(src).toMatch(/onDeactivated\(\(\) => flushScrollCapture\(\)\)/);
    expect(src).toMatch(/onActivated\(\(\) => restoreScroll\(\)\)/);
    expect(src).toMatch(/import \{[^}]*onActivated[^}]*onDeactivated[^}]*\} from 'vue'/);
  });

  it('survives a reload: the last debounced capture is flushed on hide', () => {
    expect(src).toMatch(/document\.addEventListener\('visibilitychange', flushScrollCaptureOnHide\)/);
    expect(src).toMatch(/document\.removeEventListener\('visibilitychange', flushScrollCaptureOnHide\)/);
    expect(src).toMatch(/if \(document\.visibilityState === 'hidden'\) flushScrollCapture\(\)/);
  });

  it('releases its timers and listeners on unmount', () => {
    const at = src.indexOf('onUnmounted(() => {');
    const body = src.slice(at, src.indexOf('});', at));
    expect(body).toMatch(/flushScrollCapture\(\);/);
    expect(body).toMatch(/teardownScrollRestore\(\);/);
  });

  it('the near-bottom autoscroll stands down while a restore settles', () => {
    const at = src.indexOf('const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;');
    const before = src.slice(Math.max(0, at - 500), at);
    // The guard must precede the measurement: early in the settle loop the
    // transcript is short and scrollTop is 0, which reads as "near bottom".
    expect(before).toMatch(/if \(isRestoringScroll\.value\) return;/);
  });

  it('the saved-output loader restores AFTER the spinner clears, not before', () => {
    const at = src.indexOf('bulkLoading.value = false;');
    const body = src.slice(at, at + 200);
    expect(body).toMatch(/await restoreScroll\(store\.state\.chat\.activeConversationId\)/);
  });
});

describe('panel container — source guards', () => {
  const UNIFIED = path.join(HERE, 'UnifiedChatContainer.vue');

  it('the autoscroll stands down while a restore settles', () => {
    const src = fs.readFileSync(UNIFIED, 'utf8');
    const at = src.indexOf('const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;');
    const before = src.slice(Math.max(0, at - 400), at);
    expect(before).toMatch(/if \(isRestoringScroll\.value\) return;/);
  });

  it('mount restores rather than jumping to the bottom', () => {
    const src = fs.readFileSync(UNIFIED, 'utf8');
    const at = src.indexOf('onMounted(() => {');
    const body = src.slice(at, src.indexOf('});', at));
    expect(body).toMatch(/restoreScroll\(\);/);
    expect(body).not.toMatch(/scrollToBottom\(\);/);
  });
});
