/** Keep the lease alive until queued work settles; Stop cancels its queue entries. */
export function createManagedAsyncBarrier({ queue, callbacks, signal, intervalMs = 100 }) {
  const pending = new Set();
  const abort = () => { for (const id of pending) queue.cancel(id); };
  signal?.addEventListener('abort', abort, {once:true});
  return {
    ...callbacks,
    track(executionId) { pending.add(executionId); if(signal?.aborted)queue.cancel(executionId); },
    async settle() {
      try {
        while(pending.size) {
          signal?.throwIfAborted();
          for(const id of pending) {
            const execution=queue.getExecution(id);
            if(!execution)throw Object.assign(new Error('Async outcome missing; reconciliation required'),{code:'operation_uncertain'});
            if(['completed','failed','cancelled'].includes(execution.status))pending.delete(id);
          }
          if(pending.size)await new Promise(resolve=>setTimeout(resolve,intervalMs));
        }
      } finally {signal?.removeEventListener('abort',abort);}
    },
  };
}
