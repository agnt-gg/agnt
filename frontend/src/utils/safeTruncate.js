/**
 * safeTruncate — grapheme-aware string truncation (frontend mirror of
 * backend/src/utils/safeTruncate.js).
 *
 * Naive `str.slice(0, n)` / `str.substring(0, n)` cut on UTF-16 code-unit
 * boundaries and can split a multi-unit emoji (🫠 U+1FAE0, 😅, ✨, flags,
 * skin-tone modifiers, 👨‍👩‍👧 ZWJ sequences) in half → renders as � .
 *
 * `Intl.Segmenter(..., { granularity: 'grapheme' })` treats each
 * user-perceived character (including full ZWJ combos) as ONE unit, so we
 * never cut mid-glyph. For pure-ASCII input the output is byte-identical to
 * the old slice — safe drop-in.
 */

let _seg = null;
function segmenter() {
  if (_seg) return _seg;
  try {
    _seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  } catch (_) {
    _seg = null;
  }
  return _seg;
}

/**
 * Truncate to at most `max` user-perceived characters, appending `ellipsis`
 * only when truncation occurred.
 *
 * @param {*} str
 * @param {number} max
 * @param {string} ellipsis  default '…'
 * @returns {string}
 */
export function safeTruncate(str, max, ellipsis = '…') {
  if (str == null) return '';
  const s = typeof str === 'string' ? str : String(str);
  if (!Number.isFinite(max) || max < 0) return s;
  if (s.length <= max) return s;

  const seg = segmenter();
  if (seg) {
    let out = '';
    let count = 0;
    for (const { segment } of seg.segment(s)) {
      if (count >= max) return out + ellipsis;
      out += segment;
      count++;
    }
    return out;
  }

  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max).join('') + ellipsis;
}

export function graphemeLength(str) {
  if (str == null) return 0;
  const s = typeof str === 'string' ? str : String(str);
  const seg = segmenter();
  if (seg) {
    let n = 0;
    for (const _ of seg.segment(s)) n++;
    return n;
  }
  return [...s].length;
}

export default safeTruncate;
