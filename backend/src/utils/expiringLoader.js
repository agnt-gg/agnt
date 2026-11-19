/**
 * Memoizes an async load per key for a fixed window.
 *
 * Callers that arrive while a load is in flight share it. A failed load is
 * forgotten, so the next call retries instead of replaying the error for the
 * whole window. Once maxKeys is exceeded the least recently loaded key is
 * dropped, so a long-lived process cannot grow the map without limit.
 *
 * `now` is injectable so expiry is testable without sleeping.
 *
 * @template K, V
 * @param {object} options
 * @param {(key: K) => Promise<V>|V} options.load
 * @param {number} options.ttlMs  how long a load is reused, measured from its start
 * @param {number} [options.maxKeys]
 * @param {() => number} [options.now]
 */
export function createExpiringLoader({ load, ttlMs, maxKeys = 500, now = () => Date.now() }) {
  if (typeof load !== 'function') throw new TypeError('createExpiringLoader: load must be a function');
  if (!(ttlMs > 0)) throw new RangeError('createExpiringLoader: ttlMs must be a positive number');
  if (!(maxKeys >= 1)) throw new RangeError('createExpiringLoader: maxKeys must be at least 1');

  /** @type {Map<K, {loadedAt: number, promise: Promise<V>}>} */
  const entries = new Map();

  /** @returns {Promise<V>} */
  function get(key) {
    const cached = entries.get(key);
    if (cached && now() - cached.loadedAt < ttlMs) return cached.promise;

    // Promise.resolve().then turns a synchronous throw inside load into a
    // rejection, so every failure takes the same path below.
    const entry = { loadedAt: now(), promise: Promise.resolve().then(() => load(key)) };
    entries.delete(key); // re-insert so Map order tracks load recency
    entries.set(key, entry);
    if (entries.size > maxKeys) entries.delete(entries.keys().next().value);

    entry.promise.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry.promise;
  }

  return {
    get,
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}
