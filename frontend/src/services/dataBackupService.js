import { API_CONFIG } from '@/tt.config.js';

/**
 * Client for Settings → Backup & Restore and Settings → Reset.
 *
 * A backup can be many gigabytes, so the file is handed to the browser's own
 * upload (it streams from disk) and never read into memory here. XHR rather
 * than fetch: it is the only way to report upload progress.
 */
const BASE = () => `${API_CONFIG.BASE_URL}/data`;
const authHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(BASE() + path, {
    method,
    headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.error || `Request failed (HTTP ${response.status})`);
  return result;
}

/** Upload a backup file. Resolves with { id, summary }. `onProgress(fraction)` while sending. */
export function uploadBackup(file, { onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE()}/restore`);
    for (const [key, value] of Object.entries(authHeader())) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      let result = {};
      try { result = JSON.parse(xhr.responseText || '{}'); } catch { /* reported below */ }
      if (xhr.status >= 200 && xhr.status < 300 && result.success !== false) resolve(result);
      else reject(new Error(result.error || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('The upload could not reach AGNT. Check that it is still running and try again.'));
    xhr.send(file);
  });
}

export const startRestore = (id, categories) => request(`/restore/${encodeURIComponent(id)}/start`, { method: 'POST', body: { categories } });
export const restoreStatus = (id) => request(`/restore/${encodeURIComponent(id)}`);
export const discardRestore = (id) => request(`/restore/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const resetSummary = () => request('/reset').then((result) => result.groups);
export const runReset = (groups, confirm) => request('/reset', { method: 'POST', body: { groups, confirm } });

/**
 * Browser-side preferences (theme, navigation, sounds, tours, dismissed hints) live in
 * localStorage. Resetting preferences clears it, keeping only what keeps you signed in.
 */
export const KEEP_ON_PREFERENCE_RESET = Object.freeze(['token', 'signedLicense', 'hasCompletedOnboarding']);
export function clearLocalPreferences(storage = localStorage) {
  const keep = new Map(KEEP_ON_PREFERENCE_RESET.map((key) => [key, storage.getItem(key)]));
  storage.clear();
  for (const [key, value] of keep) if (value !== null) storage.setItem(key, value);
}

export const numberFormat = new Intl.NumberFormat();
export const itemCount = (n) => (n === null || n === undefined ? '—' : `${numberFormat.format(n)} ${n === 1 ? 'item' : 'items'}`);
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export default { uploadBackup, startRestore, restoreStatus, discardRestore, resetSummary, runReset, clearLocalPreferences };
