// chatUnified.js — single Vuex module that holds conversations for every Annie
// chat surface keyed by channelKey ('artifact:<id>', 'agent:<id>', 'workflow:<id>',
// 'tool:<id>', 'widget:<id>'). The orchestrator's rich Chat.vue continues to use
// the legacy `chat` module; this module powers all five per-page panels.

import { streamChat, toChatHistory, reattachRun, cancelRun, fetchConversation } from '@/services/chatService.js';
import { markRunStarted, markRunEnded } from '@/services/inflightRuns.js';
import { resolveChannelProviderModel, resolveChannelEnabledTools } from '@/services/chatChannelConfig.js';
import { emitSteer, emitClearSteer } from '@/composables/useRealtimeSync.js';
import { hydrateMessage } from '@/services/chatStreamReducer.js';
// The key only — workspaceStorage.js is deliberately import-free and
// side-effect-free, so reading workspace state here never boots the
// useWorkspaces singleton (which MINTS a workspace on import). Two writers to
// one blob is already delicate; two spellings of its key would be worse.
import { STORAGE_KEY as WORKSPACES_STORAGE_KEY } from '@/views/Terminal/CenterPanel/screens/Workspace/workspaceStorage.js';

// Resolve a per-workspace AI override from persisted workspace state, given a
// chat channel key. Returns { provider, model } or null. Reads the same
// localStorage the Workspaces page owns; falls back to null on any parse issue
// (→ inherit global/channel default). A named provider that isn't configured
// on THIS device is left as-is here; the LLM client factory / failover handles
// availability, and callers may still fall back to channelPM.
function resolveWorkspaceAiForChannel(channelKey) {
  if (typeof channelKey !== 'string' || !channelKey.startsWith('workspace:')) return null;
  const wsId = channelKey.slice('workspace:'.length).split(':')[0];
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ws = (parsed?.workspaces || []).find((w) => w.id === wsId);
    if (ws?.ai?.provider) return { provider: ws.ai.provider, model: ws.ai.model || null };
  } catch (_) { /* inherit default */ }
  return null;
}

/** Workspace id from channel key workspace:<id> or workspace:<id>:<chatKey>. */
function workspaceIdFromChannel(channelKey) {
  if (typeof channelKey !== 'string' || !channelKey.startsWith('workspace:')) return null;
  const rest = channelKey.slice('workspace:'.length);
  const colon = rest.indexOf(':');
  return colon === -1 ? rest : rest.slice(0, colon);
}

/**
 * Read/write the channelKey → conversationId map that rides workspace sync
 * (layout_data.channelConversations). Keeps chatUnified decoupled from the
 * Vue composable while still sharing the same persisted blob.
 */
function readWorkspaceChannelConversation(channelKey) {
  const wsId = workspaceIdFromChannel(channelKey);
  if (!wsId) return null;
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ws = (parsed?.workspaces || []).find((w) => w.id === wsId);
    return ws?.channelConversations?.[channelKey] || null;
  } catch {
    return null;
  }
}

function writeWorkspaceChannelConversation(channelKey, conversationId) {
  const wsId = workspaceIdFromChannel(channelKey);
  if (!wsId || !conversationId) return;
  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.workspaces)) return;
    const ws = parsed.workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    if (!ws.channelConversations) ws.channelConversations = {};
    if (ws.channelConversations[channelKey] === conversationId) return;
    ws.channelConversations[channelKey] = conversationId;
    ws.updatedAt = Date.now();
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(parsed));
    // Notify Workspaces page so in-memory workspaces + server push pick it up.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agnt:workspace-conversation', {
        detail: { channelKey, conversationId, workspaceId: wsId },
      }));
    }
  } catch (e) {
    console.warn('[chatUnified] failed to persist workspace conversation id:', e?.message || e);
  }
}

/** Convert server conversation_logs messages into UI message shapes. */
function serverMessagesToUi(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m, i) => hydrateMessage({
      id: m.id || `srv-${i}-${Date.now().toString(36)}`,
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (m.content == null ? '' : String(m.content)),
      toolCalls: m.toolCalls || m.tool_calls || [],
      contentParts: m.contentParts || null,
      reasoning: m.reasoning || '',
      timestamp: m.timestamp || Date.now(),
    }));
}

const STORAGE_KEY = 'unifiedChatConversations';
const LEGACY_KEYS = {
  agent: 'agentChatConversations',
  workflow: 'workflowChatConversations',
  tool: 'toolChatConversations',
  widget: 'widgetChatConversations',
  artifact: 'artifactChatConversations',
};

const splitChannelKey = (channelKey) => {
  if (!channelKey || typeof channelKey !== 'string') return { type: '', id: '' };
  const colonAt = channelKey.indexOf(':');
  if (colonAt === -1) return { type: channelKey, id: '' };
  return { type: channelKey.slice(0, colonAt), id: channelKey.slice(colonAt + 1) };
};

const blankConversation = () => ({
  messages: [],
  conversationId: null,
  lastUpdate: Date.now(),
  suggestions: [],
});

const loadPersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[chatUnified] Failed to load persisted conversations:', e);
    return {};
  }
};

// A full localStorage quota used to be a SILENT failure: setItem threw,
// persistNow swallowed it, and every chat surface stopped saving with nothing
// on screen to say so. Storage filling up is a normal end state for a
// long-lived install (this store is one key holding every channel), so the
// correct behaviour is to make room and keep the live conversation durable —
// and to fail LOUDLY only when even the newest channels cannot fit.
const isQuotaError = (e) =>
  !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

// The one channel eviction may never touch. The conversation the user is in
// always carries the newest lastUpdate, so protecting the newest entry is
// exactly the invariant "never delete the thread we are trying to save".
// A larger fixed reserve would be arbitrary AND self-defeating: with fewer
// channels than the reserve, nothing is evictable and the save fails outright.
const PROTECTED_RECENT_CHANNELS = 1;

const persistNow = (conversations) => {
  const filtered = {};
  for (const [key, conv] of Object.entries(conversations)) {
    if (!conv) continue;
    if ((conv.messages && conv.messages.length > 0) || conv.conversationId) {
      filtered[key] = conv;
    }
  }

  // Eviction order: least-recently-updated first, minus the protected tail.
  const evictable = Object.keys(filtered)
    .sort((a, b) => (filtered[a].lastUpdate || 0) - (filtered[b].lastUpdate || 0))
    .slice(0, Math.max(0, Object.keys(filtered).length - PROTECTED_RECENT_CHANNELS));

  const evicted = [];
  for (;;) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      if (evicted.length) {
        console.warn(`[chatUnified] storage quota reached — evicted ${evicted.length} least-recent channel(s) to keep saving:`, evicted);
      }
      return true;
    } catch (e) {
      if (!isQuotaError(e)) {
        console.error('[chatUnified] Failed to persist conversations:', e);
        return false;
      }
      const victim = evictable.shift();
      if (!victim) {
        console.error('[chatUnified] storage quota reached and the most recent conversations alone exceed it — NOT saving. Clear space to avoid losing this thread.');
        return false;
      }
      delete filtered[victim];
      evicted.push(victim);
    }
  }
};

/* ═══════════ one-shot reclaim of the abandoned split-key scheme ═══════════
 *
 * An earlier experiment persisted each channel under its own
 * `conv:unified:<channelKey>` key (plus a `…:index`). That code exists in no
 * source file, no shipped bundle and no commit, so nothing reads those keys —
 * but they still occupy the origin's quota, which is what pushes this store
 * into the silent-failure path above.
 *
 * They are FOLDED IN before removal rather than simply deleted: a stale split
 * key may hold a longer transcript than the live map (that is exactly what
 * happens when the split scheme was the writer). Adopt the longer one, then
 * free the space. Guarded by a flag so it costs one scan, once.
 */
const SPLIT_PREFIX = 'conv:unified:';
const SPLIT_INDEX_KEY = `${STORAGE_KEY}:index`;
const RECLAIM_FLAG = `${STORAGE_KEY}:reclaimed:v1`;

export const reclaimSplitKeys = (conversations) => {
  try {
    if (typeof localStorage === 'undefined' || localStorage.getItem(RECLAIM_FLAG)) return conversations;

    // Collect first: removing while iterating by index skips entries.
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SPLIT_PREFIX)) keys.push(k);
    }

    let adopted = 0;
    for (const k of keys) {
      const channelKey = k.slice(SPLIT_PREFIX.length);
      try {
        const conv = JSON.parse(localStorage.getItem(k) || 'null');
        const incoming = Array.isArray(conv?.messages) ? conv.messages.length : 0;
        const current = Array.isArray(conversations[channelKey]?.messages) ? conversations[channelKey].messages.length : 0;
        if (conv && incoming > current) {
          conversations[channelKey] = {
            messages: conv.messages || [],
            conversationId: conv.conversationId || null,
            lastUpdate: conv.lastUpdate || Date.now(),
            suggestions: conv.suggestions || [],
          };
          adopted++;
        }
      } catch { /* unreadable key — dropping it is the point */ }
      localStorage.removeItem(k);
    }
    localStorage.removeItem(SPLIT_INDEX_KEY);
    localStorage.setItem(RECLAIM_FLAG, String(Date.now()));

    if (keys.length) {
      console.info(`[chatUnified] reclaimed ${keys.length} orphaned split-storage key(s); adopted ${adopted} longer transcript(s)`);
      persistNow(conversations);
    }
  } catch (e) {
    console.warn('[chatUnified] split-key reclaim failed (non-fatal):', e);
  }
  return conversations;
};

// PRD-058: debounced persistence.
//
// persistNow() JSON.stringifies the ENTIRE multi-channel conversations object.
// With base64 image/audio payloads inline in tool args/results this produces
// multi-MB strings, and it used to run synchronously on every tool event —
// heap snapshots showed 17+ retained copies of the same multi-MB string during
// a single streaming turn. Debouncing collapses an N-tool-event stream into a
// single serialization, while:
//   • MAX_PERSIST_LATENCY_MS caps staleness during long-running streams,
//   • flushPersist() runs on pagehide/beforeunload so a closing window never
//     loses the tail of a conversation,
//   • stream boundaries (SET_STREAMING → false) flush immediately.
const PERSIST_DEBOUNCE_MS = 600;
const MAX_PERSIST_LATENCY_MS = 5000;

let persistTimer = null;
let pendingConversations = null;
let firstPendingAt = 0;

const flushPersist = () => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (pendingConversations) {
    const conversations = pendingConversations;
    pendingConversations = null;
    firstPendingAt = 0;
    persistNow(conversations);
  }
};

const persistConversations = (conversations) => {
  pendingConversations = conversations;
  if (!firstPendingAt) firstPendingAt = Date.now();

  // Cap: a continuous stream of mutations must not postpone durability forever.
  if (Date.now() - firstPendingAt >= MAX_PERSIST_LATENCY_MS) {
    flushPersist();
    return;
  }

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
};

if (typeof window !== 'undefined') {
  // pagehide is the reliable unload signal (fires on tab close, navigation,
  // and Electron window close); beforeunload kept as a belt-and-braces fallback.
  window.addEventListener('pagehide', flushPersist);
  window.addEventListener('beforeunload', flushPersist);
}

/**
 * One-time read-only migration from a legacy per-page localStorage key.
 * The legacy key is left in place as a rollback safety net.
 */
const migrateLegacyChannel = (state, channelKey) => {
  if (state._migrated[channelKey]) return;
  const { type, id } = splitChannelKey(channelKey);
  const legacyKey = LEGACY_KEYS[type];
  if (!legacyKey || !id) {
    state._migrated[channelKey] = true;
    return;
  }
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) {
      state._migrated[channelKey] = true;
      return;
    }
    const allLegacy = JSON.parse(raw);
    const legacyConv = allLegacy?.[id];
    if (legacyConv && (legacyConv.messages?.length > 0 || legacyConv.conversationId)) {
      state.conversations[channelKey] = {
        messages: legacyConv.messages || [],
        conversationId: legacyConv.conversationId || null,
        lastUpdate: legacyConv.lastUpdate || Date.now(),
        suggestions: legacyConv.suggestions || [],
      };
      persistConversations(state.conversations);
    }
  } catch (e) {
    console.warn(`[chatUnified] Failed to migrate legacy channel "${channelKey}" from "${legacyKey}":`, e);
  } finally {
    state._migrated[channelKey] = true;
  }
};

// LRU limit for the per-channel image cache, mirroring the main chat store.
// These Maps hold base64 data URLs, so they deliberately live OUTSIDE
// `conversations` — that object is JSON.stringified into localStorage on every
// persist, and inlining image payloads there would blow the storage quota and
// re-serialize multi-MB strings on every tool event (see PRD-058 note above).
const MAX_IMAGE_CACHE = 50;

const EMPTY_IMAGE_CACHE = new Map();

// Same rationale as the image cache: offloaded tool payloads are large and must
// never reach the persisted `conversations` object.
const MAX_DATA_CACHE = 50;

const EMPTY_DATA_CACHE = new Map();

const ensureChannel = (state, channelKey) => {
  if (!state.conversations[channelKey]) {
    state.conversations[channelKey] = blankConversation();
  }
};

const generateMessageId = (() => {
  let counter = 0;
  return (channelKey) => `${(channelKey || 'chat').replace(':', '-')}-msg-${Date.now()}-${counter++}`;
})();

export default {
  namespaced: true,
  state: {
    conversations: reclaimSplitKeys(loadPersisted()),
    streamingChannels: {},          // channelKey → boolean
    loadingSuggestionsChannels: {}, // channelKey → boolean
    expandedToolCalls: {},          // channelKey → { messageId: number[] }
    runningToolCalls: {},           // channelKey → { 'msgId-toolCallId': true }
    messageStates: {},              // channelKey → { messageId: status }
    abortControllers: {},           // channelKey → AbortController
    pendingSteers: {},              // channelKey → string (mid-run steer awaiting drain)
    imageCaches: {},                // channelKey → Map(imageId → { data, ... })  [never persisted]
    dataCaches: {},                 // channelKey → Map(dataId → { content, ... }) [never persisted]
    _migrated: {},                  // channelKey → boolean
  },

  mutations: {
    SET_CONVERSATION(state, { channelKey, conversation }) {
      state.conversations[channelKey] = { ...blankConversation(), ...conversation };
      persistConversations(state.conversations);
    },
    INITIALIZE_CHANNEL(state, { channelKey, welcomeMessage }) {
      migrateLegacyChannel(state, channelKey);
      if (!state.conversations[channelKey]) {
        state.conversations[channelKey] = blankConversation();
        if (welcomeMessage) {
          state.conversations[channelKey].messages = [welcomeMessage];
        }
        persistConversations(state.conversations);
      }
    },
    ADD_MESSAGE(state, { channelKey, message }) {
      ensureChannel(state, channelKey);
      state.conversations[channelKey].messages.push(message);
      state.conversations[channelKey].lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    UPDATE_MESSAGE_CONTENT(state, { channelKey, messageId, content }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (message) {
        message.content = content;
        persistConversations(state.conversations);
      }
    },
    APPEND_MESSAGE_CONTENT(state, { channelKey, messageId, delta }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (!message) return;
      message.content = (message.content || '') + delta;
      if (!message.contentParts) message.contentParts = [];
      const lastPart = message.contentParts[message.contentParts.length - 1];
      if (lastPart && lastPart.type === 'text') {
        lastPart.text += delta;
      } else {
        message.contentParts.push({ type: 'text', text: delta });
      }
      // This was the ONLY mutation that changed a message without marking the
      // store dirty — and it is the one that carries the assistant's actual
      // words. Streamed text therefore never reached localStorage until the
      // turn's final event, so a refresh mid-answer persisted an empty string.
      // persistConversations is debounced (600ms, 5s hard cap), so appending
      // here costs one timer reset per token, not one serialize per token.
      persistConversations(state.conversations);
    },
    /**
     * Drop everything from the first locally-held message that the server is
     * about to replay. Everything after that point belongs to the same turn
     * (assistant output, and any steer bubbles interleaved with it), so the
     * replay rebuilds it exactly.
     *
     * No match means this tab holds nothing from the turn — nothing to drop.
     */
    TRUNCATE_FROM_REPLAYED_IDS(state, { channelKey, ids }) {
      const conv = state.conversations[channelKey];
      if (!conv || !Array.isArray(ids) || ids.length === 0) return;
      const replayed = new Set(ids);
      const firstIdx = conv.messages.findIndex((m) => replayed.has(m.id));
      if (firstIdx === -1) return;
      conv.messages = conv.messages.slice(0, firstIdx);
      conv.lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    /**
     * Append a user message only if it isn't already the latest one. Used when
     * reattaching to a turn whose user bubble may or may not exist locally,
     * depending on how much of the snapshot survived.
     */
    ENSURE_USER_MESSAGE(state, { channelKey, content, message }) {
      if (!content) return;
      ensureChannel(state, channelKey);
      const messages = state.conversations[channelKey].messages;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          if (messages[i].content === content) return;
          break;
        }
      }
      messages.push(message);
      state.conversations[channelKey].lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    ADD_TOOL_CALL(state, { channelKey, messageId, toolCall }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (!message) return;
      if (!message.toolCalls) message.toolCalls = [];
      if (message.toolCalls.some((tc) => tc.id === toolCall.id)) return;
      message.toolCalls.push(toolCall);
      if (!message.contentParts) message.contentParts = [];
      message.contentParts.push({ type: 'tool_call', toolCallId: toolCall.id });
      persistConversations(state.conversations);
    },
    UPDATE_TOOL_CALL_RESULT(state, { channelKey, messageId, toolCallId, result, error }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const message = conv.messages.find((m) => m.id === messageId);
      if (!message || !message.toolCalls) return;
      const toolCall = message.toolCalls.find((tc) => tc.id === toolCallId);
      if (!toolCall) return;
      toolCall.result = result;
      toolCall.error = error;
      persistConversations(state.conversations);
    },
    SET_CONVERSATION_ID(state, { channelKey, conversationId }) {
      ensureChannel(state, channelKey);
      state.conversations[channelKey].conversationId = conversationId;
      persistConversations(state.conversations);
    },
    SET_SUGGESTIONS(state, { channelKey, suggestions }) {
      ensureChannel(state, channelKey);
      state.conversations[channelKey].suggestions = suggestions || [];
      state.conversations[channelKey].lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    CLEAR_CONVERSATION(state, { channelKey, welcomeMessage }) {
      if (state.conversations[channelKey]) {
        state.conversations[channelKey].messages = welcomeMessage ? [welcomeMessage] : [];
        state.conversations[channelKey].conversationId = null;
        state.conversations[channelKey].suggestions = [];
        state.conversations[channelKey].lastUpdate = Date.now();
      } else if (welcomeMessage) {
        state.conversations[channelKey] = { ...blankConversation(), messages: [welcomeMessage] };
      }
      delete state.expandedToolCalls[channelKey];
      delete state.runningToolCalls[channelKey];
      delete state.messageStates[channelKey];
      persistConversations(state.conversations);
    },
    SET_STREAMING(state, { channelKey, isStreaming }) {
      if (isStreaming) state.streamingChannels[channelKey] = true;
      else {
        delete state.streamingChannels[channelKey];
        // PRD-058: end of a stream is a durability boundary — flush any
        // debounced persist so the completed turn hits localStorage now.
        flushPersist();
      }
    },
    SET_LOADING_SUGGESTIONS(state, { channelKey, isLoading }) {
      if (isLoading) state.loadingSuggestionsChannels[channelKey] = true;
      else delete state.loadingSuggestionsChannels[channelKey];
    },
    SET_EXPANDED_TOOL_CALLS(state, { channelKey, messageId, expandedIndexes }) {
      if (!state.expandedToolCalls[channelKey]) state.expandedToolCalls[channelKey] = {};
      state.expandedToolCalls[channelKey][messageId] = expandedIndexes;
    },
    SET_RUNNING_TOOL(state, { channelKey, messageId, toolCallId, running }) {
      if (!state.runningToolCalls[channelKey]) state.runningToolCalls[channelKey] = {};
      const key = `${messageId}-${toolCallId}`;
      if (running) state.runningToolCalls[channelKey][key] = true;
      else delete state.runningToolCalls[channelKey][key];
    },
    SET_MESSAGE_STATE(state, { channelKey, messageId, status }) {
      if (!state.messageStates[channelKey]) state.messageStates[channelKey] = {};
      if (status) state.messageStates[channelKey][messageId] = status;
      else delete state.messageStates[channelKey][messageId];
    },
    /**
     * Wipe all in-flight UI state for a channel — used by stopStream so
     * "Annie is thinking…" and tool spinners don't outlive an aborted stream.
     */
    CLEAR_CHANNEL_TRANSIENT_STATE(state, { channelKey }) {
      delete state.runningToolCalls[channelKey];
      delete state.messageStates[channelKey];
    },
    TRUNCATE_FROM(state, { channelKey, messageId }) {
      const conv = state.conversations[channelKey];
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      conv.messages = conv.messages.slice(0, idx);
      conv.lastUpdate = Date.now();
      persistConversations(state.conversations);
    },
    MIGRATE_CHANNEL_KEY(state, { fromChannelKey, toChannelKey }) {
      if (fromChannelKey === toChannelKey) return;
      if (state.conversations[fromChannelKey]) {
        state.conversations[toChannelKey] = state.conversations[fromChannelKey];
        delete state.conversations[fromChannelKey];
      }
      for (const map of [state.expandedToolCalls, state.runningToolCalls, state.messageStates, state.imageCaches, state.dataCaches]) {
        if (map[fromChannelKey]) {
          map[toChannelKey] = map[fromChannelKey];
          delete map[fromChannelKey];
        }
      }
      persistConversations(state.conversations);
    },
    REGISTER_ABORT_CONTROLLER(state, { channelKey, controller }) {
      state.abortControllers[channelKey] = controller;
    },
    CLEAR_ABORT_CONTROLLER(state, { channelKey }) {
      delete state.abortControllers[channelKey];
    },
    SET_PENDING_STEER(state, { channelKey, content }) {
      // Append rather than replace — multiple steers within one round all
      // count and get drained together at the next seam.
      const prev = state.pendingSteers[channelKey];
      state.pendingSteers[channelKey] = prev ? `${prev}\n${content}` : content;
    },
    CLEAR_PENDING_STEER(state, { channelKey }) {
      delete state.pendingSteers[channelKey];
    },
    ADD_IMAGE_TO_CACHE(state, { channelKey, imageId, imageData, toolCallId, messageId, index }) {
      if (!imageId || !imageData) return;
      if (!state.imageCaches[channelKey]) state.imageCaches[channelKey] = new Map();
      const cache = state.imageCaches[channelKey];
      // LRU eviction — Map preserves insertion order, so the first key is oldest.
      if (cache.size >= MAX_IMAGE_CACHE) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(imageId, { data: imageData, toolCallId, messageId, index });
    },
    ADD_DATA_TO_CACHE(state, { channelKey, dataId, fullContent, toolCallId, messageId, size, path }) {
      if (!dataId || fullContent === undefined || fullContent === null) return;
      if (!state.dataCaches[channelKey]) state.dataCaches[channelKey] = new Map();
      const cache = state.dataCaches[channelKey];
      if (cache.size >= MAX_DATA_CACHE) {
        cache.delete(cache.keys().next().value);
      }
      // Key name must stay `content` — MessageItem reads cached.content.
      cache.set(dataId, { content: fullContent, toolCallId, messageId, size, path });
    },
    PERSIST_CONVERSATIONS(state) {
      // Explicit persistence request — write through immediately (PRD-058).
      pendingConversations = null;
      firstPendingAt = 0;
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      persistNow(state.conversations);
    },
  },

  getters: {
    getConversation: (state) => (channelKey) =>
      state.conversations[channelKey] || blankConversation(),
    getMessages: (state) => (channelKey) =>
      state.conversations[channelKey]?.messages || [],
    getFormattedMessages: (state) => (channelKey) => {
      const conv = state.conversations[channelKey];
      if (!conv) return [];
      const expanded = state.expandedToolCalls[channelKey] || {};
      return conv.messages.map((message) => ({
        ...message,
        expandedToolCalls: expanded[message.id] || [],
      }));
    },
    getConversationId: (state) => (channelKey) =>
      state.conversations[channelKey]?.conversationId || null,
    getSuggestions: (state) => (channelKey) =>
      state.conversations[channelKey]?.suggestions || [],
    isStreaming: (state) => (channelKey) => !!state.streamingChannels[channelKey],
    isLoadingSuggestions: (state) => (channelKey) =>
      !!state.loadingSuggestionsChannels[channelKey],
    pendingSteer: (state) => (channelKey) => state.pendingSteers[channelKey] || '',
    // Returns a shared empty Map when a channel has no images yet, so the
    // identity stays stable across renders instead of invalidating watchers.
    getImageCache: (state) => (channelKey) =>
      state.imageCaches[channelKey] || EMPTY_IMAGE_CACHE,
    getDataCache: (state) => (channelKey) =>
      state.dataCaches[channelKey] || EMPTY_DATA_CACHE,
    getMessageStatus: (state) => (channelKey, messageId) =>
      state.messageStates[channelKey]?.[messageId] || null,
    getRunningToolsForMessage: (state) => (channelKey, messageId) => {
      const map = state.runningToolCalls[channelKey] || {};
      return Object.keys(map)
        .filter((k) => k.startsWith(`${messageId}-`))
        .map((k) => k.split('-').slice(1).join('-'));
    },
  },

  actions: {
    initializeChannel({ commit }, { channelKey, welcomeMessage = null }) {
      if (!channelKey) return;
      commit('INITIALIZE_CHANNEL', { channelKey, welcomeMessage });
    },

    /**
     * Hydrate a workspace chat channel from the server conversation log when
     * this device has no (or shorter) local transcript. Uses the conversationId
     * stored on the workspace (synced via /api/workspaces) or already on the
     * local channel. No-op for non-workspace channels and when offline.
     */
    async hydrateWorkspaceChannel({ commit, state }, { channelKey } = {}) {
      if (!channelKey || !channelKey.startsWith('workspace:')) return { ok: false, reason: 'not_workspace' };
      if (state.streamingChannels[channelKey]) return { ok: false, reason: 'streaming' };

      const local = state.conversations[channelKey] || blankConversation();
      const localCount = Array.isArray(local.messages) ? local.messages.length : 0;
      // Prefer the id already on this channel, then the id synced via workspaces.
      let conversationId = local.conversationId || readWorkspaceChannelConversation(channelKey);
      // Publish any local id so other devices can discover this thread even
      // before the next chat turn (backfill for pre-sync conversations).
      if (local.conversationId) {
        writeWorkspaceChannelConversation(channelKey, local.conversationId);
      }
      if (!conversationId) return { ok: false, reason: 'no_conversation_id' };

      // Always keep the workspace map + local channel id aligned.
      if (local.conversationId !== conversationId) {
        commit('SET_CONVERSATION_ID', { channelKey, conversationId });
      }
      writeWorkspaceChannelConversation(channelKey, conversationId);

      const remote = await fetchConversation(conversationId);
      if (!remote) return { ok: false, reason: 'not_found' };

      const remoteMessages = serverMessagesToUi(remote.messages);
      // Keep the longer transcript (local may have unsent/partial UI state).
      if (remoteMessages.length <= localCount && localCount > 0) {
        return { ok: true, reason: 'local_newer_or_equal', localCount, remoteCount: remoteMessages.length };
      }
      if (remoteMessages.length === 0) {
        return { ok: true, reason: 'remote_empty' };
      }

      commit('SET_CONVERSATION', {
        channelKey,
        conversation: {
          messages: remoteMessages,
          conversationId: remote.conversationId || conversationId,
          lastUpdate: remote.updatedAt ? Date.parse(remote.updatedAt) || Date.now() : Date.now(),
          suggestions: local.suggestions || [],
        },
      });
      writeWorkspaceChannelConversation(channelKey, remote.conversationId || conversationId);
      return { ok: true, reason: 'hydrated', count: remoteMessages.length };
    },

    clearConversation({ commit }, { channelKey, welcomeMessage = null }) {
      if (!channelKey) return;
      commit('CLEAR_CONVERSATION', { channelKey, welcomeMessage });
    },

    addMessage({ commit }, { channelKey, message }) {
      if (!channelKey || !message) return;
      commit('ADD_MESSAGE', { channelKey, message });
    },

    setSuggestions({ commit }, { channelKey, suggestions }) {
      if (!channelKey) return;
      commit('SET_SUGGESTIONS', { channelKey, suggestions });
    },

    toggleToolCallExpansion({ commit, state }, { channelKey, messageId, toolCallIndex }) {
      const current = state.expandedToolCalls[channelKey]?.[messageId] || [];
      const next = [...current];
      const idx = next.indexOf(toolCallIndex);
      if (idx > -1) next.splice(idx, 1);
      else next.push(toolCallIndex);
      commit('SET_EXPANDED_TOOL_CALLS', { channelKey, messageId, expandedIndexes: next });
    },

    /**
     * Send a user message and stream the assistant response.
     *
     * @param {object} payload
     * @param {string} payload.channelKey
     * @param {string} payload.chatType
     * @param {string} payload.content     The user's message text
     * @param {object} [payload.pageContext]
     * @param {object} [payload.pageState]
     * @param {string} [payload.provider]  Defaults to store.state.aiProvider.selectedProvider
     * @param {string} [payload.model]     Defaults to store.state.aiProvider.selectedModel
     * @param {Array<object>} [payload.onFrontendEvents] Side-effect callbacks for tool-result frontend events
     */
    async sendMessage({ commit, dispatch, state, rootState }, payload) {
      const {
        channelKey,
        chatType,
        content,
        pageContext = {},
        pageState = {},
        provider,
        model,
        onFrontendEvent,
        files,
      } = payload;

      // A send needs *something* — text OR attached files. Files alone with no
      // text are valid: processUploadedFiles injects the file body into the
      // LLM prompt on the backend, so the assistant still has context to
      // respond to. Rejecting empty text unconditionally silently dropped
      // drag-and-drop uploads in sidebar chats.
      const trimmedContent = (content || '').trim();
      const hasFiles = Array.isArray(files) && files.length > 0;
      if (!channelKey || !chatType) return;
      if (!trimmedContent && !hasFiles) return;
      if (state.streamingChannels[channelKey]) return;

      // When the user drops files without typing, put a short placeholder in
      // the visible user message so the transcript reads coherently. The
      // backend still receives the actual files via multipart.
      const displayContent = trimmedContent
        || `Attached ${files.length} file${files.length === 1 ? '' : 's'}: ${files.map((f) => f.name).join(', ')}`;

      const userMessage = {
        id: generateMessageId(channelKey),
        role: 'user',
        content: displayContent,
        timestamp: Date.now(),
      };
      commit('ADD_MESSAGE', { channelKey, message: userMessage });

      const conv = state.conversations[channelKey];
      const history = toChatHistory(conv?.messages || []);

      const controller = new AbortController();
      commit('REGISTER_ABORT_CONTROLLER', { channelKey, controller });
      commit('SET_STREAMING', { channelKey, isStreaming: true });

      // Per-channel provider/model/tools take precedence over the global
      // Vuex aiProvider state, so each chat surface (orchestrator, every
      // saved-agent chat, every workflow/tool/widget/artifact chat) carries
      // its own remembered config. See chatChannelConfig.js.
      const channelPM = resolveChannelProviderModel(channelKey, rootState.aiProvider);
      // Per-workspace AI override: a workspace chat channel is keyed
      // 'workspace:<id>'. If that workspace declares its own ai provider, it
      // wins for this turn only and must NOT be persisted as the global
      // default (see backend persistDefault guard) — otherwise using one tab
      // would silently rewrite the account-wide provider.
      const wsAi = resolveWorkspaceAiForChannel(channelKey);
      const resolvedProvider = provider || wsAi?.provider || channelPM.provider;
      const resolvedModel = model || (wsAi ? (wsAi.model || channelPM.model) : channelPM.model);
      const resolvedEnabledTools = resolveChannelEnabledTools(channelKey);
      const resolvedReasoningValue = rootState.aiProvider?.reasoningValue || 'default';
      const resolvedReasoningEnabled = rootState.aiProvider?.reasoningEnabled || false;

      try {
        await streamChat({
          chatType,
          messages: history,
          provider: resolvedProvider,
          model: resolvedModel,
          // Turn-only when a workspace override is active: do not write this
          // provider back to the user's account-wide default.
          persistDefault: wsAi ? false : undefined,
          conversationId: state.conversations[channelKey]?.conversationId || null,
          pageContext,
          pageState,
          enabledTools: resolvedEnabledTools,
          reasoningValue: resolvedReasoningValue,
          reasoningEnabled: resolvedReasoningEnabled,
          files,
          signal: controller.signal,
          onEvent: (eventName, data) => {
            // Record the run the instant the server names it. This marker is
            // what a future page load reads to know a turn was left mid-flight.
            if (eventName === 'conversation_started' && data?.conversationId) {
              markRunStarted(data.conversationId, { chatType, channelKey });
            }
            handleStreamEvent({ commit, channelKey, eventName, data, onFrontendEvent });
          },
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          // User-initiated stop — drop any pending steer too. They aborted
          // for a reason; auto-firing the steer as a new turn would override
          // their intent.
          commit('CLEAR_PENDING_STEER', { channelKey });
        } else {
          console.error('[chatUnified] sendMessage error:', error);
          commit('ADD_MESSAGE', {
            channelKey,
            message: {
              id: generateMessageId(channelKey),
              role: 'assistant',
              content: `Sorry, I encountered an error: ${error.message || 'unknown error'}`,
              timestamp: Date.now(),
            },
          });
        }
      } finally {
        commit('SET_STREAMING', { channelKey, isStreaming: false });
        commit('CLEAR_ABORT_CONTROLLER', { channelKey });
        // The turn is over for this tab. Note that an AbortError lands here too:
        // the local reader stopped, so this tab has nothing left to resume.
        markRunEnded(state.conversations[channelKey]?.conversationId);

        // If a mid-turn steer never drained (turn ended on a final response
        // with no more tool rounds, so the between-rounds seam never fired),
        // re-fire the steer as a new user turn so the agent actually
        // responds. Hermes calls this the "agent exits mid-steer → next
        // user turn" fallback.
        const leftoverSteer = state.pendingSteers[channelKey];
        if (leftoverSteer) {
          commit('CLEAR_PENDING_STEER', { channelKey });
          // setTimeout breaks out of the current call stack so the
          // streaming state cleanly resets before the new turn starts.
          setTimeout(() => {
            dispatch('sendMessage', {
              channelKey,
              chatType,
              content: leftoverSteer,
              pageContext,
              pageState,
              provider,
              model,
              onFrontendEvent,
            });
          }, 0);
        }
      }
    },

    /**
     * Send a mid-run steer instead of starting a new turn. The chat input
     * dispatcher routes here when isStreaming(channelKey) is true.
     */
    async steerInFlight({ commit, state }, { channelKey, content }) {
      const conversationId = state.conversations[channelKey]?.conversationId || null;
      if (!conversationId) return { ok: false, error: 'no_conversation' };
      if (!content || !content.trim()) return { ok: false, error: 'empty' };
      const resp = await emitSteer(conversationId, content.trim());
      if (resp?.ok) {
        commit('SET_PENDING_STEER', { channelKey, content: content.trim() });
      }
      return resp;
    },

    /**
     * Cancel a pending steer — user clicked the X on the chip before it
     * was drained at a tool-round seam OR auto-fired at turn end.
     */
    async cancelSteer({ commit, state }, { channelKey }) {
      const conversationId = state.conversations[channelKey]?.conversationId || null;
      // Always clear locally so the chip disappears, even if the socket
      // call fails — local state is what's user-visible.
      commit('CLEAR_PENDING_STEER', { channelKey });
      if (conversationId) {
        // Fire-and-forget — backend cleanup is best-effort.
        emitClearSteer(conversationId).catch(() => {});
      }
    },

    /**
     * Edit a previous user message: truncate everything from that message onward,
     * then resend with the new content. Mirrors Chat.vue's handleEditMessage.
     */
    async editMessage({ commit, dispatch, state }, payload) {
      const {
        channelKey,
        chatType,
        messageId,
        newContent,
        pageContext = {},
        pageState = {},
        provider,
        model,
        onFrontendEvent,
      } = payload;
      if (!channelKey || !messageId || !newContent || !newContent.trim()) return;
      if (state.streamingChannels[channelKey]) return;

      commit('TRUNCATE_FROM', { channelKey, messageId });

      await dispatch('sendMessage', {
        channelKey,
        chatType,
        content: newContent,
        pageContext,
        pageState,
        provider,
        model,
        onFrontendEvent,
      });
    },

    stopStream({ commit, state }, { channelKey }) {
      const conversationId = state.conversations[channelKey]?.conversationId || null;

      // Tell the SERVER to stop. Aborting the fetch below only closes this tab's
      // socket, and a closed socket no longer cancels generation — that is the
      // whole point of making runs survive a refresh. Without this call, Stop
      // would hide the answer while the model kept billing.
      if (conversationId) {
        cancelRun(conversationId).catch(() => {});
        markRunEnded(conversationId);
      }

      const ctrl = state.abortControllers[channelKey];
      if (ctrl) {
        try { ctrl.abort(); } catch (e) { /* ignore */ }
      }
      commit('CLEAR_ABORT_CONTROLLER', { channelKey });
      commit('SET_STREAMING', { channelKey, isStreaming: false });
      // Server-side `tool_end` / `final_content` events won't arrive after an
      // abort, so the "Annie is thinking…" indicator and any tool spinners
      // would stay lit forever. Clear them client-side as part of the stop.
      commit('CLEAR_CHANNEL_TRANSIENT_STATE', { channelKey });
    },

    /**
     * Rejoin a turn that was still generating when this tab last went away.
     *
     * The server replays the whole turn from `conversation_started` and then
     * continues live, so the events arrive in exactly the order a fresh turn
     * would produce. That means this needs no reconciliation logic of its own —
     * it feeds the same handler and converges on the same state.
     */
    async reattachChannel({ commit, state }, { channelKey, conversationId, onFrontendEvent }) {
      if (!channelKey || !conversationId) return false;
      if (state.streamingChannels[channelKey]) return false;

      commit('INITIALIZE_CHANNEL', { channelKey });
      commit('SET_CONVERSATION_ID', { channelKey, conversationId });

      const controller = new AbortController();
      commit('REGISTER_ABORT_CONTROLLER', { channelKey, controller });

      // Streaming state is raised on the FIRST replayed event, not before it.
      // Flipping it on optimistically would flash a spinner on every page load
      // where nothing turned out to be running.
      let live = false;
      const raiseStreaming = () => {
        if (live) return;
        live = true;
        commit('SET_STREAMING', { channelKey, isStreaming: true });
      };

      try {
        const attached = await reattachRun({
          conversationId,
          signal: controller.signal,
          onEvent: (eventName, data) => {
            raiseStreaming();
            handleStreamEvent({ commit, channelKey, eventName, data, onFrontendEvent });
          },
        });
        return attached;
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('[chatUnified] reattachChannel failed:', error?.message || error);
        }
        return false;
      } finally {
        if (live) commit('SET_STREAMING', { channelKey, isStreaming: false });
        commit('CLEAR_ABORT_CONTROLLER', { channelKey });
        commit('CLEAR_CHANNEL_TRANSIENT_STATE', { channelKey });
        markRunEnded(conversationId);
      }
    },

    /**
     * Optionally fetch contextual suggestions from /orchestrator/suggestions.
     */
    async fetchSuggestions({ commit, state, rootState }, { channelKey, chatType, contextLabel }) {
      if (state.loadingSuggestionsChannels[channelKey]) return;
      const conv = state.conversations[channelKey];
      const messages = conv?.messages || [];
      if (messages.length < 2) return;

      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content;
      const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant')?.content;
      if (!lastUserMessage || !lastAssistantMessage) return;

      commit('SET_LOADING_SUGGESTIONS', { channelKey, isLoading: true });
      try {
        const { API_CONFIG } = await import('@/tt.config.js');
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const recentHistory = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        const channelPM = resolveChannelProviderModel(channelKey, rootState.aiProvider);
        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/suggestions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            history: recentHistory,
            lastUserMessage,
            lastAssistantMessage,
            provider: channelPM.provider,
            model: channelPM.model,
            context: contextLabel || chatType,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data?.suggestions)) {
            commit('SET_SUGGESTIONS', { channelKey, suggestions: data.suggestions.slice(0, 2) });
          }
        }
      } catch (e) {
        console.error('[chatUnified] fetchSuggestions error:', e);
      } finally {
        commit('SET_LOADING_SUGGESTIONS', { channelKey, isLoading: false });
      }
    },
  },
};

/**
 * Translate raw SSE events from chatService into store mutations.
 */
export function handleStreamEvent({ commit, channelKey, eventName, data, onFrontendEvent }) {
  switch (eventName) {
    case 'conversation_started':
      commit('SET_CONVERSATION_ID', { channelKey, conversationId: data.conversationId });
      // Publish id into workspace sync blob so other devices can reload this thread.
      if (channelKey && channelKey.startsWith('workspace:') && data.conversationId) {
        writeWorkspaceChannelConversation(channelKey, data.conversationId);
      }
      break;

    // Head frame of a reattach. The local transcript may predate the user turn
    // that started this run (the snapshot on disk can be older than the send),
    // so restore the bubble if it's missing rather than replaying an answer to
    // a question that isn't visible.
    case 'run_resumed':
      // Order matters: clear this turn's partial output first, then make sure
      // the question is present, then let the replay rebuild the answer.
      commit('TRUNCATE_FROM_REPLAYED_IDS', { channelKey, ids: data?.replayedMessageIds });
      if (data?.userMessage) {
        commit('ENSURE_USER_MESSAGE', {
          channelKey,
          content: data.userMessage,
          message: {
            id: generateMessageId(channelKey),
            role: 'user',
            content: data.userMessage,
            timestamp: data.startedAt || Date.now(),
          },
        });
      }
      break;

    // Terminator for a reattached stream that ended without a normal 'done'
    // (cancelled, superseded, or the server finished while we were replaying).
    case 'run_ended':
      commit('CLEAR_CHANNEL_TRANSIENT_STATE', { channelKey });
      commit('PERSIST_CONVERSATIONS');
      break;

    case 'steering_applied':
      commit('CLEAR_PENDING_STEER', { channelKey });
      // Seal the outgoing assistant bubble. The backend mints a NEW
      // assistantMessageId immediately after this event so the post-steer
      // output renders BELOW the steer; final_content only ever clears the
      // LAST id, so without this the pre-steer bubble would spin forever.
      if (data.assistantMessageId) {
        commit('SET_MESSAGE_STATE', {
          channelKey,
          messageId: data.assistantMessageId,
          status: null,
        });
      }
      // Surface the steer text as a real user message in the transcript at
      // the round it landed. Without this, the steer is buried inside the
      // tool-result content (Hermes pattern) and the user never sees what
      // they sent.
      if (data.content) {
        commit('ADD_MESSAGE', {
          channelKey,
          message: {
            id: generateMessageId(channelKey),
            role: 'user',
            content: data.content,
            timestamp: Date.now(),
            steered: true,
          },
        });
      }
      break;

    case 'assistant_message': {
      const assistantMessage = { ...data, role: 'assistant', toolCalls: [] };
      commit('ADD_MESSAGE', { channelKey, message: assistantMessage });
      commit('SET_MESSAGE_STATE', {
        channelKey,
        messageId: data.id,
        status: { type: 'thinking', text: 'Annie is thinking...' },
      });
      break;
    }

    case 'content_delta':
      commit('APPEND_MESSAGE_CONTENT', {
        channelKey,
        messageId: data.assistantMessageId,
        delta: data.delta,
      });
      break;

    case 'tool_start':
      commit('ADD_TOOL_CALL', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCall: { ...data.toolCall },
      });
      commit('SET_RUNNING_TOOL', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        running: true,
      });
      commit('SET_MESSAGE_STATE', {
        channelKey,
        messageId: data.assistantMessageId,
        status: { type: 'tool', text: `Running ${data.toolCall.name}...` },
      });
      break;

    case 'tool_end': {
      commit('UPDATE_TOOL_CALL_RESULT', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        result: data.toolCall.result,
        error: data.toolCall.error,
      });
      commit('SET_RUNNING_TOOL', {
        channelKey,
        messageId: data.assistantMessageId,
        toolCallId: data.toolCall.id,
        running: false,
      });
      // Forward tool-result frontend events for caller-side side effects (file_written, widget-saved, etc.)
      let toolResult = data.toolCall.result;
      if (typeof toolResult === 'string') {
        try { toolResult = JSON.parse(toolResult); } catch { /* not JSON */ }
      }
      if (toolResult?.frontendEvents) {
        for (const evt of toolResult.frontendEvents) {
          // Tutorial events are global-scope (not chat-channel-scope) — dispatch
          // a window event the AIGuidedTourHost picks up regardless of which
          // chat channel produced the tool call.
          if (evt.type === 'tutorial:start' || evt.type === 'tutorial:end') {
            try {
              window.dispatchEvent(new CustomEvent(
                evt.type === 'tutorial:start' ? 'ai-tour:start' : 'ai-tour:end',
                { detail: evt.data }
              ));
            } catch (e) {
              console.error('[chatUnified] dispatching tutorial event failed:', e);
            }
            continue;
          }
          if (typeof onFrontendEvent === 'function') {
            try { onFrontendEvent(evt.type, evt.data, data.toolCall); } catch (e) {
              console.error('[chatUnified] onFrontendEvent threw:', e);
            }
          }
        }
      }
      if (typeof onFrontendEvent === 'function') {
        try { onFrontendEvent('tool-completed', { toolCall: data.toolCall }, data.toolCall); } catch (e) { /* noop */ }
      }
      break;
    }

    case 'frontend_event':
      console.log('[chatUnified] frontend_event SSE received', { eventType: data.eventType, hasData: !!data.eventData });
      // Tutorial events are global-scope (not chat-channel-scope) — dispatch
      // a window event the AIGuidedTourHost picks up regardless of which
      // chat channel produced the tool call. This is the primary delivery
      // path: OrchestratorService strips frontendEvents from tool_end and
      // ships each one through this `frontend_event` SSE.
      if (data.eventType === 'tutorial:start' || data.eventType === 'tutorial:end') {
        try {
          window.dispatchEvent(new CustomEvent(
            data.eventType === 'tutorial:start' ? 'ai-tour:start' : 'ai-tour:end',
            { detail: data.eventData }
          ));
          console.log('[chatUnified] dispatched window event', data.eventType);
        } catch (e) {
          console.error('[chatUnified] dispatching tutorial event failed:', e);
        }
      }
      if (typeof onFrontendEvent === 'function') {
        try { onFrontendEvent(data.eventType, data.eventData); } catch (e) {
          console.error('[chatUnified] onFrontendEvent threw:', e);
        }
      }
      break;

    case 'final_content':
      commit('PERSIST_CONVERSATIONS');
      commit('SET_MESSAGE_STATE', {
        channelKey,
        messageId: data.assistantMessageId,
        status: null,
      });
      break;

    case 'image_generated':
      // Generated images stream in as base64 out-of-band and the message body
      // only carries a {{IMAGE_REF:id}} placeholder. MessageItem resolves that
      // placeholder against this cache; without it the reference falls through
      // to /api/images/:id, which is authenticated and so cannot be fetched by
      // a plain <img src>. Dropping this event was why images rendered in the
      // main chat but not in sidebar channels.
      commit('ADD_IMAGE_TO_CACHE', {
        channelKey,
        imageId: data.imageId,
        imageData: data.imageData,
        toolCallId: data.toolCallId,
        messageId: data.assistantMessageId,
        index: data.index,
      });
      break;

    case 'data_content':
      // Large tool results are offloaded and the tool card only carries a
      // {{DATA_REF:id}} placeholder. MessageItem resolves it against this
      // cache; without it the card renders "[Large data - <id>]" forever.
      commit('ADD_DATA_TO_CACHE', {
        channelKey,
        dataId: data.dataId,
        fullContent: data.fullContent,
        toolCallId: data.toolCallId,
        messageId: data.assistantMessageId,
        size: data.size,
        path: data.path,
      });
      break;

    case 'data_offloaded':
    case 'context_status':
      // Backend-only / observability events; nothing to do in the unified store.
      break;

    case 'error': {
      const errorMessageId = `${channelKey.replace(':', '-')}-err-${Date.now()}`;
      commit('ADD_MESSAGE', {
        channelKey,
        message: {
          id: errorMessageId,
          role: 'assistant',
          content: `An error occurred: ${data.error || data.message || 'unknown error'}`,
          timestamp: Date.now(),
        },
      });
      commit('SET_STREAMING', { channelKey, isStreaming: false });
      break;
    }

    case 'done':
      commit('SET_STREAMING', { channelKey, isStreaming: false });
      break;

    default:
      // Unrecognized event — log at debug level only.
      // console.debug(`[chatUnified] Unhandled SSE event: ${eventName}`);
      break;
  }
}
