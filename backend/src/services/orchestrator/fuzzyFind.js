/**
 * Locate `search` inside `source` for a search/replace edit.
 *
 * Exact match first. Failing that, a whitespace-insensitive match: runs of
 * whitespace in both strings compare equal, so an edit whose indentation or
 * line wrapping drifted from the file (the commonest way a model's `search`
 * misses) still lands on the right span. Returns the span in ORIGINAL source
 * offsets, or null when there is no match.
 *
 * Shared by every forge that edits text it holds in page state (Widget Forge,
 * Plugin Forge) so the two cannot disagree about what "found" means.
 */
export function fuzzyFind(source, search) {
  if (typeof source !== 'string' || typeof search !== 'string' || search.length === 0) return null;

  const exactIdx = source.indexOf(search);
  if (exactIdx !== -1) return { start: exactIdx, end: exactIdx + search.length };

  const normalizeWS = (s) => s.replace(/\s+/g, ' ').trim();
  const normSearch = normalizeWS(search);
  if (!normSearch) return null;

  for (let srcPos = 0; srcPos < source.length; srcPos++) {
    let normWindow = '';
    let windowEnd = srcPos;
    while (windowEnd < source.length) {
      const ch = source[windowEnd];
      if (/\s/.test(ch)) {
        if (!normWindow.endsWith(' ') && normWindow.length > 0) normWindow += ' ';
      } else {
        normWindow += ch;
      }
      windowEnd++;

      const trimmedWindow = normWindow.trim();
      if (trimmedWindow === normSearch) return { start: srcPos, end: windowEnd };
      if (trimmedWindow.length > normSearch.length + 10) break;
    }
  }
  return null;
}
