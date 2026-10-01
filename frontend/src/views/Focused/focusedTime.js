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
