/**
 * Pair an ```html code block in a message with the file on disk it came from.
 *
 * WHY THIS EXISTS. When a chat message contains an ```html block, the renderer
 * shows it as a live iframe. If the block is only `srcdoc`-ed, relative asset
 * references inside it (../images/x.png, ./style.css) have no real base to
 * resolve against. If instead we can prove the block IS a file that exists on
 * disk, the iframe is pointed at that file's URL and the browser resolves every
 * relative reference exactly as it would if you opened the file directly.
 *
 * WHY WRITES COUNT, NOT JUST READS. This originally recognised read tools only.
 * That covered "open this file and show me it" and missed the far more common
 * flow: Annie GENERATES a page, writes it, and shows it in the same turn. Those
 * messages fell back to srcdoc, so a generated page that referenced a generated
 * image rendered with a broken image — the one case where the base URL matters
 * most. A write is at least as strong a claim as a read that the block and the
 * file are the same bytes, so both are accepted.
 *
 * Kept as a pure module rather than inline in MessageItem.vue so the matching
 * rules are testable without mounting a component.
 */

/** Line-ending and whitespace normalisation, so a CRLF file matches an LF block. */
export const normalizeForMatch = (s) => (s || '').replace(/\r\n/g, '\n').trim();

const parseMaybeJSON = (value) => {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const isAbsolutePath = (p) => typeof p === 'string' && (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/'));

const joinPath = (a, b) => {
  if (!a) return b || '';
  if (!b) return a;
  return `${a.replace(/[\\/]+$/, '')}/${b.replace(/^[\\/]+/, '')}`;
};

/**
 * Every tool call that asserts "this text is the content of this absolute path".
 *
 * Each entry says where the CONTENT lives and where the PATH lives, because the
 * tools genuinely disagree: reads return content in the result, writes already
 * had it in the arguments, and file_system_operation uses `result` for what
 * everything else calls `content`.
 */
const CONTENT_SOURCES = [
  // ── reads ──────────────────────────────────────────────────────────────
  { match: (tc, a) => tc.name === 'read_file', content: (a, r) => r.content },
  { match: (tc, a) => tc.name === 'file_operations' && a?.operation === 'read', content: (a, r) => r.content },
  {
    match: (tc, a) => tc.name === 'file_system_operation' && a?.operation === 'readFile',
    content: (a, r) => r.result,
  },
  // ── writes ─────────────────────────────────────────────────────────────
  // The content is the argument we sent, not something echoed back: write
  // results carry only metadata (path, bytes, created). Guarded on a truthy
  // result so a failed write never pairs.
  { match: (tc, a) => tc.name === 'write_file', content: (a) => a?.content },
  { match: (tc, a) => tc.name === 'file_operations' && a?.operation === 'write', content: (a) => a?.content },
  {
    match: (tc, a) => tc.name === 'file_system_operation' && (a?.operation === 'writeFile' || a?.operation === 'appendFile'),
    content: (a) => a?.content,
  },
];

/**
 * Resolve one tool call to `{ absPath, content }`, or null when it makes no
 * claim about a file's contents.
 */
export const getFileContentCandidate = (toolCall) => {
  if (!toolCall) return null;
  const args = parseMaybeJSON(toolCall.args);
  const result = parseMaybeJSON(toolCall.result);
  // A tool call with no result never ran, or failed before touching the disk.
  if (!result) return null;
  if (result.success === false) return null;

  const source = CONTENT_SOURCES.find((s) => s.match(toolCall, args));
  if (!source) return null;

  const content = source.content(args, result);
  if (typeof content !== 'string') return null;

  // Prefer absolutePath. Fall back to result.path when absolute, then rebuild
  // from args so messages saved before the backend emitted absolutePath still
  // pair correctly.
  let absPath = null;
  if (isAbsolutePath(result.absolutePath)) absPath = result.absolutePath;
  else if (isAbsolutePath(result.path)) absPath = result.path;
  else if (isAbsolutePath(args?.path)) absPath = args.path;
  else {
    const joined = joinPath(args?.rootDirectory, args?.path);
    if (isAbsolutePath(joined)) absPath = joined;
  }
  if (!absPath) return null;

  return { absPath, content };
};

/**
 * Directory to use as the <base href> when no exact file match is found.
 * Prefers the last HTML file the turn touched, then the last file of any kind.
 */
export const getBaseDirFromToolCalls = (toolCalls) => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return '';
  let lastHtml = null;
  let lastAny = null;
  for (const tc of toolCalls) {
    const candidate = getFileContentCandidate(tc);
    if (!candidate) continue;
    lastAny = candidate.absPath;
    if (/\.html?$/i.test(candidate.absPath)) lastHtml = candidate.absPath;
  }
  const pick = lastHtml || lastAny;
  if (!pick) return '';
  const slash = Math.max(pick.lastIndexOf('/'), pick.lastIndexOf('\\'));
  return slash > 0 ? pick.slice(0, slash) : '';
};

/**
 * The absolute path of the file this HTML block came from, or null.
 *
 * Exact content match wins outright. Otherwise a prefix match of at least 200
 * characters is accepted, which covers a streaming partial or a truncated echo
 * — but the floor matters: without it every boilerplate `<!DOCTYPE html>` head
 * would "match" every HTML file the turn touched.
 */
export const findMatchingFileOnDisk = (htmlCode, toolCalls) => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const block = normalizeForMatch(htmlCode);
  if (!block) return null;

  let bestPath = null;
  let bestScore = 0;

  for (const tc of toolCalls) {
    const candidate = getFileContentCandidate(tc);
    if (!candidate) continue;
    const fileContent = normalizeForMatch(candidate.content);
    if (!fileContent) continue;

    let score = 0;
    if (fileContent === block) {
      // +1000 so any exact match outranks every prefix match, including a
      // longer prefix against a different file.
      score = block.length + 1000;
    } else {
      const shorter = fileContent.length < block.length ? fileContent : block;
      const longer = fileContent.length < block.length ? block : fileContent;
      if (shorter.length >= 200 && longer.startsWith(shorter)) score = shorter.length;
    }
    if (score <= bestScore) continue;
    bestPath = candidate.absPath;
    bestScore = score;
  }
  return bestPath;
};
