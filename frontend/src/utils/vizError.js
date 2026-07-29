/**
 * Failure markup shared by every in-chat visualization renderer
 * (chartjs, d3, threejs, mermaid).
 *
 * These renderers execute model-authored content, so the thrown message can
 * contain arbitrary text — including fragments of the offending source. Each
 * renderer previously built its own error box with the message interpolated
 * straight into innerHTML, which is both a duplicated string and an injection
 * point. One escaped helper removes both problems.
 */

/** Escape text for safe interpolation into innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the red failure card for a visualization block.
 *
 * When `source` is supplied it is shown beneath the message: the content the
 * user asked to see is in that text, and discarding it to show only a title
 * throws away the one thing that still had value.
 *
 * @param {string} title   e.g. 'Chart Render Failed'
 * @param {string} message the thrown error message
 * @param {string} [source] the block source, shown verbatim when present
 */
export function vizErrorHtml(title, message, source) {
  const src = String(source ?? '').trim();
  const detail = src
    ? `<pre style="margin:8px 0 0;padding:8px;max-height:180px;overflow:auto;background:rgba(0,0,0,0.25);border-radius:6px;white-space:pre-wrap;word-break:break-word;font-size:12px;opacity:0.85;">${escapeHtml(src)}</pre>`
    : '';
  return `<div style="padding:16px;background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.3);border-radius:8px;color:var(--color-red,#ff4d4d);font-size:13px;">`
    + `<strong>${escapeHtml(title)}</strong><br><span style="opacity:0.8">${escapeHtml(message)}</span>${detail}`
    + `</div>`;
}
