/**
 * Cooperative-cancellation utilities for long-running async pipelines
 * (goal execution, multi-round LLM tool loops, etc.).
 *
 * Design: most of our LLM SDK/adapter calls do not accept an AbortSignal,
 * so true HTTP-level cancellation is not available without touching every
 * provider adapter. Instead we race the operation against the signal:
 * on abort the caller unblocks immediately (the orphaned promise is
 * swallowed), and factory-form callers never even start work that is
 * already cancelled.
 */

/**
 * Error thrown when a goal is paused, stopped, or deleted mid-execution.
 * Detected via error.name so it survives serialization boundaries.
 */
export class GoalCancelledError extends Error {
  constructor(goalId, reason = 'cancelled') {
    super(`Goal ${goalId} was ${reason}`);
    this.name = 'GoalCancelledError';
    this.goalId = goalId;
    this.reason = reason; // 'paused' | 'stopped'
  }
}

/**
 * Convert an aborted signal's reason into a rejection Error.
 * If abort() was called with an Error (e.g. GoalCancelledError), it is
 * propagated as-is so callers can inspect name/reason.
 */
function toAbortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(reason ? String(reason) : 'Operation aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Returns true for errors produced by cooperative cancellation.
 */
export function isCancellationError(error) {
  return error?.name === 'AbortError' || error?.name === 'GoalCancelledError';
}

/**
 * Race an async operation against an AbortSignal.
 *
 * @param {Promise|Function} promiseOrFactory - The operation. Prefer passing
 *   a factory `() => doWork()`: if the signal is already aborted the work is
 *   never started (avoids firing doomed HTTP requests).
 * @param {AbortSignal|null} signal - Signal to race against. Null/undefined
 *   means "not cancellable" and the operation runs unwrapped.
 * @returns {Promise} Resolves/rejects with the operation, or rejects with
 *   the signal's reason (as an Error) the moment abort fires. On abort the
 *   underlying promise keeps running detached; its eventual rejection is
 *   swallowed to avoid unhandled-rejection crashes.
 */
export function raceWithAbort(promiseOrFactory, signal) {
  const start = typeof promiseOrFactory === 'function' ? promiseOrFactory : () => promiseOrFactory;

  if (!signal) return Promise.resolve().then(start);
  if (signal.aborted) {
    // If a live promise (not a factory) was passed, detach it safely.
    if (typeof promiseOrFactory !== 'function') Promise.resolve(promiseOrFactory).catch(() => {});
    return Promise.reject(toAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const promise = Promise.resolve().then(start);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      promise.catch(() => {}); // detach: swallow the orphan's eventual rejection
      reject(toAbortError(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          resolve(value);
        }
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    );
  });
}
