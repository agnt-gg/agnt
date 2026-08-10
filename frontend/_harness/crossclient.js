/**
 * crossclient.js — the real client plumbing for the two-tab run-visibility
 * tests, without the UI.
 *
 * Driven by tests/e2e/cross-client-runs.spec.js. See that file for what the
 * tests assert; this file exists to make the assertions be about the REAL
 * modules rather than about a description of them.
 *
 * WHAT IS REAL HERE — and this list is the whole point of the file:
 *   - the real `clientId.js`, so each TAB mints its own per-page-load identity
 *   - the real `useRealtimeSync()` composable, in a real mounted component, so
 *     it opens a real Socket.IO connection and registers the real `run:started`
 *     handler
 *   - the real `chat` and `chatUnified` Vuex modules, so `adoptAnnouncedRun`
 *     dispatches into the real `reattachConversation` / `reattachChannel`
 *   - the real `chatService.reattachRun`, so a reattach is a real SSE request
 *     against the real route, and replayed events are applied by the real
 *     reducer
 *   - the real `runResume.resumeInflightRuns`, invoked the way sessionBoot
 *     invokes it, so boot-discovery is exercised as well as the announcement
 *
 * WHAT IS NOT REAL: the Vue components. These tests are about which client
 * picks a run up and which one declines — plumbing, not pixels. Store modules
 * unrelated to that are registered as inert stubs so dispatches resolve; they
 * take no part in any assertion.
 */
import { createApp, h } from 'vue';
import { createStore } from 'vuex';

import chat from '@/store/features/chat.js';
import chatUnified from '@/store/features/chatUnified.js';
import { useRealtimeSync } from '@/composables/useRealtimeSync.js';
import { getClientId } from '@/services/clientId.js';
import { resumeInflightRuns } from '@/services/runResume.js';
import { API_CONFIG } from '@/tt.config.js';

/** Must match USER in tests/e2e/fixtures/crossClientBackend.mjs. */
const USER = 'u-xclient-harness';

/** An inert namespaced module — present so dispatches resolve, does nothing. */
const stub = (state = {}) => ({
  namespaced: true,
  state,
  mutations: new Proxy({}, { get: () => () => {}, has: () => true }),
  actions: new Proxy({}, { get: () => () => Promise.resolve(), has: () => true }),
});

const store = createStore({
  modules: {
    chat,
    chatUnified,
    // useRealtimeSync derives the socket identity from here.
    userAuth: { namespaced: true, state: { user: { id: USER }, token: null } },
    contentOutputs: stub({ outputs: [] }),
    aiProvider: stub({ selectedProvider: null, selectedModel: null }),
    goals: stub({ goals: [] }),
    agents: stub({ agents: [] }),
    groups: stub({ groups: [] }),
  },
});

// Everything the spec needs to observe, in one place on `window`.
const harness = {
  clientId: getClientId(),
  baseUrl: API_CONFIG.BASE_URL,
  user: USER,
  socketAuthenticated: false,
  bootResumeResult: null,
  store,

  /**
   * Start a run. Mirrors what chatService.streamChat sends — specifically the
   * X-AGNT-Client-Id header, which is what lets the server label the
   * announcement and this tab therefore recognise its own.
   */
  async startRun(conversationId) {
    const res = await fetch(`${API_CONFIG.BASE_URL}/harness/start-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AGNT-Client-Id': getClientId(),
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
      },
      body: JSON.stringify({ conversationId, chatType: 'orchestrator' }),
    });
    return res.json();
  },

  /** What this tab believes about a conversation. */
  snapshot(conversationId) {
    const conv = store.state.chat.conversations[conversationId];
    return {
      known: !!conv,
      isStreaming: conv?.isStreaming ?? null,
      isReattaching: conv?.isReattaching ?? null,
      messageCount: conv?.messages?.length ?? 0,
      text: (conv?.messages || []).map((m) => `${m.role}:${m.content}`).join(' | '),
      allConversationIds: Object.keys(store.state.chat.conversations),
    };
  },
};
window.__agntHarness = harness;

const App = {
  setup() {
    const rt = useRealtimeSync();

    // Surface socket state so the spec can wait on a FACT rather than a sleep.
    // A test that races the socket is a test that fails at random, and a gate
    // that fails at random is not a gate.
    const tick = setInterval(() => {
      harness.socketAuthenticated = !!rt.isAuthenticated?.value;
    }, 50);
    window.addEventListener('beforeunload', () => clearInterval(tick));

    // Mirrors sessionBoot: resume is kicked off once a session is established.
    // This is what lets a tab opened MID-RUN discover it with no announcement.
    Promise.resolve(resumeInflightRuns(store))
      .then((r) => { harness.bootResumeResult = r; })
      .catch((e) => { harness.bootResumeResult = { error: String(e) }; });

    return () => h('div', { id: 'harness-ready' }, 'cross-client harness tab');
  },
};

createApp(App).use(store).mount('#app');
