// chatService.js — single fetch + SSE source for every Annie chat surface.
//
// All six chat surfaces (orchestrator / agent / workflow / tool / widget / artifact)
// hit /orchestrator/<route> with the same SSE event shape. This module centralizes
// endpoint selection, request body construction, token handling, SSE parsing, and
// AbortController wiring so containers can stay focused on UI concerns.

import { API_CONFIG } from '@/tt.config.js';

const ENDPOINTS = {
  orchestrator: '/orchestrator/chat',
  agent: '/orchestrator/agent-chat',
  workflow: '/orchestrator/workflow-chat',
  tool: '/orchestrator/tool-chat',
  widget: '/orchestrator/widget-chat',
  artifact: '/orchestrator/artifact-chat',
};

/**
 * Stream a chat completion against the unified backend.
 *
 * @param {object} opts
 * @param {keyof typeof ENDPOINTS} opts.chatType
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {string} opts.provider
 * @param {string} opts.model
 * @param {string|null} [opts.conversationId]
 * @param {object} [opts.pageContext]   Page-context IDs (workflowId, agentId, toolId, widgetId, codeId, goalId)
 * @param {object} [opts.pageState]     Per-page state objects (workflowState, agentState, etc.)
 * @param {Set<string>|Array<string>} [opts.enabledTools]
 * @param {string} [opts.reasoningValue]
 * @param {boolean} [opts.reasoningEnabled]
 * @param {File[]} [opts.files]           OS-file attachments. When present, the
 *                                        request switches to multipart/form-data
 *                                        and the backend receives them via
 *                                        `upload.array('files')`.
 * @param {AbortSignal} [opts.signal]
 * @param {(eventName: string, data: any) => void} opts.onEvent
 *
 * @returns {Promise<void>} Resolves when stream ends or rejects on error/abort.
 */
export async function streamChat({
  chatType,
  messages,
  provider,
  model,
  conversationId = null,
  pageContext = {},
  pageState = {},
  enabledTools,
  reasoningValue,
  reasoningEnabled,
  files,
  signal,
  onEvent,
}) {
  if (typeof onEvent !== 'function') {
    throw new Error('chatService.streamChat: onEvent callback is required');
  }

  const endpoint = ENDPOINTS[chatType];
  if (!endpoint) {
    throw new Error(`chatService.streamChat: unknown chatType "${chatType}"`);
  }

  const token = localStorage.getItem('token');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const bodyFields = {
    messages,
    provider,
    model,
    conversationId,
    ...pageContext,
    ...pageState,
  };
  if (enabledTools !== undefined) {
    bodyFields.enabledTools = Array.isArray(enabledTools) ? enabledTools : [...enabledTools];
  }
  if (reasoningValue !== undefined) bodyFields.reasoningValue = reasoningValue;
  if (reasoningEnabled !== undefined) bodyFields.reasoningEnabled = reasoningEnabled;

  let requestBody;
  const hasFiles = Array.isArray(files) && files.length > 0;
  if (hasFiles) {
    // Multipart: strings pass through raw, everything else is JSON-encoded.
    // The backend's universalChatHandler auto-parses JSON-shaped strings back
    // into objects/arrays before the destructure runs.
    const form = new FormData();
    for (const [k, v] of Object.entries(bodyFields)) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    for (const file of files) form.append('files', file, file.name);
    requestBody = form;
    // Do NOT set Content-Type — the browser sets the multipart boundary.
  } else {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(bodyFields);
  }

  const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    signal,
    body: requestBody,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`chatService.streamChat: ${response.status} ${response.statusText} ${text}`);
  }
  if (!response.body) {
    throw new Error('chatService.streamChat: no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex;
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const parsed = parseSseBlock(block);
      if (parsed) {
        try {
          onEvent(parsed.eventName, parsed.data);
        } catch (e) {
          console.error(`chatService.streamChat: onEvent threw for "${parsed.eventName}":`, e);
        }
      }
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseBlock(buffer);
    if (parsed) {
      try {
        onEvent(parsed.eventName, parsed.data);
      } catch (e) {
        console.error(`chatService.streamChat: onEvent threw for trailing "${parsed.eventName}":`, e);
      }
    }
  }
}

/**
 * Parse a single `event: <name>\ndata: <json>` SSE block.
 * Returns null when the block is empty / malformed.
 */
function parseSseBlock(block) {
  if (!block) return null;
  const lines = block.split('\n');
  let eventName = '';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventName = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    }
  }
  if (!eventName || dataLines.length === 0) return null;
  const dataRaw = dataLines.join('\n');
  try {
    return { eventName, data: JSON.parse(dataRaw) };
  } catch (e) {
    console.error(`chatService.parseSseBlock: malformed JSON for event "${eventName}":`, e, dataRaw.slice(0, 200));
    return null;
  }
}

/**
 * Convenience helper: assemble the standard chat-history shape (user + assistant only)
 * that every backend chat handler expects.
 */
export function toChatHistory(messages) {
  return (messages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
}

export const CHAT_TYPES = Object.keys(ENDPOINTS);
