/**
 * Ambient correlation context.
 *
 * Call sites should never have to thread a context object through five layers
 * just so a log line knows which workflow it belongs to. AsyncLocalStorage
 * propagates across `await` boundaries with no dependency and no monkey-patching.
 *
 * Wrap once at each entry point (chat handler, workflow executor, tool runner)
 * and every record produced anywhere downstream carries conversationId /
 * executionId / workflowId / nodeId / userId automatically. That is what turns
 * "poll error" into "poll error, workflow 5c29225f, node buzz-trigger-1,
 * 847 consecutive, user add4b3d4".
 */
import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

/** Keys promoted into every record's `ctx`. Anything else is ignored. */
const CTX_KEYS = ['userId', 'conversationId', 'executionId', 'workflowId', 'nodeId', 'agentId', 'goalId', 'requestId'];

/** Run `fn` with `ctx` merged over any inherited context. */
export function withContext(ctx, fn) {
  const merged = { ...(storage.getStore() || {}) };
  for (const key of CTX_KEYS) {
    if (ctx && ctx[key] !== undefined && ctx[key] !== null) merged[key] = ctx[key];
  }
  return storage.run(merged, fn);
}

/** Add fields to the CURRENT context in place (no new async scope). */
export function setContext(ctx) {
  const store = storage.getStore();
  if (!store || !ctx) return;
  for (const key of CTX_KEYS) {
    if (ctx[key] !== undefined && ctx[key] !== null) store[key] = ctx[key];
  }
}

/** Snapshot of the ambient context, or `undefined` when there is none. */
export function currentContext() {
  const store = storage.getStore();
  if (!store) return undefined;
  let out;
  for (const key of CTX_KEYS) {
    if (store[key] !== undefined) {
      out = out || {};
      out[key] = store[key];
    }
  }
  return out;
}

export default { withContext, setContext, currentContext };
