/**
 * openToolCalls.js — which tool calls has the client been shown, and not yet
 * been told the end of?
 *
 * THE INVARIANT THIS FILE EXISTS TO ENFORCE:
 *
 *   A tool call is OPEN from the first event that draws its card
 *   (`tool_pending` or `tool_start`) until a `tool_end` for its id is sent.
 *   When the turn is aborted, every open call is settled — no exceptions.
 *
 * Before this ledger existed the abort settlement iterated `toolCalls`, the
 * array the adapter returns when a stream COMPLETES. The card, though, is drawn
 * by `tool_pending`, which fires as each call is announced mid-stream. Abort
 * while calls are still being announced and the cards exist but `toolCalls`
 * does not, so nothing was settled and the cards spun forever (#88).
 *
 * The two facts — "the client has a card" and "the client has its result" —
 * are both events on the same wire. So openness is derived from the wire, at
 * the one place every event passes through, rather than re-tracked by hand at
 * each emit site. A sixth emit site added next year is covered automatically.
 *
 * Pure. No I/O. Wraps a `sendEvent(name, data)` function.
 */

export const INTERRUPTED_MESSAGE = 'Tool call interrupted: the stream ended before a result arrived.';

const OPENING_EVENTS = new Set(['tool_pending', 'tool_start']);
const CLOSING_EVENT = 'tool_end';

/**
 * A ledger of tool calls announced to the client but not yet ended.
 * Keyed by tool-call id; the value is the last name the client was told.
 */
export function createOpenToolCallLedger() {
  const open = new Map();

  return {
    /** Fold one outgoing event into the ledger. Returns nothing; never throws on shape. */
    observe(eventName, data) {
      const id = data?.toolCall?.id;
      if (!id) return;
      if (OPENING_EVENTS.has(eventName)) {
        // A later announcement may carry a name the earlier one lacked;
        // never downgrade a known name to undefined.
        const name = data.toolCall.name ?? open.get(id);
        open.set(id, name);
      } else if (eventName === CLOSING_EVENT) {
        open.delete(id);
      }
    },

    /** Has the client been shown a card for this id that is still open? */
    has(id) {
      return open.has(id);
    },

    /** Snapshot of open calls as `{ id, name }`, in announcement order. */
    entries() {
      return Array.from(open, ([id, name]) => ({ id, name }));
    },

    get size() {
      return open.size;
    },

    /**
     * The `tool_end` payloads that settle every open call as interrupted.
     * Does NOT mutate the ledger: the caller sends them through the wrapped
     * `sendEvent`, and observing those sends is what empties it. That keeps
     * one path for closing a call, and means a settlement that failed to send
     * leaves the call visibly open rather than silently forgotten.
     */
    interruptionEvents(assistantMessageId) {
      return this.entries().map(({ id, name }) => ({
        assistantMessageId,
        toolCall: {
          id,
          name,
          result: JSON.stringify({ success: false, interrupted: true, error: INTERRUPTED_MESSAGE }),
          error: INTERRUPTED_MESSAGE,
          status: 'interrupted',
        },
      }));
    },
  };
}

/**
 * Return a `sendEvent` that records every tool-call event in `ledger` before
 * forwarding it. Observation happens first so that a transport that throws
 * still leaves the ledger describing what the client was *meant* to see.
 */
export function wrapSendEventWithLedger(ledger, sendEvent) {
  return (eventName, data) => {
    ledger.observe(eventName, data);
    return sendEvent(eventName, data);
  };
}
