/**
 * The escalation queue's verbs: accept or reject waiting insights, one, some
 * or all, through /insights/escalated/{apply,reject}.
 *
 * One implementation for every surface that shows the queue (Learning's
 * "Waiting for you", the chat panel's "Awaiting approval"). Accept can call a
 * model per insight, so the server takes 50 at a time; reject is one statement
 * per batch, and 500 stays clear of SQLite's parameter limit. Batches run one
 * after another, can be stopped between batches, and always end with a resync,
 * because a batch that failed mid-way may still have applied part of its work.
 *
 * `busy` and `error` may be supplied so a screen with other work shares one
 * busy flag and one error line; otherwise the queue owns its own.
 */
import { ref, watch } from 'vue';
import { inBatches } from '@/views/Terminal/CenterPanel/screens/Learning/inBatches.js';

export const ACCEPT_BATCH = 50;
export const REJECT_BATCH = 500;

export function useEscalationQueue(store, { busy = ref(false), error = ref(''), isDisposed = () => false } = {}) {
  const progress = ref(null);
  const stopRequested = ref(false);
  watch(stopRequested, (stopping) => {
    if (progress.value) progress.value = { ...progress.value, stopping };
  });

  async function runQueue(verb, ids, size, work) {
    if (busy.value || isDisposed() || !ids.length) return;
    busy.value = true;
    error.value = '';
    stopRequested.value = false;
    progress.value = ids.length > size ? { verb, done: 0, total: ids.length, stoppable: true, stopping: false } : null;
    try {
      return await inBatches(ids, size, work, {
        shouldStop: () => stopRequested.value || isDisposed(),
        onProgress: (done) => {
          if (progress.value) progress.value = { ...progress.value, done };
        },
      });
    } catch (e) {
      error.value = e.message || 'Something went wrong. Refresh and try again.';
    } finally {
      progress.value = null;
      stopRequested.value = false;
      busy.value = false;
      store.dispatch('insights/fetchEscalated').catch(() => {});
      store.dispatch('insights/fetchStats').catch(() => {});
    }
  }

  async function accept(ids) {
    const run = await runQueue('Accepting', ids, ACCEPT_BATCH, (batch) => store.dispatch('insights/acceptEscalated', batch));
    const failed = run?.results.flatMap((r) => r.failed) || [];
    if (failed.length) error.value = `${failed.length} ${failed.length === 1 ? 'action' : 'actions'} could not be applied and are still waiting: ${failed[0].error}`;
    return run;
  }
  const reject = (ids) => runQueue('Rejecting', ids, REJECT_BATCH, (batch) => store.dispatch('insights/rejectEscalated', batch));
  const stop = () => {
    stopRequested.value = true;
  };

  return { busy, error, progress, stopRequested, accept, reject, stop };
}
