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
        <button
          v-if="!providerLoading && (!providerRef || !modelRef)"
          type="button"
          class="ml-link"
          @click="refreshProviderModel"
        >
          Refresh model settings
        </button>
      </div>

      <div v-for="m in messages" :key="m.id" class="ml-bubble" :class="m.role">
        <div class="ml-role">{{ m.role === 'user' ? 'You' : 'Annie' }}</div>
        <div class="ml-body">{{ m.content }}</div>
        <div v-if="m.role === 'assistant' && m.tools?.length" class="ml-tools">
          <div v-for="(t, i) in m.tools" :key="i" class="ml-tool">
            <i class="fas fa-wrench"></i> {{ t }}
          </div>
        </div>
      </div>

      <div v-if="statusLine" class="ml-status">{{ statusLine }}</div>
    </main>

    <footer class="ml-composer">
      <p v-if="error" class="ml-error">{{ error }}</p>
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

const providerRef = ref(null);
const modelRef = ref(null);

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

function scrollBottom() {
  nextTick(() => {
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
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
  messages.value = [];
  outputId.value = null;
  conversationId.value = newConversationId();
  title.value = '';
  error.value = '';
  statusLine.value = '';
  drawerOpen.value = false;
  draft.value = '';
  nextTick(() => inputEl.value?.focus());
}

async function openConversation(id) {
  if (streaming.value) stop();
  drawerOpen.value = false;
  error.value = '';
  try {
    const data = await loadConversation(id);
    outputId.value = data.outputId;
    conversationId.value = data.conversationId || newConversationId();
    title.value = data.title || '';
    messages.value = (data.messages || []).map((m) => ({
      id: m.id || newMessageId(),
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
      timestamp: m.timestamp || Date.now(),
      tools: [],
    }));
    scrollBottom();
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

  const userMsg = {
    id: newMessageId(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
  };
  messages.value.push(userMsg);

  const assistantMsg = {
    id: newMessageId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    tools: [],
  };
  messages.value.push(assistantMsg);
  scrollBottom();

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
      signal: abortController.signal,
      onEvent: (eventName, data) => {
        if (eventName === 'content_delta' && data?.delta != null) {
          assistantMsg.content += data.delta;
          statusLine.value = '';
          touchMessages();
          scrollBottom();
        } else if (eventName === 'reasoning_delta') {
          statusLine.value = 'Reasoning…';
        } else if (eventName === 'tool_pending' || eventName === 'tool_start') {
          const name = data?.name || data?.toolName || data?.function?.name || 'tool';
          if (!assistantMsg.tools.includes(name)) assistantMsg.tools.push(name);
          statusLine.value = `Using ${name}…`;
          touchMessages();
        } else if (eventName === 'tool_end') {
          statusLine.value = 'Working…';
        } else if (eventName === 'final_content' && data?.content != null && !assistantMsg.content) {
          assistantMsg.content = data.content;
          touchMessages();
        } else if (eventName === 'error') {
          error.value = data?.error || data?.message || 'Stream error';
        } else if (eventName === 'done') {
          statusLine.value = '';
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
    abortController = null;
    if (!assistantMsg.content) assistantMsg.content = '…';
    touchMessages();
    scheduleSave();
    scrollBottom();
  }
}

function stop() {
  abortController?.abort();
  abortController = null;
  streaming.value = false;
  statusLine.value = 'Stopped';
}

function openServerSetup() {
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
  /* Fill the visual viewport; avoid 100vh/keyboard double-gap on iOS */
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
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
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.ml-bubble {
  max-width: 92%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 15px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.ml-bubble.user {
  align-self: flex-end;
  background: #243048;
  border-bottom-right-radius: 4px;
}
.ml-bubble.assistant {
  align-self: flex-start;
  background: var(--panel);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}
.ml-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ml-tools {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ml-tool {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
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
  background: #ff5c5c;
  color: #fff;
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
</style>

<!-- Unscoped: kill white body/#app under the fixed chat shell (iOS WKWebView). -->
<style>
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
