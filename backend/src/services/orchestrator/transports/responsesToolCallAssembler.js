/**
 * Assembles function calls from an OpenAI Responses event stream.
 *
 * Parallel calls interleave: two `output_item.added` events can arrive before
 * either call's argument deltas, and some backends send arguments only on the
 * `.done` events or in the final `response.completed` output. Every event is
 * therefore routed by its own identity (item_id, then output_index), never by
 * "the most recently added call", and the provider's complete arguments always
 * win over what was streamed.
 *
 * Arguments are never invented: a call whose arguments are missing or
 * truncated keeps exactly what the provider sent, so the downstream parser
 * rejects it instead of executing it with `{}`.
 */

function stringifyArguments(rawArguments) {
  if (typeof rawArguments === 'string') return rawArguments;
  if (rawArguments === undefined || rawArguments === null) return '';
  return JSON.stringify(rawArguments);
}

function isCompleteJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export class ResponsesToolCallAssembler {
  /** @param {string} fallbackIdPrefix used only when the provider omits call_id */
  constructor(fallbackIdPrefix) {
    this.fallbackIdPrefix = fallbackIdPrefix;
    this.toolCalls = [];
    this._entries = []; // parallel to toolCalls: { itemId, outputIndex, callId }
  }

  _indexOf({ itemId, outputIndex, callId }) {
    if (itemId) {
      const byItem = this._entries.findIndex((entry) => entry.itemId === itemId);
      if (byItem !== -1) return byItem;
    }
    if (callId) {
      const byCall = this._entries.findIndex((entry) => entry.callId === callId);
      if (byCall !== -1) return byCall;
    }
    if (Number.isInteger(outputIndex)) {
      const byIndex = this._entries.findIndex((entry) => entry.outputIndex === outputIndex);
      if (byIndex !== -1) return byIndex;
    }
    return -1;
  }

  _upsertItem(item, outputIndex) {
    const identity = { itemId: item.id || null, outputIndex, callId: item.call_id || null };
    let index = this._indexOf(identity);
    if (index === -1) {
      index = this.toolCalls.length;
      this.toolCalls.push({
        id: item.call_id || `${this.fallbackIdPrefix}-${Date.now()}-${index}`,
        type: 'function',
        function: { name: item.name || '', arguments: '' },
      });
      this._entries.push(identity);
    } else {
      const entry = this._entries[index];
      entry.itemId ||= identity.itemId;
      entry.callId ||= identity.callId;
      if (!Number.isInteger(entry.outputIndex)) entry.outputIndex = outputIndex;
      if (item.call_id) this.toolCalls[index].id = item.call_id;
      if (item.name) this.toolCalls[index].function.name = item.name;
    }
    this._applyCompleteArguments(index, item.arguments);
    return index;
  }

  /** Provider-complete arguments replace streamed ones; partial ones never do. */
  _applyCompleteArguments(index, rawArguments) {
    const text = stringifyArguments(rawArguments);
    if (text === '') return;
    const current = this.toolCalls[index].function.arguments;
    if (isCompleteJson(text) || !isCompleteJson(current)) {
      this.toolCalls[index].function.arguments = text;
    }
  }

  /** `response.output_item.added` / `.done` for a function_call. Returns the call index. */
  onOutputItem(event) {
    const item = event.item;
    if (!item || item.type !== 'function_call') return -1;
    return this._upsertItem(item, event.output_index);
  }

  /** `response.function_call_arguments.delta`. Returns the call index, or -1 if unroutable. */
  onArgumentsDelta(event) {
    const index = this._routeArgumentEvent(event);
    if (index !== -1) this.toolCalls[index].function.arguments += event.delta || '';
    return index;
  }

  /** `response.function_call_arguments.done`, which carries the full arguments. */
  onArgumentsDone(event) {
    const index = this._routeArgumentEvent(event);
    if (index !== -1) this._applyCompleteArguments(index, event.arguments);
    return index;
  }

  _routeArgumentEvent(event) {
    const index = this._indexOf({ itemId: event.item_id, outputIndex: event.output_index, callId: event.call_id });
    if (index !== -1) return index;
    // An event carrying identity we have never seen is not guessed onto
    // another call. Identity-less events (older backends, which stream calls
    // serially) keep the legacy owner: the most recently added call.
    const hasIdentity = Boolean(event.item_id) || Number.isInteger(event.output_index);
    if (!hasIdentity && this.toolCalls.length > 0) return this.toolCalls.length - 1;
    return -1;
  }

  /** `response.completed` output: authoritative, reconciled per call. Idempotent. */
  onCompletedOutput(output) {
    if (!Array.isArray(output)) return;
    output.forEach((item, outputIndex) => {
      if (item && item.type === 'function_call') this._upsertItem(item, outputIndex);
    });
  }
}
