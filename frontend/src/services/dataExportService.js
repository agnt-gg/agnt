import { API_CONFIG } from '@/tt.config.js';

/**
 * Client for Settings → Backup & Export.
 *
 * The export can be many gigabytes, so it is NEVER fetched into memory here.
 * An authenticated POST mints a single-use download ticket; the browser then
 * navigates to the ticket URL and its native download manager streams the
 * file to disk (Electron shows its own Save dialog).
 */

function authHeaders(extra = {}) {
  const token = localStorage.getItem('token');
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.error || `Request failed (HTTP ${response.status})`);
  }
  return body;
}

/** Categories with row counts for the given (optional) date range. */
export async function fetchExportCategories({ since, until } = {}) {
  const query = new URLSearchParams();
  if (since) query.set('since', since);
  if (until) query.set('until', until);
  const qs = query.toString();
  const response = await fetch(`${API_CONFIG.BASE_URL}/memory/export/categories${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  return (await readJson(response)).categories;
}

/** Mint a download ticket for the selection. Resolves with the server's reply. */
export async function requestExport({ categories, since, until, compress }) {
  const response = await fetch(`${API_CONFIG.BASE_URL}/memory/export`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ categories, since: since || null, until: until || null, compress: !!compress }),
  });
  return readJson(response);
}

export function downloadUrlFor(ticket) {
  return `${API_CONFIG.BASE_URL}/memory/export/download/${encodeURIComponent(ticket)}`;
}

/** Hand the ticket URL to the browser's download manager. */
export function startDownload(ticket, filename) {
  const link = document.createElement('a');
  link.href = downloadUrlFor(ticket);
  if (filename) link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default { fetchExportCategories, requestExport, downloadUrlFor, startDownload };
