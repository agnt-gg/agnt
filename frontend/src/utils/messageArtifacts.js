/**
 * The files an assistant message hands the user: every `file:///` URL that
 * names a real file, in order of first appearance.
 *
 * Feeds the "Artifacts" section of the chat right panel, so the bar is
 * "would a person call this a file?", not "does it start with file:///".
 * Prose mentions of the scheme (`file:///` in a sentence about URLs) and
 * elided paths (`file:///C:/…/report.html`) are skipped rather than listed
 * as artifacts named "`" or "…`".
 */

// URL body: everything a file path can contain, stopping at whitespace and at
// the characters that close the constructs a link is embedded in — markdown
// `)`, HTML quotes/brackets, inline-code backticks.
const FILE_URL_RE = /file:\/\/\/[^\s)"'<>`]+/g;

// Punctuation that belongs to the sentence, not the path, when it trails.
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

// A real file name: last path segment carrying an extension.
const FILE_NAME_RE = /^[^/\\]+\.[A-Za-z0-9]{1,8}$/;

/**
 * @param {unknown} content - Message body (markdown, possibly with HTML).
 * @returns {{ href: string, name: string }[]}
 */
export function extractMessageArtifacts(content) {
  if (typeof content !== 'string' || !content) return [];
  const seen = new Map();
  for (const hit of content.matchAll(FILE_URL_RE)) {
    const href = hit[0].replace(TRAILING_PUNCTUATION_RE, '');
    if (seen.has(href) || href.includes('\u2026')) continue;
    const name = displayName(href);
    if (!name) continue;
    seen.set(href, { href, name });
  }
  return [...seen.values()];
}

function displayName(href) {
  const last = href.split(/[\\/]/).pop() || '';
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // Malformed escape — show the raw segment rather than nothing.
  }
  return FILE_NAME_RE.test(decoded) ? decoded : '';
}
