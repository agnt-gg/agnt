// toolCallSettlement — a tool call that will never get a result must say so.
//
// THE BUG THIS EXISTS TO END
// --------------------------
// When a stream is cut (Stop, a dropped socket, a resumed turn), every tool
// call the model had issued but not yet received a result for is left with
// `status: 'pending'` and no `result`. MessageItem's status pill derives
// "pending" from the ABSENCE of a result, so those calls spin forever — on
// reload, in every later visit, as a wall at the bottom of the message.
// Measured on one real conversation: 709 of 1,087 tool calls stuck.
//
// The backend already injects a synthetic "Tool execution cancelled" result
// for the MODEL's history (messageSanitizers.js) so the next turn replays;
// it never told the CLIENT. This module is the client-side counterpart.
//
// Two entry points, one rule:
//   settleOpenToolCalls   — on abort: every open call → interrupted, now.
//   healStaleToolCalls    — on hydrate: any open call on a message that is
//                           not the live stream → interrupted (self-heals
//                           conversations saved before this fix).
//
// Pure functions over plain objects; the store commits what they return.

export const INTERRUPTED_STATUS = 'interrupted';

export const INTERRUPTED_RESULT = Object.freeze({
  success: false,
  interrupted: true,
  error: 'Tool call interrupted: the stream ended before a result arrived.',
});

/** True when a tool call has neither a result nor an error — i.e. still open. */
export function isOpenToolCall(tc) {
  if (!tc) return false;
  const hasResult = tc.result !== undefined && tc.result !== null;
  return !hasResult && !tc.error;
}

/**
 * Return a copy of `toolCalls` with every open call settled as interrupted.
 * Settled and errored calls are returned as-is (same object identity), so a
 * caller can cheaply detect "nothing changed" via `changed`.
 */
export function settleOpenToolCalls(toolCalls, { at = Date.now() } = {}) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return { toolCalls: toolCalls || [], changed: 0 };
  let changed = 0;
  const out = toolCalls.map((tc) => {
    if (!isOpenToolCall(tc)) return tc;
    changed++;
    return {
      ...tc,
      status: INTERRUPTED_STATUS,
      result: JSON.stringify(INTERRUPTED_RESULT),
      error: INTERRUPTED_RESULT.error,
      interruptedAt: at,
    };
  });
  return { toolCalls: out, changed };
}

/**
 * Heal a loaded conversation's messages. Only NON-live messages are touched:
 * the message currently streaming (if any) legitimately has open calls.
 *
 * @param {Array} messages
 * @param {{ liveMessageId?: string|null }} [opts]
 * @returns {{ messages: Array, healed: number }}  healed = tool calls settled
 */
export function healStaleToolCalls(messages, { liveMessageId = null } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return { messages: messages || [], healed: 0 };
  let healed = 0;
  const out = messages.map((m) => {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.toolCalls) || m.toolCalls.length === 0) return m;
    if (liveMessageId && m.id === liveMessageId) return m;
    const { toolCalls, changed } = settleOpenToolCalls(m.toolCalls);
    if (!changed) return m;
    healed += changed;
    return { ...m, toolCalls };
  });
  return { messages: out, healed };
}
