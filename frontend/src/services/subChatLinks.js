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
const REPORT_HEAD = /^\[System: (?:Sub-chat (?:finished|needs your input)|\d+ sub-chats finished)/;
const NEEDS_INPUT_LINE = /^[ \t>*_]*NEEDS INPUT:[ \t*_]*(.+?)[ \t*_]*$/gim;

/** The question on a reply's last "NEEDS INPUT:" line, or null (mirrors the backend's needsInputOf). */
export function needsInputOf(content) {
  if (typeof content !== 'string') return null;
  let question = null;
  for (const m of content.matchAll(NEEDS_INPUT_LINE)) question = m[1].trim();
  return question || null;
}

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
        return items.map((i) => ({
          outputId: i.outputId || null,
          title: String(i.title || 'Task'),
          ok: i.ok === true,
          needsInput: i.needsInput === true,
          question: i.needsInput ? String(i.question || '') : null,
        }));
      }
    } catch { /* unreadable marker: fall back to the prose below */ }
  }
  // Reports from before the marker: titles and results from the fixed prose.
  const items = [];
  const re = /Sub-chat: "([^"]*)"[^\n]*\nStatus: (completed|failed|needs input)(?:\nIts question for the user: ([^\n]*))?/g;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    items.push({ outputId: null, title: m[1] || 'Task', ok: m[2] !== 'failed', needsInput: m[2] === 'needs input', question: m[3] || null });
  }
  return items.length ? items : [{ outputId: null, title: 'Task', ok: !/with a problem/.test(content), needsInput: false, question: null }];
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
    .filter((call) => ['start_chat', 'continue_chat'].includes(call?.name || call?.function?.name))
    .map((call) => {
      const args = parse(call.args ?? call.arguments ?? call.function?.arguments) || {};
      const result = parse(call.result);
      const started = result?.success === true && !!result.outputId;
      return {
        key: call.id || result?.outputId || args.title,
        // continue_chat: the user's answer (or a follow-up) sent to a chat already started.
        continued: (call?.name || call?.function?.name) === 'continue_chat',
        outputId: started ? result.outputId : null,
        title: result?.title || args.title || 'Task',
        started,
        pending: call.status === 'running' || (call.result == null && !call.error),
        error: started ? null : result?.error || call.error || null,
      };
    });
}

/**
 * Where a handed-off chat is now: 'working' | 'waiting' | 'done' | 'problem' |
 * 'started'. A chat that is streaming is working. Otherwise its LATEST handback
 * settles it (a chat can report several times: a question, then the answer).
 * Anything else is just 'started' (never a claim it is running).
 */
export function handoffStatus(outputId, title, messages, workingIds) {
  if (outputId && workingIds?.has?.(outputId)) return 'working';
  let latest = null;
  for (const message of messages || []) {
    const items = handbackOf(message);
    const hit = items?.find((i) => (outputId && i.outputId === outputId) || (!i.outputId && i.title === title));
    if (hit) latest = hit;
  }
  if (!latest) return 'started';
  return latest.needsInput ? 'waiting' : latest.ok ? 'done' : 'problem';
}

/** Saved row id for a handback item from before the marker, matched by title among sub-chats. */
export function resolveByTitle(title, outputs, subChatIds) {
  const match = (outputs || []).find((o) => o?.title === title && subChatIds?.has?.(o.id));
  return match?.id || null;
}
