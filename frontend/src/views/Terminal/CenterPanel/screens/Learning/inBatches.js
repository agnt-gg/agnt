/**
 * Run `work` over `ids` in consecutive batches of at most `size`.
 *
 * Bulk accept can call a model per insight, so the server takes a bounded
 * batch and the page walks the queue. This is that walk: sequential (one batch
 * in flight), stoppable between batches, and reporting progress after each.
 *
 *   work(batch)      → Promise of the batch's result
 *   shouldStop()     → checked before every batch; true ends the walk early
 *   onProgress(done) → number of ids handed to `work` so far
 *
 * Resolves to { results, done, stopped }. A rejected batch rejects the walk:
 * the caller decides what a failed request means, nothing is swallowed here.
 */
export async function inBatches(ids, size, work, { shouldStop = () => false, onProgress = () => {} } = {}) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('batch size must be a positive integer');
  const results = [];
  let done = 0;
  for (let start = 0; start < ids.length; start += size) {
    if (shouldStop()) return { results, done, stopped: true };
    const batch = ids.slice(start, start + size);
    results.push(await work(batch));
    done += batch.length;
    onProgress(done);
  }
  return { results, done, stopped: false };
}
