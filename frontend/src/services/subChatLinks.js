/**
 * Handoffs and handbacks between the Main chat and its sub-chats, read from
 * chat messages so the chat can draw them as linked cards.
 *
 *   handoff  — the Main chat's start_chat tool call (its result names the new
 *              chat's saved row id).
 *   handback — the "[System: Sub-chat finished]" turn the backend writes into
 *              the Main chat when work comes back (subChatReports.js). It is a
 *              user-role message, so without this it read as if the user had
 *              typed it. The backend tags it with a marker naming each sub-chat;
 *              reports written before the marker are matched by title.
 *
 * Display only: the backend's report text, the model's reply and what is
 * texted to the user's phone are untouched.
 */
export const SUB_CHAT_MARKER = 'agnt-subchats';
const MARKER = new RegExp(`<!--\\s*${SUB_CHAT_MARKER}:([A-Za-z0-9_-]+)\\s*-->`);
const REPORT_HEAD = /^\[System: (?:Sub-chat finished|\d+ sub-chats finished)/;

function decodeBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The sub-chats a handback is about, or null when `message` is not one. */
export function handbackOf(message) {
  if (message?.role !== 'user' || typeof message.content !== 'string') return null;
  const content = message.content;
  if (!REPORT_HEAD.test(content)) return null;
  const marked = MARKER.exec(content);
  if (marked) {
    try {
      const items = JSON.parse(decodeBase64Url(marked[1]));
      if (Array.isArray(items) && items.length) {
        return items.map((i) => ({ outputId: i.outputId || null, title: String(i.title || 'Task'), ok: i.ok === true }));
      }
    } catch { /* unreadable marker: fall back to the prose below */ }
  }
  // Reports from before the marker: titles and results from the fixed prose.
  const items = [];
  const re = /Sub-chat: "([^"]*)"[^\n]*\nStatus: (completed|failed)/g;
  for (let m = re.exec(content); m; m = re.exec(content)) items.push({ outputId: null, title: m[1] || 'Task', ok: m[2] === 'completed' });
  return items.length ? items : [{ outputId: null, title: 'Task', ok: !/with a problem/.test(content) }];
}

const parse = (value) => {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

/** The chats an assistant message handed work to (start_chat calls). */
export function handoffsOf(message) {
  if (message?.role !== 'assistant') return [];
  const calls = message.toolCalls || message.tool_calls || [];
  return calls
    .filter((call) => (call?.name || call?.function?.name) === 'start_chat')
    .map((call) => {
      const args = parse(call.args ?? call.arguments ?? call.function?.arguments) || {};
      const result = parse(call.result);
      const started = result?.success === true && !!result.outputId;
      return {
        key: call.id || result?.outputId || args.title,
        outputId: started ? result.outputId : null,
        title: result?.title || args.title || 'Task',
        started,
        pending: call.status === 'running' || (call.result == null && !call.error),
        error: started ? null : result?.error || call.error || null,
      };
    });
}

/**
 * Where a handed-off chat is now: 'working' | 'done' | 'problem' | 'started'.
 * A handback later in this conversation settles it; a chat that is streaming
 * is working; anything else is just 'started' (never a claim it is running).
 */
export function handoffStatus(outputId, title, messages, workingIds) {
  for (const message of messages || []) {
    const items = handbackOf(message);
    const hit = items?.find((i) => (outputId && i.outputId === outputId) || (!i.outputId && i.title === title));
    if (hit) return hit.ok ? 'done' : 'problem';
  }
  if (outputId && workingIds?.has?.(outputId)) return 'working';
  return 'started';
}

/** Saved row id for a handback item from before the marker, matched by title among sub-chats. */
export function resolveByTitle(title, outputs, subChatIds) {
  const match = (outputs || []).find((o) => o?.title === title && subChatIds?.has?.(o.id));
  return match?.id || null;
}
