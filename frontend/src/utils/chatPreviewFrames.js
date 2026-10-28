/**
 * One navigation per chat preview iframe.
 *
 * An iframe starts loading the moment it is in the document with a `src`, and
 * loads AGAIN every time it is moved or its `src` changes. Chat markup used to
 * carry a live `src`, so a local preview loaded once on insertion, again when
 * the action wrapper adopted it, and again when diagnostics added their
 * channel. Every one of those requests reached the server, which prepares
 * the whole document for each.
 *
 * So the sanitizer HOLDS a local preview's URL in `data-preview-src` instead
 * of `src`. The iframe is inert (about:blank, no request) until the renderer
 * has put it where it will stay and gives it its one final URL.
 */
import { isLocalPreviewUrl, toLocalPreviewUrl } from './localFileUrl.js';

export const PREVIEW_SRC_ATTR = 'data-preview-src';

/**
 * DOMPurify afterSanitizeAttributes step, for every element. Only this
 * function writes PREVIEW_SRC_ATTR: data-* attributes pass the sanitizer,
 * so an author-written one is dropped rather than trusted.
 */
export function holdPreviewFrameSource(node) {
  if (!node?.getAttribute) return;
  node.removeAttribute(PREVIEW_SRC_ATTR);
  if (node.tagName !== 'IFRAME') return;
  const src = node.getAttribute('src');
  if (!src) return;
  const preview = toLocalPreviewUrl(src);
  if (!isLocalPreviewUrl(preview)) return;
  node.setAttribute(PREVIEW_SRC_ATTR, preview);
  node.removeAttribute('src');
}

/** The held URL, re-validated at the point of use; '' when there is none. */
export function heldPreviewSource(iframe) {
  const held = iframe?.getAttribute?.(PREVIEW_SRC_ATTR) || '';
  return held && isLocalPreviewUrl(held) ? held : '';
}
