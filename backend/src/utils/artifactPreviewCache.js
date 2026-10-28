/**
 * Prepared preview plans (artifactPreviewDocument.js), per file revision.
 *
 * One artifact is requested by the inline chat frame, the fullscreen
 * previewer and every re-render of the conversation. Its plan depends only on
 * the file's bytes and the document URL, so it is computed once and reused
 * until the file changes. The per-iframe reporter is spliced in per request
 * and is never part of what is stored.
 *
 * Bounded twice: by entry count and by total characters, least recently used
 * evicted first. A plan larger than the whole character budget is returned
 * but never stored.
 */
export const PREVIEW_CACHE_MAX_ENTRIES = 32;
export const PREVIEW_CACHE_MAX_CHARS = 16 * 1024 * 1024;

/**
 * A revision key. size + mtime + ctime is the validator every static file
 * server relies on; ctime also moves on an in-place rewrite that restores
 * the old mtime.
 */
export function previewPlanKey(filePath, stat, documentURL, prefix) {
  return [filePath, stat.size, stat.mtimeMs, stat.ctimeMs, documentURL ?? '', prefix].join('\0');
}

export function createPreviewPlanCache({ maxEntries = PREVIEW_CACHE_MAX_ENTRIES, maxChars = PREVIEW_CACHE_MAX_CHARS } = {}) {
  const plans = new Map(); // insertion order is recency order
  const pending = new Map();
  let chars = 0;

  const forget = (key) => {
    const plan = plans.get(key);
    if (!plan) return;
    plans.delete(key);
    chars -= plan.html.length;
  };
  const remember = (key, plan) => {
    forget(key);
    if (plan.html.length > maxChars) return;
    plans.set(key, plan);
    chars += plan.html.length;
    while (plans.size > maxEntries || chars > maxChars) forget(plans.keys().next().value);
  };

  return {
    /**
     * The plan for `key`. `compute` runs at most once per key at a time,
     * however many requests ask concurrently; a failure reaches every waiter
     * and is not stored.
     */
    obtain(key, compute) {
      const hit = plans.get(key);
      if (hit) {
        plans.delete(key);
        plans.set(key, hit);
        return Promise.resolve(hit);
      }
      let running = pending.get(key);
      if (!running) {
        running = Promise.resolve()
          .then(compute)
          .then((plan) => {
            remember(key, plan);
            return plan;
          })
          .finally(() => pending.delete(key));
        pending.set(key, running);
      }
      return running;
    },
    get size() { return plans.size; },
    get chars() { return chars; },
    clear() {
      plans.clear();
      chars = 0;
    },
  };
}
