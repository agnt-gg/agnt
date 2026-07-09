/**
 * safeTruncate — grapheme-aware string truncation.
 *
 * The naive `str.slice(0, n)` / `str.substring(0, n)` operate on UTF-16 code
 * units. Emoji outside the Basic Multilingual Plane (🫠 U+1FAE0, 😅, ✨, flags,
 * skin-tone modifiers, 👨‍👩‍👧 ZWJ sequences) are 2+ code units. Cutting on a
 * code-unit boundary can split a surrogate pair or a ZWJ cluster in half,
 * leaving a lone half that renders as the replacement char (�) — permanently,
 * once it's persisted in a title/snippet.
 *
 * `Intl.Segmenter(..., { granularity: 'grapheme' })` (native in Node 18+, no
 * deps) treats each user-perceived character — including full emoji ZWJ
 * combos — as ONE unit, so we never cut mid-glyph.
 *
 * For pure-ASCII input this returns byte-identical output to the old slice,
 * so it's a safe drop-in for the existing truncate() helpers.
 */

let _seg = null;
function segmenter() {
  if (_seg) return _seg;
  try {
    _seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  } catch (_) {
    _seg = null; // Intl.Segmenter unavailable — caller falls back to spread
  }
  return _seg;
}

/**
 * Truncate `str` to at most `max` user-perceived characters, appending
 * `ellipsis` only when truncation actually occurred.
 *
 * @param {*} str        Input (non-strings are String()-coerced; null/undefined → '').
 * @param {number} max   Max grapheme count to keep. Non-positive → '' (+ellipsis if input non-empty).
 * @param {string} ellipsis  Suffix appended when truncated. Default '…'.
 * @returns {string}
 */
export function safeTruncate(str, max, ellipsis = '…') {
  if (str == null) return '';
  const s = typeof str === 'string' ? str : String(str);
  if (!Number.isFinite(max) || max < 0) return s; // guard: bad max → passthrough
  // Fast path: if UTF-16 length already fits, no glyph can be split.
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
    return out; // fewer graphemes than max (multi-unit chars) → no ellipsis needed
  }

  // Fallback: codepoint-aware spread (handles surrogate pairs, not ZWJ combos).
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max).join('') + ellipsis;
}

/** Count user-perceived characters (graphemes) in a string. */
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
