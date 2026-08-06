/**
 * Shared helpers for converting filesystem absolute paths and `file://` URLs
 * into `/api/local-file/...` URLs that work inside iframes and srcdoc HTML.
 *
 * Used by:
 *  - Chat MessageItem.vue (rewrites assistant-generated HTML for inline render)
 *  - Canvas CustomWidgetRenderer.vue (rewrites widget source_code before srcdoc)
 *
 * The backend `/api/local-file/<abs-path>` route streams arbitrary files with
 * proper Content-Type + HTTP Range support (so <video> seeking works). It is
 * intentionally unscoped (unlike `/api/filesystem/raw` which is workspace-only)
 * so plugin outputs at `%APPDATA%/AGNT/plugin-data/...` etc. can be referenced
 * from LLM-generated HTML without hitting a 403 auth wall.
 */

import { API_CONFIG } from '@/tt.config.js';

/**
 * Attribute that carries the ORIGINAL absolute filesystem path on an anchor
 * whose href was left as `file://` (see `interceptsLinkClicks` below). The
 * click handler reads this instead of re-parsing the href, so the path the
 * user activates is exactly the path the author wrote.
 */
export const LOCAL_PATH_ATTR = 'data-local-path';

/**
 * Build a /api/local-file URL from a filesystem absolute path.
 * @param {string} absPath - Absolute filesystem path (Windows or POSIX).
 * @param {string} [cacheBust] - Optional cache-bust token (e.g., a message id).
 * @returns {string}
 */
export function buildLocalFileUrl(absPath, cacheBust) {
  const normalized = String(absPath || '').replace(/\\/g, '/');
  const qs = cacheBust ? `?_=${encodeURIComponent(cacheBust)}` : '';
  return `${API_CONFIG.BASE_URL}/local-file/${encodeURI(normalized)}${qs}`;
}

/**
 * Extract the absolute filesystem path from a `file://` URL.
 *
 * The leading slash is dropped, which is the convention the whole local-file
 * pipeline shares: `file:///C:/x` -> `C:/x`, `file:///home/x` -> `home/x`.
 * LocalFileRoutes.js re-adds it for POSIX paths (it must — URL concatenation
 * removed it), so both ends agree. Callers that need a real POSIX path back
 * must re-add it the same way.
 *
 * @param {string} val
 * @returns {string} '' when `val` is not a file:// URL.
 */
export function fileUrlToPath(val) {
  const s = String(val || '');
  if (!/^file:\/\//i.test(s)) return '';
  const rawPath = s.replace(/^file:\/\//i, '').replace(/^\//, '');
  try {
    return decodeURI(rawPath);
  } catch {
    return rawPath;
  }
}

/**
 * The real, openable absolute filesystem path behind a `file://` URL.
 *
 * `fileUrlToPath` returns the URL-shaped path (POSIX root stripped) because
 * that is what `/api/local-file/` consumes. Anything that hands the path to
 * the OS — shell.openPath, a file dialog — needs the root back, or macOS and
 * Linux get a relative path that resolves against the process cwd.
 *
 * `file://server/share/x` (a UNC path, no third slash) keeps its host: the
 * result is `//server/share/x`, which the main process converts to backslashes.
 *
 * @param {string} val
 * @returns {string} '' when `val` is not a file:// URL.
 */
export function absolutePathFromFileUrl(val) {
  const s = String(val || '');
  if (!/^file:\/\//i.test(s)) return '';
  const isUnc = !/^file:\/\/\//i.test(s);
  const p = fileUrlToPath(s);
  if (!p) return '';
  if (isUnc) return `//${p}`;
  return /^[a-zA-Z]:/.test(p) ? p : `/${p}`;
}

/**
 * Convert a `file://...` URL to a `/api/local-file/...` URL.
 * Chromium blocks file:// frames from http://localhost origins, so any
 * src/href/poster pointing at file:// must be rewritten before render.
 * @param {string} val
 * @returns {string}
 */
export function fileUrlToLocalFileUrl(val) {
  const rawPath = String(val || '').replace(/^file:\/\//i, '').replace(/^\//, '');
  let normalized;
  try {
    normalized = decodeURI(rawPath);
  } catch {
    normalized = rawPath;
  }
  return `${API_CONFIG.BASE_URL}/local-file/${encodeURI(normalized)}`;
}

/**
 * Walk an HTML string and rewrite every `file://...` URL on src/href/poster
 * attributes to a `/api/local-file/...` URL. Optionally injects a `<base>`
 * element so sibling relative paths inside the HTML (e.g. `../videos/x.mp4`)
 * resolve against the same /api/local-file directory instead of about:srcdoc.
 *
 * Returns the original HTML untouched when there is nothing to rewrite, so
 * callers can pass any HTML through this without overhead in the common case.
 *
 * @param {string} html
 * SUBRESOURCES vs NAVIGATION
 * ──────────────────────────
 * `src`, `poster` and `<link href>` are SUBRESOURCES: the browser fetches them
 * from within this document, so the media cookie applies and rewriting is the
 * only thing that works (an <img> cannot carry an Authorization header).
 *
 * `<a href>` is NAVIGATION. Rewriting it produces a link that leaves this
 * origin — in the desktop app every anchor is target=_blank, which Electron
 * hands to shell.openExternal, which opens the user's real browser. That
 * browser holds no AGNT cookie, so the rewritten URL 401s: the user clicks a
 * link to their own file and gets "Authentication required". Hosts that
 * intercept clicks themselves pass `interceptsLinkClicks` and get the true
 * `file://` href left intact, plus `data-local-path` for the handler to read.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseDir] - Explicit base directory for `<base href>` injection.
 *   Takes priority over the auto-detected first `file://` directory.
 * @param {boolean} [opts.interceptsLinkClicks=false] - Set by hosts that install
 *   a click handler on the rendered output (see utils/openLocalFile.js). Leave
 *   false for srcdoc/iframe content, where no handler of ours can ever run and
 *   the rewritten URL is the only thing that can load.
 * @returns {string}
 */
export function rewriteLocalFileURLsInHTML(html, { baseDir, interceptsLinkClicks = false } = {}) {
  const hasFileURL = /file:\/\//i.test(html || '');
  if (!html || (!hasFileURL && !baseDir)) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    let firstFileDir = '';
    const tryCaptureDir = (val) => {
      if (firstFileDir) return;
      const m = /^file:\/\/(\/?[^?#]*)/i.exec(val);
      if (!m) return;
      let p = m[1].replace(/^\//, '');
      try {
        p = decodeURI(p);
      } catch {
        /* keep encoded */
      }
      const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (slash > 0) firstFileDir = p.slice(0, slash);
    };

    const rewriteAttr = (el, attr) => {
      const val = el.getAttribute(attr);
      if (val && /^file:\/\//i.test(val)) {
        tryCaptureDir(val);
        el.setAttribute(attr, fileUrlToLocalFileUrl(val));
      }
    };

    for (const attr of ['src', 'href', 'poster']) {
      doc.querySelectorAll(`[${attr}]`).forEach((el) => {
        if (interceptsLinkClicks && attr === 'href' && el.tagName === 'A') {
          const val = el.getAttribute('href');
          if (val && /^file:\/\//i.test(val)) {
            // Still contributes to base-dir detection — a message whose only
            // absolute path is a link should still resolve sibling assets.
            tryCaptureDir(val);
            el.setAttribute(LOCAL_PATH_ATTR, absolutePathFromFileUrl(val));
          }
          return;
        }
        rewriteAttr(el, attr);
      });
    }

    // Pick base dir: explicit override (from a tool call's known output dir)
    // takes priority, then the first absolute file:// we saw.
    const chosenDir = baseDir || firstFileDir;
    if (chosenDir && !doc.querySelector('base[href]')) {
      const normalized = chosenDir.replace(/\\/g, '/').replace(/\/+$/, '');
      const base = doc.createElement('base');
      base.setAttribute('href', `${API_CONFIG.BASE_URL}/local-file/${encodeURI(normalized)}/`);
      const head = doc.head || doc.documentElement;
      head.insertBefore(base, head.firstChild);
    }

    if (/<html[^>]*>/i.test(html)) {
      const doctype = /<!DOCTYPE[^>]*>/i.test(html) ? '<!DOCTYPE html>\n' : '';
      return doctype + doc.documentElement.outerHTML;
    }
    // Fragment: merge any injected <base> back into the body output.
    const headHTML = doc.head ? doc.head.innerHTML : '';
    return headHTML + (doc.body ? doc.body.innerHTML : '');
  } catch (e) {
    console.warn('[localFileUrl] Failed to rewrite file:// URLs:', e);
    return html;
  }
}
