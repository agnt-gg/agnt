/** Pure helpers for the Files grid. */
import { artifactKind } from '@/utils/chatArtifacts.js';

export const KIND_ICONS = {
  directory: 'fas fa-folder',
  html: 'fas fa-globe',
  markdown: 'fas fa-file-alt',
  csv: 'fas fa-table',
  image: 'fas fa-image',
  video: 'fas fa-film',
  audio: 'fas fa-music',
  pdf: 'fas fa-file-pdf',
  archive: 'fas fa-file-archive',
  file: 'fas fa-file',
  text: 'fas fa-file-code',
};

/** What the list view's Kind column says for each kind. */
export const KIND_LABELS = {
  directory: 'Folder',
  html: 'Web page',
  markdown: 'Document',
  csv: 'Spreadsheet',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  archive: 'Archive',
  file: 'File',
  text: 'Code / text',
};

export const kindOf = (item) => (item.type === 'directory' ? 'directory' : artifactKind(item.name));

export const kindLabel = (item) => KIND_LABELS[kindOf(item)] || 'File';

/** The folder part of a workspace-relative path ('' at the root). */
export const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// The grid/list choice, remembered across visits. Anything unexpected in
// storage (an old value, a hand edit) falls back to the grid.
export const LAYOUTS = ['grid', 'list'];
const LAYOUT_KEY = 'agnt.files.layout';
export function readLayout(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(LAYOUT_KEY);
    return LAYOUTS.includes(saved) ? saved : 'grid';
  } catch {
    return 'grid';
  }
}
export function writeLayout(layout, storage = globalThis.localStorage) {
  if (!LAYOUTS.includes(layout)) return;
  try {
    storage?.setItem(LAYOUT_KEY, layout);
  } catch {
    /* storage full or blocked: the choice simply is not remembered */
  }
}

/** Folders first; within each, newest first (`recent`) or A–Z (`name`). Returns a copy. */
export function sortItems(items, order = 'recent') {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    if (order === 'recent') return (b.modifiedAt || 0) - (a.modifiedAt || 0) || byName(a, b);
    return byName(a, b);
  });
}

/** 'a/b/c' → [{ name: 'Workspace', path: '' }, { name: 'a', path: 'a' }, …] */
export function breadcrumbs(dir) {
  const crumbs = [{ name: 'Workspace', path: '' }];
  let path = '';
  for (const part of String(dir || '').split('/').filter(Boolean)) {
    path = path ? `${path}/${part}` : part;
    crumbs.push({ name: part, path });
  }
  return crumbs;
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatAge(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const seconds = Math.max(0, (now - ms) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Why `name` cannot be created in a folder, or '' when it can. */
export function invalidName(name, existing = []) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Enter a name.';
  if (/[\\/:*?"<>|]/.test(trimmed)) return 'Names cannot contain \\ / : * ? " < > |';
  if (trimmed === '.' || trimmed === '..') return 'That name is reserved.';
  if (existing.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return `${trimmed} already exists here.`;
  return '';
}

export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);
