/**
 * How the Library orders and describes your things (agents, workflows, tools,
 * skills, widgets). Rows come from libraryRows (focusedModel.js).
 */
import { ago } from './focusedEditors.js';

/** Every order the Library knows: [value, label]. */
export const LIBRARY_SORTS = Object.freeze([
  ['name', 'Name'],
  ['recent', 'Recently changed'],
  ['newest', 'Newest'],
  ['used', 'Most used'],
]);

const SORT_FIELD = Object.freeze({ recent: 'updatedAt', newest: 'createdAt', used: 'used' });
const byName = (a, b) => String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true, sensitivity: 'base' });

/** The orders these rows can actually be put in: Name always, the others only when some row has the value. */
export function librarySortsFor(rows = []) {
  return LIBRARY_SORTS.filter(([value]) => value === 'name' || rows.some((r) => r[SORT_FIELD[value]] > 0));
}

/** Rows in an order (a new array). Newest, most changed or most used first; rows without the value last; name breaks ties. */
export function sortLibraryRows(rows = [], by = 'name') {
  const field = SORT_FIELD[by];
  const list = [...rows];
  if (!field) return list.sort(byName);
  return list.sort((a, b) => (b[field] || 0) - (a[field] || 0) || byName(a, b));
}

/** One quiet line under a card: what it uses, and when it last changed or ran. */
export function libraryMeta(row = {}, now = Date.now()) {
  const parts = [];
  if (row.toolCount) parts.push(`${row.toolCount} ${row.toolCount === 1 ? 'tool' : 'tools'}`);
  if (row.usedAt) parts.push(`Used ${ago(row.usedAt, now)}`);
  else if (row.updatedAt) parts.push(`Changed ${ago(row.updatedAt, now)}`);
  return parts.join(' · ');
}

const SORT_KEY = 'agnt:library-sort';
/** The order last picked (kept across visits), when these rows support it. */
export function readLibrarySort(rows = []) {
  let saved = 'name';
  try {
    saved = localStorage.getItem(SORT_KEY) || 'name';
  } catch {
    /* storage disabled: Name */
  }
  return librarySortsFor(rows).some(([value]) => value === saved) ? saved : 'name';
}
export function saveLibrarySort(value) {
  try {
    localStorage.setItem(SORT_KEY, value);
  } catch {
    /* storage disabled: the order still holds while the page is open */
  }
}
