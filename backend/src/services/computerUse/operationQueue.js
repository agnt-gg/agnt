// One physical desktop and clipboard: serialize whole operations, including
// readiness, screenshot-file reads and optional verification, across chats.
// Different sessions are NOT independent when they share this desktop.
export function createComputerOperationQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  return function enqueue(operation, signal) {
    if (pending >= 64) return Promise.reject(new Error('Computer operation queue is full; wait for the active operation.'));
    pending++;
    const execution = tail.then(() => {
      if (signal?.aborted) throw new Error('Computer operation cancelled before dispatch.');
      return operation();
    });
    // Caller retains the rejection. A failed operation must not poison the lane.
    tail = execution.then(() => { pending--; }, () => { pending--; });
    return execution;
  };
}
export const enqueueComputerOperation = createComputerOperationQueue();

export function isComputerOperation(name) {
  return /^computer[-_](observe|input|session|windows|setup)$/.test(name || '');
}

// Order complete calls before async bookkeeping can reorder their arrival at
// the native lane. Preserve parallelism for independent, non-desktop tools.
export function mapOrderedComputerCalls(calls, run) {
  let tail = Promise.resolve();
  return calls.map(call => {
    if (!isComputerOperation(call.function?.name)) return run(call);
    const operation = tail.then(() => run(call));
    tail = operation.catch(() => undefined);
    return operation;
  });
}
