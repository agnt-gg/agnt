/**
 * Preview planning without stalling the server.
 *
 * The full parse (planWithFullParse) is synchronous and grows with document
 * size: ~450 ms for a 4.8 MB page, during which every other request waits,
 * chat streams included. Most documents never need it (the landmark scan
 * answers in milliseconds); the rest are small enough that a hand-off costs
 * more than the parse. Large full parses run on one long-lived worker thread.
 *
 * Why long-lived rather than a thread per job (cf. scrape/convert.js): a
 * fresh thread loads cheerio again, ~215 ms on every preview, which would
 * make a large preview slower than parsing it inline. A warm thread adds
 * ~20 ms. It is started on first use, never holds the process open, and is
 * released after IDLE_MS. Any failure discards it; the next job starts a new
 * one, so a pathological document costs its own request and nothing else.
 */
import { Worker } from 'node:worker_threads';
import { planPreviewDocumentFast, planWithFullParse } from './artifactPreviewDocument.js';

/** Below this a full parse (~25 ms) is cheaper than the hand-off to a thread. */
export const OFF_THREAD_MIN_CHARS = 256 * 1024;
const IDLE_MS = 60_000;
const JOB_TIMEOUT_MS = 30_000;
const HEAP_MB = 1024;

/** Failures a caller should present as "too large to preview", not as a server error. */
export const PREVIEW_LIMIT_ERRORS = new Set(['preview_too_complex', 'preview_timeout']);

let thread = null;
let nextJobId = 0;

function startThread() {
  const worker = new Worker(new URL('./artifactPreviewWorker.js', import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, maxYoungGenerationSizeMb: 64 },
  });
  worker.unref();
  const state = { worker, jobs: new Map(), idleTimer: null };
  // Settles every job on this thread and retires it. Idempotent: 'error' is
  // followed by 'exit', and a deadline terminates before 'exit' arrives.
  state.fail = (reason) => {
    if (thread === state) thread = null;
    clearTimeout(state.idleTimer);
    for (const job of state.jobs.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(reason));
    }
    state.jobs.clear();
  };
  worker.on('message', ({ id, plan, error }) => {
    const job = state.jobs.get(id);
    if (!job) return;
    state.jobs.delete(id);
    clearTimeout(job.timer);
    if (error) job.reject(new Error(error));
    else job.resolve(plan);
    if (!state.jobs.size) scheduleRelease(state);
  });
  worker.on('error', (error) => state.fail(error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'preview_too_complex' : 'preview_failed'));
  worker.on('exit', () => state.fail('preview_failed'));
  return state;
}

function scheduleRelease(state) {
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    if (state.jobs.size) return;
    state.fail('preview_failed');
    state.worker.terminate().catch(() => {});
  }, IDLE_MS);
  state.idleTimer.unref();
}

/** planWithFullParse on the worker thread. Rejects 'worker_unavailable' when threads cannot start. */
export function planWithFullParseOffThread(source, { documentURL, prefix } = {}) {
  return new Promise((resolve, reject) => {
    try {
      thread ??= startThread();
    } catch {
      reject(new Error('worker_unavailable'));
      return;
    }
    const state = thread;
    clearTimeout(state.idleTimer);
    const id = ++nextJobId;
    const timer = setTimeout(() => {
      state.fail('preview_timeout');
      state.worker.terminate().catch(() => {});
    }, JOB_TIMEOUT_MS);
    timer.unref();
    state.jobs.set(id, { resolve, reject, timer });
    state.worker.postMessage({ id, source, options: { documentURL, prefix } });
  });
}

/** The preview plan, computed where it is cheapest without blocking the event loop for long. */
export async function planPreviewDocumentAsync(source, options = {}) {
  const fast = planPreviewDocumentFast(source, options);
  if (fast) return fast;
  if (source.length < OFF_THREAD_MIN_CHARS) return planWithFullParse(source, options);
  try {
    return await planWithFullParseOffThread(source, options);
  } catch (error) {
    // Only when threads are unavailable. A document that crashed or stalled
    // the worker would do the same to the server.
    if (error.message === 'worker_unavailable') return planWithFullParse(source, options);
    throw error;
  }
}

/** Test seam: whether a worker thread is currently alive. */
export function _previewThreadAlive() {
  return thread !== null;
}
