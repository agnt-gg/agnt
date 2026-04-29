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
 * @param {object} [opts]
 * @param {string} [opts.baseDir] - Explicit base directory for `<base href>` injection.
 *   Takes priority over the auto-detected first `file://` directory.
 * @returns {string}
 */
export function rewriteLocalFileURLsInHTML(html, { baseDir } = {}) {
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
      doc.querySelectorAll(`[${attr}]`).forEach((el) => rewriteAttr(el, attr));
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
