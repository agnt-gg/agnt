/** Times as the Focused pages say them, and waiting for store data. */

/**
 * Resolve once `test()` is true, polling every 100 ms, or after `timeoutMs`
 * (resolving false). For store fetches that return early because another
 * caller's identical fetch is already in flight: the data lands later, and
 * the caller has nothing to await. Bounded, so it can never hang a page.
 */
export function waitUntil(test, timeoutMs = 10000, intervalMs = 100) {
  return new Promise((resolve) => {
    if (test()) return resolve(true);
    const started = Date.now();
    const timer = setInterval(() => {
      if (test()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, intervalMs);
  });
}

/** Today: "9:30 AM". Another day: "Mon, Oct 5". */
export function formatNext(ms, now = new Date()) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A run's time: "Sun, 9:00" within the coming week, a date further out (formatNext). */
export function formatNextRun(ms, now = Date.now()) {
  const d = new Date(ms);
  if (!ms || Number.isNaN(d.getTime()) || d.getTime() - now > 6 * 86400e3) return formatNext(ms);
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** When a run happened: "Sat, Nov 21, 9:00". */
export function formatRunTime(ms) {
  const d = new Date(ms);
  if (!ms || Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** How long a run took: "45s", "2m 14s", "1h 3m". */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || ms === '') return '';
  const s = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** The machine's zone, for a routine nobody has set one on. */
export const LOCAL_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

/** Zones to choose from: the platform's list, with the current one always present. */
export function timezoneOptions(current) {
  let zones = [];
  try {
    zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  const list = zones.length ? [...zones] : [LOCAL_TZ, 'UTC'];
  for (const z of [current, LOCAL_TZ]) if (z && !list.includes(z)) list.unshift(z);
  return list;
}
