/**
 * Minimal in-process fixed-window rate limiter.
 *
 * Deliberately dependency-free: AGNT is a single-process local server, so the
 * distributed-store machinery of express-rate-limit buys nothing, and a
 * transitively-resolved package that is not a declared dependency is a
 * liability (it can vanish on any unrelated `npm prune`).
 *
 * Semantics: fixed window per (key, route-bucket). On overflow, respond 429
 * with Retry-After. Counters are swept lazily plus on an interval so the map
 * cannot grow without bound from a scan of distinct source addresses.
 */

const buckets = new Map(); // key -> { count, resetAt }

// Lazy sweep is not enough on its own: a scanner that never repeats a key
// leaves an entry per key until that key is touched again. Sweep periodically.
const SWEEP_INTERVAL_MS = 60_000;
let sweepTimer = null;

function startSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }, SWEEP_INTERVAL_MS);
  // Never hold the event loop open for a rate limiter.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

/** Test seam: drop all counters and stop the sweeper. */
export function _resetRateLimits() {
  buckets.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Derive a client key. Uses the socket address; behind a trusted proxy the
 * left-most X-Forwarded-For entry is used instead.
 * @param {import('express').Request} req
 */
export function clientKey(req) {
  const trustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_REMOTE_AUTH === 'true';
  if (trustProxy) {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Build a rate-limit middleware.
 *
 * @param {object} opts
 * @param {string} opts.name        - Bucket namespace (keeps routes independent).
 * @param {number} opts.limit       - Max requests per window.
 * @param {number} opts.windowMs    - Window length in ms.
 * @param {(req: any) => string} [opts.keyFn] - Override client key derivation.
 * @returns {import('express').RequestHandler}
 */
export function rateLimit({ name, limit, windowMs, keyFn = clientKey }) {
  if (!name || !Number.isFinite(limit) || !Number.isFinite(windowMs)) {
    throw new Error('rateLimit requires { name, limit, windowMs }');
  }
  startSweeper();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = `${name}:${keyFn(req)}`;
    let entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, limit - entry.count);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        retryAfterSeconds: retryAfter,
      });
    }

    return next();
  };
}

export default rateLimit;
