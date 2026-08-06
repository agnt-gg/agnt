/**
 * Recovering an absolute filesystem path from a URL that points at a LOCAL file.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every link in the app is target=_blank, and main.js hands target=_blank to
 * shell.openExternal — the user's real browser. That browser holds no AGNT
 * session, so a `http://localhost:3333/api/local-file/<path>` URL, which is
 * exactly what the renderer builds for local media, comes back as
 * `{"error":"Authentication required"}`. The user clicks a link to a file on
 * their own disk and is told they are not logged in.
 *
 * The renderer no longer produces those URLs for anchors, but this is the
 * layer that makes the guarantee hold: ANY surface that emits one — an iframe'd
 * artifact, a widget, a plugin, an LLM that pasted the URL by hand, a code path
 * written next year — is caught here and opened from the real path instead.
 * A fix that lives only in the producer has to be re-made in every new producer.
 *
 * SCOPE
 * ─────
 * Loopback origins only, and only on the port this app's own backend uses. In
 * remote mode `/api/local-file/` names a file on the SERVER's disk, which this
 * machine must not try to open; that URL is not loopback, so it is not claimed.
 */

/** Mount point of the streaming route, as served by backend/server.js. */
export const LOCAL_FILE_ROUTE = '/api/local-file/';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {number|string} [opts.port=3333] - The local backend's port.
 * @param {string} [opts.platform=process.platform]
 * @returns {string|null} An absolute path, or null when the URL is not a local
 *   file reference (in which case the caller must handle it as it always did).
 */
export function localFilePathFromUrl(rawUrl, opts = {}) {
  const { port = 3333, platform = process.platform } = opts;
  if (typeof rawUrl !== 'string' || !rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  let rest;
  if (url.protocol === 'file:' || url.protocol === 'agnt-file:') {
    // file://server/share/x is a UNC path: the host is part of the path.
    rest = url.hostname ? `//${url.hostname}${url.pathname}` : url.pathname;
  } else if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
    const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (String(effectivePort) !== String(port)) return null;
    if (!url.pathname.startsWith(LOCAL_FILE_ROUTE)) return null;
    rest = url.pathname.slice(LOCAL_FILE_ROUTE.length);
  } else {
    return null;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = rest;
  }

  // Normalise to a real absolute path. URL concatenation drops the POSIX root
  // (LocalFileRoutes.js re-adds it the same way), and a Windows drive letter
  // must not keep the slash a URL pathname always carries.
  if (!decoded.startsWith('//')) decoded = `/${decoded.replace(/^\/+/, '')}`;
  decoded = decoded.replace(/^\/([a-zA-Z]:)/, '$1');

  if (!decoded || decoded === '/' || decoded.includes('\0')) return null;

  return platform === 'win32' ? decoded.replace(/\//g, '\\') : decoded;
}
