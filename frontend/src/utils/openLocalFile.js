/**
 * Opening a LOCAL FILE the user clicked in rendered content.
 *
 * THE BUG THIS EXISTS FOR
 * ───────────────────────
 * A link to a file on disk used to be rewritten to
 * `http://localhost:3333/api/local-file/<path>` exactly like an <img> src.
 * That is right for a subresource and wrong for a link: every anchor in a
 * message is target=_blank, Electron hands target=_blank to
 * shell.openExternal, and the user's real browser has no AGNT media cookie —
 * so clicking a link to your own HTML file returned
 * `{"error":"Authentication required"}` instead of the page.
 *
 * A local file must be opened BY THE OS, from its real path. Then the default
 * browser gets a genuine `file://` URL, with no auth in the picture at all.
 *
 * TWO ENVIRONMENTS, ONE RULE
 * ──────────────────────────
 * Desktop (Electron)  → window.electron.openPath(absPath). The OS opens it.
 * Web / Docker        → no bridge and no access to the user's disk anyway, so
 *                       fall back to the API URL in a new tab. That one WORKS
 *                       there: it is same-origin, so the media cookie rides
 *                       along and the file streams from the server that has it.
 */

import { buildLocalFileUrl, LOCAL_PATH_ATTR, absolutePathFromFileUrl } from './localFileUrl.js';

/**
 * The absolute path an anchor points at, or '' if it does not point at a file.
 * Prefers the attribute stamped by rewriteLocalFileURLsInHTML; falls back to
 * parsing a raw file:// href so anchors from any other source still work.
 * @param {Element|null} anchor
 * @returns {string}
 */
export function localPathFromAnchor(anchor) {
  if (!anchor || typeof anchor.getAttribute !== 'function') return '';
  const stamped = anchor.getAttribute(LOCAL_PATH_ATTR);
  if (stamped) return stamped;
  return absolutePathFromFileUrl(anchor.getAttribute('href'));
}

/**
 * Hand an absolute filesystem path to the OS (desktop) or open the streaming
 * URL (web). Returns false only when there is nothing openable.
 * @param {string} absPath
 * @returns {boolean}
 */
export function openLocalPath(absPath) {
  const p = String(absPath || '').trim();
  if (!p) return false;
  if (typeof window !== 'undefined' && window.electron && typeof window.electron.openPath === 'function') {
    window.electron.openPath(p);
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(buildLocalFileUrl(p), '_blank', 'noopener');
    return true;
  }
  return false;
}

/**
 * Delegated click handler. Install on any container holding rendered content;
 * it claims only clicks on anchors that resolve to a local file and leaves
 * every other click completely alone.
 *
 * Modified clicks (ctrl/cmd/shift/alt, middle button) are deliberately NOT
 * claimed — those mean "open however the browser normally would", and the
 * main-process net in electron/localFileLink.js catches the result.
 *
 * @param {MouseEvent} event
 * @returns {boolean} true when the click was handled here.
 */
export function handleLocalFileLinkClick(event) {
  if (!event || event.defaultPrevented) return false;
  if (typeof event.button === 'number' && event.button !== 0) return false;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;

  const target = event.target;
  const anchor = target && typeof target.closest === 'function' ? target.closest('a') : null;
  const absPath = localPathFromAnchor(anchor);
  if (!absPath) return false;

  event.preventDefault();
  return openLocalPath(absPath);
}
