/**
 * eagerToolRuns.js — tool calls started while the model is still talking.
 *
 * THE PROBLEM THIS FILE EXISTS TO SOLVE:
 *
 *   A tool call's arguments are complete long before the model's stream is.
 *   In a fifteen-tool round the first call is fully written seconds in, but
 *   nothing used to execute until the LAST call was written and the stream
 *   closed. Fifteen cards sat on "running" for minutes while nothing ran,
 *   then all fifteen executed together and finished within seconds of each
 *   other. The user, reasonably, read that as "every tool is held up by
 *   every other tool".
 *
 *   With this ledger a call starts the moment its transport says the
 *   arguments are complete (`tool_call_complete`), concurrently with the
 *   rest of the stream. The round then CLAIMS the runs already in flight
 *   instead of starting them.
 *
 * THE HAZARD THIS FILE EXISTS TO CONTAIN:
 *
 *   Transports may re-stream a whole attempt after tokens were emitted —
 *   Anthropic when a later tool call arrives truncated, OpenAI-style when a
 *   later call fails schema validation. The re-streamed attempt emits the
 *   SAME calls again under NEW ids. A call that already ran must not run
 *   twice, so runs are also keyed by fingerprint (name + raw arguments): a
 *   second call with an identical fingerprint is a DUPLICATE of the first,
 *   and claiming it hands back the first run's result re-keyed to the new id.
 *
 *   Ids the round never claims (the adapter dropped the call after it was
 *   started) are drained, never abandoned — the work already happened and
 *   its promise must settle inside the turn.
 *
 * Pure. No I/O. The runner is injected.
 */

export function toolCallFingerprint(toolCall) {
  const name = toolCall?.function?.name ?? '';
  const args = toolCall?.function?.arguments ?? '';
  return `${name}::${args}`;
}

/**
 * @param {(toolCall) => Promise<any>} run  executes one tool call; must not throw
 */
export function createEagerToolRuns(run) {
  /** id -> { promise, fingerprint, duplicateOf: id|null } */
  const byId = new Map();
  /** fingerprint -> { id, promise } for the FIRST run with that fingerprint */
  const byFingerprint = new Map();

  return {
    /**
     * Start `toolCall` now unless a run for its id, or an identical call,
     * is already in flight. Returns true when a new run was started.
     */
    start(toolCall) {
      const id = toolCall?.id;
      if (!id || byId.has(id)) return false;
      const fingerprint = toolCallFingerprint(toolCall);
      const original = byFingerprint.get(fingerprint);
      if (original) {
        byId.set(id, { promise: original.promise, fingerprint, duplicateOf: original.id });
        return false;
      }
      // The run starts NOW, on this tick — the whole point is that the tool
      // is executing while the model writes the next call. A failure, sync
      // or async, is captured here so nothing surfaces as an unhandled
      // rejection mid-stream; the runner already converts tool failures
      // into results, this is the last line of defence.
      let promise;
      try {
        promise = Promise.resolve(run(toolCall));
      } catch (error) {
        promise = Promise.resolve({ __eagerRunError: error });
      }
      promise = promise.catch((error) => ({ __eagerRunError: error }));
      byId.set(id, { promise, fingerprint, duplicateOf: null });
      byFingerprint.set(fingerprint, { id, promise });
      return true;
    },

    /** Is a run (or duplicate) registered for this id? */
    has(id) {
      return byId.has(id);
    },

    /**
     * Take the run for `id` out of the ledger. Returns
     * `{ promise, duplicateOf }` or undefined when nothing was started.
     */
    claim(id) {
      const entry = byId.get(id);
      if (!entry) return undefined;
      byId.delete(id);
      return { promise: entry.promise, duplicateOf: entry.duplicateOf };
    },

    /**
     * Forget every fingerprint and return the promises of every run that was
     * started but never claimed, so the caller can settle them. Called once
     * per round after the round has claimed what it needs.
     */
    drain() {
      const unclaimed = [];
      for (const [id, entry] of byId) {
        if (entry.duplicateOf === null) unclaimed.push({ id, promise: entry.promise });
      }
      byId.clear();
      byFingerprint.clear();
      return unclaimed;
    },

    get size() {
      return byId.size;
    },
  };
}
