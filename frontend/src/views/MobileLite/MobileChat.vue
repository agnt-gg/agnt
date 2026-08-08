<template>
  <div class="ml-chat">
    <header class="ml-top">
      <button type="button" class="ml-icon-btn" aria-label="Conversations" @click="drawerOpen = !drawerOpen">
        <i class="fas fa-bars"></i>
      </button>
      <div class="ml-top-title">
        <strong>Annie</strong>
        <span class="ml-top-sub">{{ title || 'New chat' }}</span>
      </div>
      <button type="button" class="ml-icon-btn" aria-label="New chat" :disabled="streaming" @click="startNew">
        <i class="fas fa-plus"></i>
      </button>
    </header>

    <aside class="ml-drawer" :class="{ open: drawerOpen }">
      <div class="ml-drawer-head">
        <span>Chats</span>
        <button type="button" class="ml-icon-btn" @click="drawerOpen = false"><i class="fas fa-times"></i></button>
      </div>
      <button type="button" class="ml-drawer-new" :disabled="streaming" @click="startNew">+ New chat</button>
      <button type="button" class="ml-drawer-setup" @click="openServerSetup">Switch server…</button>
      <ul class="ml-drawer-list">
        <li v-for="c in conversations" :key="c.id">
          <button
            type="button"
            class="ml-drawer-item"
            :class="{ active: c.id === outputId }"
            @click="openConversation(c.id)"
          >
            {{ c.title || 'Conversation' }}
          </button>
        </li>
        <li v-if="!conversations.length && !listLoading" class="ml-drawer-empty">No saved chats yet</li>
      </ul>
    </aside>
    <div v-if="drawerOpen" class="ml-backdrop" @click="drawerOpen = false"></div>

    <main ref="listEl" class="ml-messages">
      <div v-if="!messages.length" class="ml-empty">
        <p>Chat with <strong>Annie</strong> — the same orchestrator as desktop.</p>
        <p v-if="providerLoading" class="ml-meta">Loading model settings…</p>
        <p v-else-if="!providerRef || !modelRef" class="ml-warn">
          No provider/model on this account yet. On desktop AGNT pick a model (saved to your account via
          Settings), then tap refresh below.
        </p>
        <p v-else class="ml-meta">{{ providerRef }} · {{ modelRef }}</p>
        <!--
          Voice is hidden rather than dead when the browser will not grant a
          microphone. Saying why once, here, beats a button that does nothing.
        -->
        <p v-if="!voiceSupported" class="ml-meta">
          Voice needs a secure connection — open AGNT over HTTPS or localhost.
        </p>
        <button
          v-if="!providerLoading && (!providerRef || !modelRef)"
          type="button"
          class="ml-link"
          @click="refreshProviderModel"
        >
          Refresh model settings
        </button>
      </div>

      <!--
        Rendered by the SAME component the desktop chat uses. Markdown, fenced
        code + highlighting, images, {{IMAGE_REF}} resolution, tables, MathJax,
        Chart.js / D3 / Mermaid / Three.js, HTML previews and expandable tool
        cards are all inherited rather than reimplemented — so this surface
        cannot drift from main chat again. See mobileChatRender.spec.js.
      -->
      <MessageItem
        v-for="m in messages"
        :key="m.id"
        :message="m"
        :status="statusFor(m)"
        :imageCache="imageCache"
        :dataCache="dataCache"
        :expandedToolCalls="expandedToolCalls"
        :showAvatar="m.role === 'assistant'"
        @toggle-tool="toggleToolCallExpansion"
      />
    </main>

    <footer class="ml-composer">
      <p v-if="error" class="ml-error">{{ error }}</p>
      <!--
        Voice has no visible surface of its own, so without this the user
        cannot tell whether it is hearing them, thinking, or broken — and a
        hands-free mode you cannot read is one you cannot trust.
      -->
      <div v-if="voiceActive" class="ml-voice" :class="'voice-' + voiceState">
        <span class="ml-voice-dot"></span>
        <span class="ml-voice-text">
          <template v-if="voiceError">{{ voiceError }}</template>
          <template v-else-if="voiceState === 'listening' || voiceState === 'reopen'">{{
            voicePartial || 'Listening…'
          }}</template>
          <template v-else-if="voiceState === 'thinking'">Thinking…</template>
          <template v-else-if="voiceState === 'speaking'">Speaking — talk to interrupt</template>
          <template v-else>Voice ready</template>
          <span v-if="voiceNatural" class="voice-engine-badge">natural</span>
        </span>
        <button type="button" class="ml-voice-end" @click="toggleVoice">End</button>
      </div>
      <div class="ml-row">
        <textarea
          ref="inputEl"
          v-model="draft"
          rows="1"
          class="ml-textarea"
          placeholder="Message Annie…"
          :disabled="streaming"
          @keydown.enter.exact.prevent="send"
        />
        <!--
          Deliberately NOT disabled while streaming: barge-in is the point of a
          hands-free mode, and the control that ends a session cannot be the
          one that disappears while the session is talking.
        -->
        <button
          v-if="voiceSupported"
          type="button"
          class="ml-voice-btn"
          :class="['voice-' + voiceState, { on: voiceActive }]"
          :aria-pressed="voiceActive ? 'true' : 'false'"
          aria-label="Toggle hands-free voice conversation"
          @click="toggleVoice"
        >
          <i :class="voiceActive ? 'fas fa-headset' : 'far fa-comment-dots'"></i>
        </button>
        <button
          v-if="!streaming"
          type="button"
          class="ml-send"
          :disabled="!canSend"
          aria-label="Send"
          @click="send"
        >
          <i class="fas fa-arrow-up"></i>
        </button>
        <button v-else type="button" class="ml-send stop" aria-label="Stop" @click="stop">
          <i class="fas fa-stop"></i>
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { streamChat, toChatHistory } from '@/services/chatService.js';
import MessageItem from '@/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue';
import { createAssistantMessage, applyStreamEvent, hydrateMessage } from '@/services/chatStreamReducer.js';
import { useVoiceEngines } from '@/composables/useVoiceEngines';
import { canUseMediaCapture } from '@/services/mobileLiteNative.js';
import { consumeVoiceTurn } from '@/services/voiceTurn.js';
import {
  listConversations,
  loadConversation,
  saveConversation,
  newConversationId,
  newMessageId,
  resolveLiteProviderModelAsync,
} from '@/services/mobileLiteApi.js';

const messages = ref([]);
const draft = ref('');
const streaming = ref(false);
const error = ref('');
const statusLine = ref('');
const drawerOpen = ref(false);
const conversations = ref([]);
const listLoading = ref(false);
const outputId = ref(null);
const conversationId = ref(newConversationId());
const title = ref('');
const listEl = ref(null);
const inputEl = ref(null);
const providerLoading = ref(true);

// MessageItem's caches. Generated images resolve to /api/images/:id (served with
// the media cookie set at pairing), exactly as they do on desktop after a
// reload — so an empty map here is the same code path, not a degraded one.
const imageCache = ref(new Map());
const dataCache = ref(new Map());
const expandedToolCalls = ref({});
const streamingMessageId = ref(null);

const providerRef = ref(null);
const modelRef = ref(null);

// Bumped ONLY on a genuine conversation switch, so a live session cannot
// outlive the chat it was opened in and start committing into another one.
const voiceEpoch = ref(0);

// getUserMedia does not exist outside a secure context, so on a plain
// http://LAN host there is no microphone to offer. Read once at setup: the
// origin cannot change without a navigation, which remounts this component.
const voiceSupported = canUseMediaCapture();

let abortController = null;
let saveTimer = null;

const canSend = computed(
  () =>
    !streaming.value &&
    !providerLoading.value &&
    draft.value.trim().length > 0 &&
    providerRef.value &&
    modelRef.value
);

/**
 * Voice, identical to every other chat surface.
 *
 * The whole feature — engine selection, the run_agnt bridge, the two-register
 * split, barge-in, the app-wide floor — lives in useVoiceEngines. This host
 * supplies only the four things that genuinely differ between surfaces. A
 * "mobile version" of any of the rest is how voice drifted four times before.
 */
const { voiceActive, voiceState, voicePartial, voiceError, voiceNatural, toggleVoice } =
  useVoiceEngines({
    surface: 'chat',
    submit: (text) => {
      draft.value = text;
      return send();
    },
    // The reducer mutates the assistant message in place and touchMessages()
    // replaces the array, so reading it through `messages` is reactive.
    streamingAnswer: () =>
      messages.value.find((m) => m.id === streamingMessageId.value)?.content || '',
    isStreaming: streaming,
    epoch: voiceEpoch,
  });

/** Only the in-flight assistant bubble carries a status; everything else is settled. */
function statusFor(m) {
  if (!streaming.value || m.id !== streamingMessageId.value) return null;
  return { type: 'thinking', text: statusLine.value || 'Thinking…' };
}

function toggleToolCallExpansion(messageId, toolCallIndex) {
  const open = expandedToolCalls.value[messageId] || [];
  const at = open.indexOf(toolCallIndex);
  expandedToolCalls.value = {
    ...expandedToolCalls.value,
    [messageId]: at > -1 ? open.filter((i) => i !== toolCallIndex) : [...open, toolCallIndex],
  };
}

async function refreshProviderModel() {
  providerLoading.value = true;
  try {
    const resolved = await resolveLiteProviderModelAsync();
    providerRef.value = resolved.provider;
    modelRef.value = resolved.model;
    if (!resolved.provider || !resolved.model) {
      error.value =
        'No provider/model on this account yet. On desktop AGNT pick a model (it is saved to your account), then pull to refresh or reopen chat.';
    } else if (error.value && error.value.includes('provider/model')) {
      error.value = '';
    }
  } finally {
    providerLoading.value = false;
  }
}

// Only auto-scroll when the user is already at the bottom. Yanking the viewport
// down while they are reading an earlier answer is the single most annoying
// thing a phone chat can do.
function scrollBottom(force = false) {
  const el = listEl.value;
  const wasAtBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  nextTick(() => {
    const target = listEl.value;
    if (target && (force || wasAtBottom)) target.scrollTop = target.scrollHeight;
  });
}

async function refreshList() {
  listLoading.value = true;
  try {
    conversations.value = await listConversations();
  } catch (e) {
    console.warn('[MobileLite] listConversations failed', e);
  } finally {
    listLoading.value = false;
  }
}

function startNew() {
  if (streaming.value) stop();
  voiceEpoch.value += 1;
  messages.value = [];
  outputId.value = null;
  conversationId.value = newConversationId();
  title.value = '';
  error.value = '';
  statusLine.value = '';
  drawerOpen.value = false;
  draft.value = '';
  expandedToolCalls.value = {};
  nextTick(() => inputEl.value?.focus());
}

async function openConversation(id) {
  if (streaming.value) stop();
  voiceEpoch.value += 1;
  drawerOpen.value = false;
  error.value = '';
  try {
    const data = await loadConversation(id);
    outputId.value = data.outputId;
    conversationId.value = data.conversationId || newConversationId();
    title.value = data.title || '';
    expandedToolCalls.value = {};
    // hydrateMessage rebuilds contentParts for conversations saved before the
    // interleaved model existed, so old chats render instead of showing blanks.
    messages.value = (data.messages || []).map(hydrateMessage);
    scrollBottom(true);
  } catch (e) {
    error.value = e.message || 'Could not load conversation';
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist().catch((e) => console.warn('[MobileLite] save failed', e));
  }, 800);
}

async function persist() {
  if (!messages.value.length) return;
  if (!title.value) {
    const firstUser = messages.value.find((m) => m.role === 'user');
    title.value = (firstUser?.content || 'Chat').slice(0, 60);
  }
  const result = await saveConversation({
    outputId: outputId.value,
    conversationId: conversationId.value,
    title: title.value,
    messages: messages.value,
  });
  if (result?.id) outputId.value = result.id;
  refreshList();
}

function touchMessages() {
  messages.value = [...messages.value];
}

async function send() {
  const text = draft.value.trim();
  if (!text || streaming.value) return;
  if (!providerRef.value || !modelRef.value) {
    await refreshProviderModel();
  }
  if (!providerRef.value || !modelRef.value) {
    error.value =
      'Select a provider and model on desktop AGNT first (it syncs to your account), then retry.';
    return;
  }

  error.value = '';
  draft.value = '';

  // Will this answer be SPOKEN as well as shown? Consumed here, once, matched
  // by text, so only the turn voice armed carries the spoken register — a
  // typed message during a voice session is still answered in full.
  const isVoiceTurn = consumeVoiceTurn(text);

  const userMsg = hydrateMessage({
    id: newMessageId(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
  });
  messages.value.push(userMsg);

  const assistantMsg = createAssistantMessage({ id: newMessageId() });
  messages.value.push(assistantMsg);
  streamingMessageId.value = assistantMsg.id;
  scrollBottom(true);

  // History: prior turns + this user message; never the empty assistant stub
  const history = toChatHistory(
    messages.value.filter((m) => m.id !== assistantMsg.id)
  );

  streaming.value = true;
  statusLine.value = 'Thinking…';
  abortController = new AbortController();

  try {
    await streamChat({
      chatType: 'orchestrator',
      messages: history,
      provider: providerRef.value,
      model: modelRef.value,
      conversationId: conversationId.value,
      pageContext: isVoiceTurn ? { voiceMode: true } : {},
      signal: abortController.signal,
      onEvent: (eventName, data) => {
        // One shared reducer owns the wire protocol for every surface.
        const r = applyStreamEvent(assistantMsg, eventName, data);
        if (r.error) error.value = r.error;
        if (r.status !== null) statusLine.value = r.status;
        if (r.changed) {
          touchMessages();
          scrollBottom();
        }
      },
    });
  } catch (e) {
    if (e?.name !== 'AbortError') {
      error.value = e?.message || 'Failed to reach Annie';
      if (!assistantMsg.content) assistantMsg.content = '(no response)';
    }
  } finally {
    streaming.value = false;
    statusLine.value = '';
    streamingMessageId.value = null;
    abortController = null;
    if (!assistantMsg.content && !assistantMsg.toolCalls.length) assistantMsg.content = '…';
    touchMessages();
    scheduleSave();
    scrollBottom();
  }
}

function stop() {
  abortController?.abort();
  abortController = null;
  streaming.value = false;
  streamingMessageId.value = null;
  statusLine.value = 'Stopped';
}

function openServerSetup() {
  // Stay on this AGNT host's /m?setup=1 so saved servers (same-origin
  // localStorage) and session stay available. Do NOT bounce to the Capacitor
  // local shell here — agntchat:// from a remote WebView is unreliable and
  // uses a different origin (empty server list). Camera scan can still bounce
  // from the setup screen's Scan QR button when needed.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  window.location.assign(`${origin}/m?setup=1`);
}

onMounted(() => {
  document.documentElement.classList.add('mobile-lite-shell');
  document.body.classList.add('mobile-lite-shell');
  refreshProviderModel();
  refreshList();
  // Do not autofocus the composer — on iOS that opens the keyboard + the
  // white form-navigation bar and leaves a large empty band under the input.
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove('mobile-lite-shell');
  document.body.classList.remove('mobile-lite-shell');
  abortController?.abort();
  clearTimeout(saveTimer);
});
</script>

<style scoped>
.ml-chat {
  --bg: #12121c;
  --panel: #1b1b2b;
  --border: #2e3350;
  --text: #e8e8f0;
  --muted: #8b93a7;
  --accent: #19ef83;
  /* Fill the area that is actually on screen.

     `inset: 0` did NOT do that. A fixed box resolves against the initial
     containing block, which on mobile is the LARGE viewport (URL bar hidden),
     so `bottom: 0` sat below the fold and .ml-composer — the bottom-most
     child of an overflow:hidden column — went with it. Pin three edges and
     take the height from the token instead. */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  height: var(--app-height);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
}
.ml-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: max(10px, env(safe-area-inset-top)) 12px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.ml-top-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ml-top-title strong {
  font-size: 15px;
}
.ml-top-sub {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ml-icon-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
}
.ml-messages {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Chat content is authored against the app theme tokens. The mobile shell
     paints its own dark background, so pin the tokens the shared renderer
     needs in case a theme stylesheet has not applied to this route yet. */
  --color-darker-1: #181826;
  --terminal-border-color: #2e3350;
}
.ml-empty {
  margin: auto;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
  max-width: 280px;
}
.ml-warn {
  color: #e8b84a;
  font-size: 13px;
}
.ml-meta {
  font-size: 12px;
  opacity: 0.8;
}
.ml-status {
  font-size: 13px;
  color: var(--muted);
  padding: 4px 8px;
}
.ml-composer {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  /* Tight padding; home-indicator only. Avoid a large empty band under the field. */
  padding: 8px 12px max(8px, env(safe-area-inset-bottom, 0px));
  background: var(--panel);
}
.ml-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.ml-textarea {
  flex: 1;
  min-height: 44px;
  max-height: 120px;
  resize: none;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  padding: 12px 14px;
  font-size: 16px;
  font-family: inherit;
  line-height: 1.35;
}
.ml-send {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 12px;
  background: var(--accent);
  color: #04120a;
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}
.ml-send:disabled {
  opacity: 0.4;
}
.ml-send.stop {
  background: var(--fill-danger);
  color: var(--on-fill-danger);
}

/* Voice. The mic reads as an ACTION, not a second input: transparent with a
   muted outline until the session is live, then it takes the accent. */
.ml-voice-btn {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
}
.ml-voice-btn.on {
  border-color: var(--accent);
  color: var(--accent);
}
.ml-voice-btn.voice-listening.on {
  animation: ml-voice-pulse 1.6s ease-in-out infinite;
}
@keyframes ml-voice-pulse {
  50% {
    opacity: 0.55;
  }
}
.ml-voice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 13px;
  min-height: 34px;
}
.ml-voice-dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--accent);
}
.ml-voice.voice-thinking .ml-voice-dot {
  background: #e8b84a;
}
.ml-voice.voice-speaking .ml-voice-dot {
  background: #6fa8ff;
}
.ml-voice-text {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.voice-engine-badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--accent);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ml-voice-end {
  flex-shrink: 0;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.ml-error {
  margin: 0 0 8px;
  color: #ff7b7b;
  font-size: 13px;
}
.ml-drawer {
  position: fixed;
  z-index: 30;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(300px, 86vw);
  background: var(--panel);
  border-right: 1px solid var(--border);
  transform: translateX(-105%);
  transition: transform 0.2s ease;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
}
.ml-drawer.open {
  transform: translateX(0);
}
.ml-backdrop {
  position: fixed;
  inset: 0;
  z-index: 25;
  background: rgba(0, 0, 0, 0.45);
}
.ml-drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 8px 8px 16px;
  font-weight: 600;
}
.ml-drawer-new {
  margin: 0 12px 8px;
  min-height: 40px;
  border-radius: 10px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
}
.ml-drawer-setup {
  margin: 0 12px 12px;
  min-height: 36px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  padding: 0 4px;
}
.ml-drawer-list {
  list-style: none;
  margin: 0;
  padding: 0 8px;
  overflow-y: auto;
  flex: 1;
}
.ml-drawer-item {
  width: 100%;
  text-align: left;
  padding: 12px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ml-drawer-item.active {
  background: #243048;
}
.ml-drawer-empty {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}
.ml-link {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
  padding: 8px 0;
}

/* ------------------------------------------------------------------
   Phone fit for the shared message renderer.
   These only change SIZE and SPACING — never which elements exist or
   how content is parsed — so parity with main chat is preserved.
   ------------------------------------------------------------------ */
.ml-messages :deep(.message-wrapper) {
  gap: 8px;
  animation: none; /* per-bubble spring animation is jarring on a small viewport */
}
.ml-messages :deep(.message-avatar) {
  width: 26px;
  height: 26px;
  border-width: 2px;
  padding: 1px;
}
.ml-messages :deep(.message-card) {
  padding: 12px 14px;
  gap: 12px;
  width: 100%;
  border-radius: 12px;
}
.ml-messages :deep(.message-text) {
  font-size: 15px;
  line-height: 1.45;
}
/* Desktop reserves 34px of gutter (`width: calc(100% - 34px)`) which a phone
   cannot spare. `width: auto` rather than `100%`: <pre> here is content-box, so
   100% + 12px padding + 1px border overflowed the card by 26px and ran the code
   block to within 1px of the screen edge. Measured: right edge 389px of a 390px
   viewport, vs 363px for every sibling block. */
.ml-messages :deep(.message-text pre) {
  width: auto;
  padding: 12px;
  font-size: 12.5px;
}
.ml-messages :deep(.message-text .table-wrapper) {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
/* The 320px floor exists so Chart.js cannot init a collapsed canvas (see the
   rule in MessageItem). At phone width the canvas is aspect-bound to ~131px, so
   that floor left ~95px of dead card under every chart. 200px still clears the
   ~150px collapse the guard is written against, with the waste cut to ~37px. */
.ml-messages :deep(.message-text .chartjs-container) {
  min-height: 200px;
}
.ml-messages :deep(.message-text .html-inline-iframe-scroller),
.ml-messages :deep(.message-text .chartjs-container),
.ml-messages :deep(.message-text .d3-container),
.ml-messages :deep(.message-text .threejs-container),
.ml-messages :deep(.message-text .mermaid-container) {
  max-width: 100%;
  overflow-x: auto;
}
.ml-messages :deep(.message-text .threejs-canvas),
.ml-messages :deep(.message-text .d3-container svg) {
  max-width: 100%;
  height: auto;
}
.ml-messages :deep(.tool-call-content) {
  font-size: 12px;
}
.ml-messages :deep(.message-time) {
  padding: 0;
}
</style>

<!-- Unscoped: kill white body/#app under the fixed chat shell (iOS WKWebView). -->
<style>
html.mobile-lite-shell {
  /* height:100% on <html> resolves against the initial containing block, i.e.
     the large viewport — the same over-measurement .ml-chat had. */
  height: var(--app-height);
}
html.mobile-lite-shell,
html.mobile-lite-shell body,
html.mobile-lite-shell #app {
  background: #12121c !important;
  margin: 0;
  min-height: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
