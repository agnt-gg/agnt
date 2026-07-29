/**
 * Matching, diagnostics and diff generation for `edit_file`.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * All of it is pure string work with no I/O, which is exactly the part that has
 * to be right. Keeping it out of the tool body means the matching policy can be
 * exhaustively tested against fixtures instead of through the filesystem.
 *
 * WHAT THE MEASUREMENT SAID (2026-07-28, full production history)
 * --------------------------------------------------------------
 * 7.8% of `edit_file` calls did not fully land: 5.6% hard failure, 2.2% partial.
 * Pairing each failed search string against the one that later succeeded on the
 * same path (n=207) and controlling for pairing noise with trigram similarity:
 *
 *   - whitespace / indentation drift ......  0.5%   <- the assumed cause
 *   - near-miss: right block, wrong token .. 47%    <- the actual cause
 *
 * So tolerant matching was never the lever. The lever is TELLING THE CALLER WHAT
 * THE FILE ACTUALLY SAYS when a search misses. 120 of 187 failing executions
 * retried blind, burning 355 further calls, because the entire error payload was
 * the string "Search string not found".
 *
 * Hence the two halves of this module:
 *   findMatches()    — layered, and ALWAYS counts every occurrence, so an
 *                      ambiguous search can be refused instead of silently
 *                      editing the first hit.
 *   findCandidates() — the did-you-mean path: the nearest real text, with line
 *                      numbers, so the retry is informed rather than a guess.
 */

/** Tiers are tried in order; the first with any match wins. */
export const MATCH_TIERS = Object.freeze({
  EXACT: 'exact',
  EOL: 'eol-normalized',
  WHITESPACE: 'whitespace-insensitive',
});

/** Diagnostics are bounded so a failure can never blow up the context window. */
export const MAX_CANDIDATES = 3;
export const MAX_CANDIDATE_CHARS = 1200;
export const MAX_DIFF_CHARS = 2000;
/** Above this, similarity scanning is skipped rather than allowed to stall a turn. */
export const MAX_DIAGNOSTIC_SOURCE_CHARS = 4_000_000;

const normalizeWS = (s) => s.replace(/\s+/g, ' ').trim();
const normalizeLine = (s) => s.replace(/\s+/g, ' ').trim();

/** 1-based line number of a character offset. */
export function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Offset of the start of the line containing `offset`. */
export function lineStartAt(source, offset) {
  const i = source.lastIndexOf('\n', Math.max(0, offset - 1));
  return i === -1 ? 0 : i + 1;
}

/** Offset just before the line terminator of the line containing `offset`. */
export function lineEndAt(source, offset) {
  const i = source.indexOf('\n', offset);
  if (i === -1) return source.length;
  return i > 0 && source[i - 1] === '\r' ? i - 1 : i;
}

/** Every non-overlapping occurrence of `needle`. */
function allIndexes(source, needle) {
  const out = [];
  if (!needle) return out;
  for (let k = source.indexOf(needle); k !== -1; k = source.indexOf(needle, k + needle.length)) {
    out.push({ start: k, end: k + needle.length });
  }
  return out;
}

/**
 * Whitespace-insensitive scan collecting EVERY match, not just the first.
 *
 * Two invariants carried over from the 2026-07-25 line-merge fix, both
 * load-bearing:
 *
 *   1. A window may never BEGIN on whitespace. normalizeWS() trims, so such a
 *      window normalizes identically to one starting at the next non-whitespace
 *      character — but its start offset sits before the preceding newline, and
 *      splicing there deletes the line break, welding the replacement onto the
 *      end of the previous line.
 *   2. Indentation is absorbed backwards ONLY over spaces and tabs. Crossing a
 *      newline is precisely bug 1.
 */
function whitespaceInsensitiveMatches(source, search) {
  const normSearch = normalizeWS(search);
  const out = [];
  if (!normSearch) return out;

  const searchIndented = /^[ \t]/.test(search);
  const srcLen = source.length;

  for (let srcPos = 0; srcPos < srcLen; srcPos++) {
    if (/\s/.test(source[srcPos])) continue;

    let normWindow = '';
    let windowEnd = srcPos;
    let matchedEnd = -1;

    while (windowEnd < srcLen) {
      const ch = source[windowEnd];
      if (/\s/.test(ch)) {
        if (normWindow.length > 0 && !normWindow.endsWith(' ')) normWindow += ' ';
        windowEnd++;
      } else {
        normWindow += ch;
        windowEnd++;
      }

      const trimmed = normWindow.trim();
      if (trimmed === normSearch) { matchedEnd = windowEnd; break; }
      if (trimmed.length > normSearch.length + 10) break;
    }

    if (matchedEnd !== -1) {
      let start = srcPos;
      if (searchIndented) {
        while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--;
      }
      out.push({ start, end: matchedEnd });
      srcPos = matchedEnd - 1; // non-overlapping
    }
  }
  return out;
}

/**
 * Locate `search` in `source`.
 *
 * Returns `{ tier, matches: [{start, end}] }` for the FIRST tier that yields any
 * match, or `null`. `matches` always contains every occurrence at that tier —
 * the caller decides what to do about ambiguity. The previous implementation
 * returned the first hit with a hardcoded `occurrences: 1` on the fuzzy path,
 * which made an ambiguous fuzzy match indistinguishable from a unique one.
 */
export function findMatches(source, search) {
  if (typeof search !== 'string' || search === '') return null;

  const asLf = search.replace(/\r\n/g, '\n');
  const asCrlf = asLf.replace(/\n/g, '\r\n');

  const variants = [{ text: search, tier: MATCH_TIERS.EXACT }];
  if (asLf !== search) variants.push({ text: asLf, tier: MATCH_TIERS.EOL });
  if (asCrlf !== search && asCrlf !== asLf) variants.push({ text: asCrlf, tier: MATCH_TIERS.EOL });

  for (const v of variants) {
    const matches = allIndexes(source, v.text);
    if (matches.length) return { tier: v.tier, matches };
  }

  const ws = whitespaceInsensitiveMatches(source, search);
  if (ws.length) return { tier: MATCH_TIERS.WHITESPACE, matches: ws };

  return null;
}

// ------------------------------------------------------------ did-you-mean ---

/** Character-trigram Jaccard. Order-insensitive, cheap, no dependency. */
function trigrams(s) {
  const g = new Set();
  const t = s.length > 400 ? s.slice(0, 400) : s;
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  if (!g.size && t.length) g.add(t);
  return g;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function clip(text, max = MAX_CANDIDATE_CHARS) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${text.length - max} more characters]`;
}

/**
 * "Did you mean these actual lines?"
 *
 * Anchors on the most distinctive line of the search string, scores whole
 * windows around every plausible anchor position, and returns the real file text
 * with line numbers. This is the single highest-leverage change in the audit:
 * it converts a blind retry into an informed one.
 */
export function findCandidates(source, search, { max = MAX_CANDIDATES } = {}) {
  if (typeof search !== 'string' || !search.trim()) return [];
  if (source.length > MAX_DIAGNOSTIC_SOURCE_CHARS) return [];

  const srcLines = source.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const needleLines = search.split(/\r\n|\r|\n/);
  const needleNorm = needleLines.map(normalizeLine);

  // The longest normalized needle line is the most distinctive anchor.
  let anchorIdx = 0;
  for (let i = 1; i < needleNorm.length; i++) {
    if (needleNorm[i].length > needleNorm[anchorIdx].length) anchorIdx = i;
  }
  const anchor = needleNorm[anchorIdx];
  if (!anchor) return [];

  const anchorTri = trigrams(anchor);
  const targetNorm = needleNorm.join('\n');
  const targetTri = trigrams(targetNorm);

  // Pass 1 — cheap per-line scoring against the anchor only.
  const anchorHits = [];
  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    if (!line.trim()) continue;
    if (line.length > 2000) continue;
    const norm = normalizeLine(line);
    // Length prefilter: nothing under a third or over triple can plausibly win.
    if (norm.length * 3 < anchor.length || norm.length > anchor.length * 3 + 12) continue;
    const s = jaccard(trigrams(norm), anchorTri);
    if (s >= 0.34) anchorHits.push({ i, s });
  }
  anchorHits.sort((a, b) => b.s - a.s);

  // Pass 2 — score the full window around each surviving anchor.
  const seen = new Set();
  const scored = [];
  for (const hit of anchorHits.slice(0, 40)) {
    const startLine = Math.max(0, hit.i - anchorIdx);
    const endLine = Math.min(srcLines.length, startLine + needleLines.length);
    const key = `${startLine}:${endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const windowNorm = srcLines.slice(startLine, endLine).map(normalizeLine).join('\n');
    scored.push({ startLine, endLine, score: jaccard(trigrams(windowNorm), targetTri) });
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, max).map((c) => ({
    startLine: c.startLine + 1,
    endLine: c.endLine,
    similarity: Number(c.score.toFixed(2)),
    actual: clip(srcLines.slice(c.startLine, c.endLine).join('\n')),
  }));
}

/**
 * Build the failure payload for one edit that did not match.
 *
 * The wording matters as much as the data: it has to make the next move obvious
 * without a further round trip, which is why the copy names the exact remedy.
 */
export function describeMiss(source, search) {
  const candidates = findCandidates(source, search);
  const detail = {
    reason: 'Search string not found',
    search: search.length > 200 ? `${search.slice(0, 200)}…` : search,
    searchLines: search.split(/\r\n|\r|\n/).length,
  };

  if (candidates.length) {
    detail.didYouMean = candidates;
    detail.hint =
      `The closest text in the file is at line ${candidates[0].startLine} ` +
      `(similarity ${candidates[0].similarity}). Copy it VERBATIM from "actual" ` +
      'into your search string — the file is the source of truth, not your ' +
      'recollection of it.';
  } else {
    detail.hint =
      'No similar text exists anywhere in this file. Re-read the file (or check ' +
      'the path) before retrying — the content you are editing against is not here.';
  }
  return detail;
}

/** Ambiguity payload: every occurrence, with line numbers, so context can be added. */
export function describeAmbiguity(source, search, matches, tier) {
  return {
    reason: 'Search string is not unique',
    search: search.length > 200 ? `${search.slice(0, 200)}…` : search,
    occurrences: matches.length,
    tier,
    lines: matches.slice(0, 20).map((m) => lineAt(source, m.start)),
    hint:
      `Found ${matches.length} occurrences (lines ` +
      `${matches.slice(0, 20).map((m) => lineAt(source, m.start)).join(', ')}). ` +
      'Editing the first one silently is how the wrong call site gets modified, ' +
      'so this is refused. Either extend the search string with surrounding ' +
      'context until it is unique, or set "replace_all": true on this edit.',
  };
}

// -------------------------------------------------------------------- diff ---

/**
 * Exact unified-style diff built from the splices themselves.
 *
 * Every applied splice records its offset in the buffer AS IT WAS AT THE TIME,
 * so a later splice shifts the recorded offsets of earlier ones. `shiftRecords`
 * keeps them all in FINAL-content coordinates, which is what makes the reported
 * line numbers exact for multi-edit calls rather than merely close.
 */
export function shiftRecords(records, spliceStart, spliceEnd, insertedLength) {
  const delta = insertedLength - (spliceEnd - spliceStart);
  if (delta === 0) return records;
  for (const r of records) {
    if (r.finalStart >= spliceEnd) r.finalStart += delta;
  }
  return records;
}

export function renderDiff(finalContent, records) {
  const parts = [];
  let used = 0;
  // Splices are applied right-to-left within an edit so offsets stay valid;
  // a diff read top-to-bottom is the only useful order.
  const ordered = [...records].sort((a, b) => a.finalStart - b.finalStart);
  for (const r of ordered) {
    const line = lineAt(finalContent, r.finalStart);
    const oldLines = r.oldBlock.split(/\r\n|\r|\n/);
    const newLines = r.newBlock.split(/\r\n|\r|\n/);
    const hunk = [
      `@@ line ${line} @@`,
      ...oldLines.map((l) => `-${l}`),
      ...newLines.map((l) => `+${l}`),
    ].join('\n');
    if (used + hunk.length > MAX_DIFF_CHARS) {
      parts.push(`… ${ordered.length - parts.length} more hunk(s) omitted`);
      break;
    }
    parts.push(hunk);
    used += hunk.length + 1;
  }
  return parts.join('\n');
}
