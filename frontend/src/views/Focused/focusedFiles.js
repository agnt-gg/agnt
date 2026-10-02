/** Files in Focused: pure helpers for paths, kinds and sizes. */

const KIND_BY_EXT = {
  html: 'html', htm: 'html',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', bmp: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio', ogg: 'audio',
};
const ICON_BY_KIND = {
  html: 'fas fa-file-code',
  pdf: 'fas fa-file-pdf',
  image: 'fas fa-image',
  video: 'fas fa-film',
  audio: 'fas fa-music',
  text: 'fas fa-file-alt',
};

export function extOf(path) {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** html | pdf | image | video | audio | text. Anything unknown is tried as text. */
export function fileKind(path) {
  return KIND_BY_EXT[extOf(path)] || 'text';
}

export function iconFor(path) {
  return ICON_BY_KIND[fileKind(path)] || 'fas fa-file';
}

export function baseName(path) {
  const parts = String(path || '').split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

/** 'a/b/c.md' → 'a/b'; a top-level file → ''. */
export function parentDir(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
}

/** 'a/b' → [{ name: 'a', path: 'a' }, { name: 'b', path: 'a/b' }]. */
export function crumbsOf(dir) {
  const parts = String(dir || '').split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

/** The orders a folder can be listed in: [value, label]. */
export const FILE_SORTS = Object.freeze([
  ['name', 'Name'],
  ['date', 'Date'],
]);

const timeOf = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(v || '');
  return Number.isFinite(t) ? t : 0;
};
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });

/**
 * A folder's entries in order: folders first, then by name (A→Z, numbers in
 * number order) or by date (newest first; undated last; name breaks ties).
 * Returns a new array — the listing it was given is left alone.
 */
export function sortFileItems(items, by = 'name') {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const dirFirst = (a, b) => Number(b.type === 'directory') - Number(a.type === 'directory');
  const order = by === 'date' ? (a, b) => timeOf(b.modifiedAt) - timeOf(a.modifiedAt) || byName(a, b) : byName;
  return [...list].sort((a, b) => dirFirst(a, b) || order(a, b));
}

export function fmtSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
