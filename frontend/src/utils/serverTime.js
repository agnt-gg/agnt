/**
 * Parsing server timestamps.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ------------------------------
 * Every `updated_at` / `created_at` in this database is written by SQLite's
 * `CURRENT_TIMESTAMP`, which produces a string like:
 *
 *     "2026-07-27 01:56:50"
 *
 * That value is **UTC**, but it carries no timezone marker. ECMAScript only
 * treats the *date-only* form (`"2026-07-27"`) as UTC; a date-*time* form with
 * no offset is parsed as **local time**. So `new Date("2026-07-27 01:56:50")`
 * on a machine in UTC-4 yields an instant four hours in the FUTURE.
 *
 * Measured on this machine (EDT, UTC-4) against the live database:
 *
 *     stored     "2026-07-27 01:56:50"   (UTC)
 *     new Date   Mon Jul 27 2026 01:56:50 GMT-0400
 *     vs now     +3.97 hours   <-- every row appears to be from the future
 *
 * Consequences, all real:
 *   - Any comparison of a server timestamp against `Date.now()` is wrong by the
 *     UTC offset. West of Greenwich the server value always wins, so "is this
 *     newer than now?" is permanently true and "how old is this?" is negative.
 *   - Displayed dates are shifted, which flips the calendar day near midnight.
 *
 * Comparisons of two *server* values are unaffected — both are skewed by the
 * same constant — which is why this stayed invisible until the sidebar started
 * comparing a server timestamp against a client-side one.
 *
 * THE RULE
 * --------
 * Convert at the boundary. Anything entering the app from the API goes through
 * `parseServerTime` / `toServerDate` once, and from then on it is a correct
 * instant. Never call `new Date(row.updated_at)` directly.
 */

/**
 * A date-time with no timezone marker: "YYYY-MM-DD HH:MM[:SS[.sss]]", with
 * either a space or a T separator.
 *
 * Deliberately does NOT match:
 *   - values already carrying `Z` or a `±HH:MM` offset — those are unambiguous
 *   - the date-only form `"YYYY-MM-DD"` — the spec already reads that as UTC
 */
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Parse a server timestamp into epoch milliseconds.
 *
 * Returns 0 — never NaN — for anything unparseable. NaN would make every
 * comparison against the value false, which silently destabilises sorts
 * instead of failing visibly.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number} epoch ms, or 0
 */
export function parseServerTime(value) {
  if (value === null || value === undefined) return 0;

  // Already an instant.
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== 'string') return 0;

  const raw = value.trim();
  if (!raw) return 0;

  // Naive = UTC. Normalise to a form the spec parses unambiguously.
  const normalized = NAIVE_DATETIME.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;

  const t = Date.parse(normalized);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Parse a server timestamp into a Date, for display and for storing in state.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {Date|null} null when absent or unparseable
 */
export function toServerDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = parseServerTime(value);
  return t === 0 ? null : new Date(t);
}

/**
 * Age of a server timestamp in milliseconds, measured against the client clock.
 *
 * Clamped at 0: a timestamp cannot legitimately be in the future, so a negative
 * age means clock skew between the machine and the database rather than a
 * genuinely future event. Callers bucketing by age (freshness badges, "stale"
 * highlighting) would otherwise fall through every threshold and silently
 * report the newest state.
 *
 * @param {string|number|Date|null|undefined} value
 * @param {number} [now] injectable for tests
 * @returns {number} milliseconds, >= 0. Returns 0 for unparseable input.
 */
export function serverAge(value, now = Date.now()) {
  const t = parseServerTime(value);
  if (t === 0) return 0;
  return Math.max(0, now - t);
}
