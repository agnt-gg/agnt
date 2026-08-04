/**
 * conversationTranscript — the ONE definition of how a chat transcript is
 * saved and read back.
 *
 * WHY THIS EXISTS
 * ---------------
 * There were two ways to persist a conversation in this app, and only one of
 * them was durable:
 *
 *   main chat   → POST /content-outputs/save, reloaded VERBATIM.
 *   unified chat → localStorage, then REBUILT on reload from
 *                  conversation_logs.full_history.
 *
 * full_history is the raw PROVIDER transcript — the exact bytes replayed to
 * the model. It is not a UI transcript and it never will be: it has one row
 * per tool round-trip, `content` becomes a block array the moment a tool is
 * called, and its shape changes whenever a provider changes. Reconstructing a
 * conversation from it shipped two user-visible bugs in a row (every
 * tool-using turn rendered "[object Object]", then every tool-using answer
 * shattered into three bubbles). Both were symptoms of the same mistake:
 * treating a wire format as a storage format.
 *
 * A transcript is a first-class artifact. It is saved the way it is rendered,
 * and it is read back the way it was saved. localStorage stays, but only as a
 * cache for instant paint — the server is the system of record.
 *
 * Every surface serializes through this module so the three hand-rolled copies
 * of this payload (chat.js autosave, mobileLiteApi, and the one unified chats
 * never had) cannot drift apart again.
 */

import { API_CONFIG } from '@/tt.config.js';
import { hydrateMessage } from './chatStreamReducer.js';

const authHeaders = () => {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Longest title we will derive from a first message. */
const TITLE_MAX = 100;

/**
 * The stored shape of one message.
 *
 * `contentParts` is NOT optional decoration: it carries the text/tool ORDER.
 * A save that drops it re-renders every tool card after all the prose, so a
 * multi-tool answer reads in an order the model never produced.
 */
export function toStoredMessage(msg = {}) {
  const stored = {
    id: msg.id,
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : '',
    timestamp: msg.timestamp || Date.now(),
    metadata: msg.metadata || [],
    toolCalls: msg.toolCalls || [],
    contentParts: msg.contentParts || [],
  };
  // Only carry optional fields when present, so a plain chat's payload stays
  // small and diffable.
  if (msg.reasoning) stored.reasoning = msg.reasoning;
  if (msg.reasoning_content) stored.reasoning_content = msg.reasoning_content;
  if (msg.files?.length) stored.files = msg.files;
  if (msg.agentId) stored.agentId = msg.agentId;
  if (msg.agentName) stored.agentName = msg.agentName;
  if (msg.agentIcon) stored.agentIcon = msg.agentIcon;
  return stored;
}

/**
 * Serialize a transcript for the `content` column.
 *
 * Image refs are stored AS-IS: {{IMAGE_REF:id}} tokens resolve to
 * /api/images/:id, and inlining base64 here made image-heavy conversations
 * ~6x larger on every single autosave.
 */
export function serializeTranscript({
  conversationId,
  title,
  messages = [],
  agentId = null,
  agentName = null,
} = {}) {
  return JSON.stringify({
    conversationId,
    title,
    agentId,
    agentName,
    isAgentChat: !!agentId,
    messages: messages.map(toStoredMessage),
    createdAt: messages[0]?.timestamp || Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * Read a stored transcript back into render-ready messages.
 *
 * Runs every message through hydrateMessage so transcripts saved before
 * contentParts existed still render their tool cards instead of blank bubbles.
 */
export function parseTranscript(raw) {
  let parsed = {};
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw;
  }

  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  return {
    conversationId: parsed.conversationId || null,
    title: parsed.title || null,
    messages: messages.map(hydrateMessage),
  };
}

/**
 * A conversation's title is the first thing the user said, trimmed at a word
 * boundary. Derived only when nothing has named it yet — a user's rename must
 * never be overwritten by an autosave.
 */
export function deriveTitle(messages = [], fallback = 'Untitled Conversation') {
  const firstUser = messages.find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim());
  if (!firstUser) return fallback;
  const text = firstUser.content.trim().replace(/\s+/g, ' ');
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TITLE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Persist a transcript. Returns the output id so the caller can update the
 * SAME row next time instead of creating a new one per save.
 *
 * @returns {Promise<{ok: boolean, outputId?: string, error?: string}>}
 */
export async function saveTranscript({
  outputId = null,
  conversationId,
  title,
  messages = [],
  agentId = null,
  agentName = null,
  viewing = false,
} = {}) {
  if (!conversationId) return { ok: false, error: 'no_conversation_id' };
  if (!messages.length) return { ok: false, error: 'empty' };

  try {
    const res = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        id: outputId || undefined,
        content: serializeTranscript({ conversationId, title, messages, agentId, agentName }),
        contentType: 'conversation',
        conversationId,
        isShareable: false,
        title,
        viewing,
      }),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const json = await res.json().catch(() => null);
    return { ok: true, outputId: json?.id || outputId || null };
  } catch (e) {
    // A failed save is not fatal — localStorage still holds this transcript,
    // and the next turn retries. It must never be silent, though.
    console.warn('[conversationTranscript] save failed:', e?.message || e);
    return { ok: false, error: e?.message || 'network' };
  }
}

/**
 * Load the transcript saved for a conversation, if there is one.
 *
 * @returns {Promise<{outputId:string, title:string|null, messages:Array}|null>}
 *          null means "nothing saved" — a legitimate answer for a conversation
 *          that predates durable saving, not an error.
 */
export async function loadTranscriptByConversationId(conversationId) {
  if (!conversationId) return null;
  try {
    const res = await fetch(
      `${API_CONFIG.BASE_URL}/content-outputs/by-conversation/${encodeURIComponent(conversationId)}`,
      { headers: authHeaders() },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn('[conversationTranscript] load failed:', res.status);
      return null;
    }
    const row = await res.json().catch(() => null);
    if (!row) return null;
    const parsed = parseTranscript(row.content);
    if (!parsed.messages.length) return null;
    return {
      outputId: row.id,
      title: parsed.title || row.title || null,
      messages: parsed.messages,
      updatedAt: row.updated_at || row.updatedAt || null,
    };
  } catch (e) {
    console.warn('[conversationTranscript] load failed:', e?.message || e);
    return null;
  }
}

export default {
  toStoredMessage,
  serializeTranscript,
  parseTranscript,
  deriveTitle,
  saveTranscript,
  loadTranscriptByConversationId,
};
