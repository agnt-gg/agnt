/**
 * Mobile lite (path B) — thin Annie client helpers.
 *
 * Auth: reuse /api/pairing/claim (same as web /pair).
 * Chat: reuse chatService.streamChat → POST /orchestrator/chat (real Annie).
 * History: content-outputs with contentType conversation (same store as desktop).
 */

import { API_CONFIG } from '@/tt.config.js';
import { claimPairingCodeAt } from './mobileLitePairing.js';

const authHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** @param {string} code 32-char hex pairing code */
export async function claimPairingCode(code) {
  return claimPairingCodeAt(code);
}

/**
 * Sync resolve from this browser's localStorage only.
 * Desktop Electron and mobile lite are different origins — Sim will not see
 * desktop localStorage. Prefer resolveLiteProviderModelAsync() for chat.
 */
export function resolveLiteProviderModel() {
  let channel = {};
  try {
    // Same key as chatChannelConfig.js (STORAGE_KEY).
    const raw = localStorage.getItem('agnt_chat_channel_configs');
    if (raw) {
      const all = JSON.parse(raw);
      channel = all['orchestrator:default'] || all.orchestrator || {};
    }
  } catch {
    /* ignore */
  }

  const provider =
    channel.provider || localStorage.getItem('selectedProvider') || null;
  const model = channel.model || localStorage.getItem('selectedModel') || null;

  return { provider, model };
}

/**
 * Resolve provider/model for orchestrator chat.
 * 1) localStorage / channel config (same origin as desktop)
 * 2) GET /api/users/settings — server-side defaults written when desktop picks a model
 * 3) Cache successful server values into localStorage for this origin
 *
 * @returns {Promise<{provider: string|null, model: string|null, source: string}>}
 */
export async function resolveLiteProviderModelAsync() {
  const local = resolveLiteProviderModel();
  if (local.provider && local.model) {
    return { ...local, source: 'localStorage' };
  }

  try {
    const res = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
      headers: { ...authHeaders() },
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      // Shape may be { selectedProvider, selectedModel } or nested under settings
      const provider =
        data.selectedProvider ||
        data.settings?.selectedProvider ||
        data.default_provider ||
        null;
      const model =
        data.selectedModel ||
        data.settings?.selectedModel ||
        data.default_model ||
        null;
      if (provider && model) {
        try {
          localStorage.setItem('selectedProvider', provider);
          localStorage.setItem('selectedModel', model);
        } catch {
          /* ignore quota */
        }
        return { provider, model, source: 'users/settings' };
      }
    }
  } catch (e) {
    console.warn('[mobileLite] resolve provider from settings failed', e);
  }

  return { provider: local.provider, model: local.model, source: 'none' };
}

/**
 * List saved conversations (content-outputs). Newest first.
 * @returns {Promise<Array<{id:string,title:string,conversationId?:string,updated_at?:string,created_at?:string}>>}
 */
export async function listConversations() {
  const res = await fetch(`${API_CONFIG.BASE_URL}/content-outputs`, {
    headers: { ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`listConversations: ${res.status}`);
  const data = await res.json();
  const outputs = Array.isArray(data.outputs) ? data.outputs : [];
  return outputs
    .filter((o) => {
      const type = o.contentType || o.content_type;
      return type === 'conversation' || !type;
    })
    .map((o) => ({
      id: o.id,
      title: o.title || 'Conversation',
      conversationId: o.conversationId || o.conversation_id || null,
      updated_at: o.updated_at,
      created_at: o.created_at,
    }));
}

/**
 * Load one conversation payload (messages + ids).
 * @param {string} outputId
 */
export async function loadConversation(outputId) {
  const res = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${outputId}`, {
    headers: { ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`loadConversation: ${res.status}`);
  // RunService returns the SQLite row as-is (snake_case columns).
  const data = await res.json();
  const raw = data.content ?? data.output?.content ?? null;
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
  return {
    outputId: data.id || outputId,
    title: parsed.title || data.title || 'Conversation',
    conversationId:
      parsed.conversationId || data.conversation_id || data.conversationId || null,
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
  };
}

/**
 * Persist conversation (same shape as desktop autosave).
 */
export async function saveConversation({
  outputId = null,
  conversationId,
  title,
  messages,
}) {
  const body = {
    id: outputId || undefined,
    content: JSON.stringify({
      conversationId,
      title,
      agentId: null,
      agentName: null,
      isAgentChat: false,
      messages: (messages || []).map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata || [],
        toolCalls: msg.toolCalls || [],
        // contentParts carries the text/tool ORDER. Dropping it on save meant a
        // reloaded chat re-rendered every tool card after all the prose, so a
        // multi-tool answer read in an order the model never produced.
        contentParts: msg.contentParts || [],
        reasoning: msg.reasoning || '',
      })),
      createdAt: messages[0]?.timestamp || Date.now(),
      updatedAt: Date.now(),
    }),
    contentType: 'conversation',
    conversationId,
    isShareable: false,
    title,
  };

  const res = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`saveConversation: ${res.status} ${text}`);
  }
  return res.json();
}

export function newConversationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `lite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
