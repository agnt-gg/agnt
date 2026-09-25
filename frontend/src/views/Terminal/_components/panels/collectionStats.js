/**
 * Derivations for CollectionStatsPanel. Pure, so every collection screen's
 * left panel computes its numbers the same way.
 */

/** "3m", "5h", "2d", "Mar 4" — compact enough for a panel row. Empty when unknown. */
export function ageLabel(value, now = Date.now()) {
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, (now - time) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The most recently touched items, newest first. Items with no usable date are
 * left out rather than sorted to an arbitrary end.
 */
export function recentItems(items, { date, label, icon, limit = 5, now = Date.now() }) {
  return (items || [])
    .map((item) => ({ item, time: new Date(date(item) || NaN).getTime() }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map(({ item, time }) => ({ id: item.id, label: label(item), meta: ageLabel(time, now), icon: icon?.(item) }));
}

/** Status values arrive as ACTIVE, active, Active… */
export const statusIs = (item, ...wanted) => wanted.includes(String(item?.status || '').toLowerCase());
