/**
 * Log levels — shared by every process.
 *
 * Numeric so comparisons are cheap on the hot path, and so a future remote
 * sink can filter without a lookup table.
 */
export const LEVELS = Object.freeze({
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
});

export const LEVEL_NAMES = Object.freeze(Object.keys(LEVELS));

/** Coerce a level name (any case) to its numeric value. Unknown -> fallback. */
export function levelValue(name, fallback = LEVELS.INFO) {
  if (typeof name === 'number') return name;
  if (typeof name !== 'string') return fallback;
  const v = LEVELS[name.toUpperCase()];
  return v === undefined ? fallback : v;
}

/** Normalize a level name to canonical upper-case. Unknown -> fallback name. */
export function levelName(name, fallback = 'INFO') {
  if (typeof name !== 'string') return fallback;
  const up = name.toUpperCase();
  return LEVELS[up] === undefined ? fallback : up;
}
