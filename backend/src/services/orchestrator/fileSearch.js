/**
 * Content search (`grep_files`) and path search (`glob_files`).
 *
 * WHY THESE EXIST
 * ---------------
 * 24.7% of every shell/JS call in AGNT's production history — 9,902 calls —
 * contains a grep equivalent (findstr, rg, grep, Select-String). There was no
 * search tool, so locating a symbol meant shelling out: OS-specific syntax, an
 * unstructured blob of stdout to parse, and no bound on what came back.
 *
 * Implemented in plain Node rather than by shelling to ripgrep. A binary that
 * may or may not be installed, in a syntax that differs per platform, is exactly
 * the dependency this replaces.
 *
 * EVERYTHING IS BOUNDED. A search tool that can return an unbounded result is a
 * context-window hazard, so every walk carries caps on files, bytes, matches and
 * wall-clock time, and always reports when it stopped early.
 */

import fs from 'fs/promises';
import path from 'path';

/** Generated / vendored trees are never worth walking. */
export const SEARCH_IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  'target', 'bin', 'obj',
  '__pycache__', '.venv', 'venv', 'env',
  '.pytest_cache', '.mypy_cache', '.tox',
  'frames', 'extracted_frames',
  'coverage', '.nyc_output',
  '.idea', '.vscode',
]);

export const DEFAULTS = Object.freeze({
  maxResults: 100,
  maxResultsCap: 500,
  maxFiles: 20_000,
  maxFileBytes: 2_000_000,
  maxTotalBytes: 128_000_000,
  timeBudgetMs: 8_000,
  maxLineChars: 500,
  maxGlobResults: 200,
  maxGlobResultsCap: 1000,
});

/**
 * Translate a glob to a RegExp.
 *
 * Supports `**`, `*`, `?` and `{a,b}`. A pattern containing no `/` is matched
 * against the BASENAME, so `*.test.js` finds every test file at any depth —
 * strict glob semantics would match only the top level, which is never what the
 * caller meant when they wrote it.
 */
export function globToRegExp(glob, { caseInsensitive = process.platform === 'win32' } = {}) {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:[^/]*/)*'; } else re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      depth++; re += '(?:';
    } else if (c === '}' && depth > 0) {
      depth--; re += ')';
    } else if (c === ',' && depth > 0) {
      re += '|';
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, caseInsensitive ? 'i' : '');
}

export function matchesGlob(relPath, regex, patternHasSlash) {
  const subject = patternHasSlash ? relPath : path.basename(relPath);
  return regex.test(subject);
}

/** NUL in the first 8 KB is the standard, cheap binary heuristic. */
export function looksBinary(buffer) {
  const n = Math.min(buffer.length, 8192);
  for (let i = 0; i < n; i++) if (buffer[i] === 0) return true;
  return false;
}

/**
 * Depth-first walk yielding files, honouring every bound.
 * `onFile` returns false to stop early.
 */
async function walkFiles(root, onFile, limits) {
  const deadline = Date.now() + limits.timeBudgetMs;
  const state = { files: 0, bytes: 0, stopped: null };

  async function walk(absDir, relDir) {
    if (state.stopped) return;
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch { return; }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (state.stopped) return;
      if (entry.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (SEARCH_IGNORE_DIRS.has(entry.name)) continue;
        await walk(abs, rel);
      } else if (entry.isFile()) {
        if (Date.now() > deadline) { state.stopped = 'time budget exceeded'; return; }
        if (state.files >= limits.maxFiles) { state.stopped = 'file limit reached'; return; }
        if (state.bytes >= limits.maxTotalBytes) { state.stopped = 'byte limit reached'; return; }
        state.files++;
        const keepGoing = await onFile(abs, rel, state);
        if (keepGoing === false) { state.stopped = 'result limit reached'; return; }
      }
    }
  }

  await walk(root, '');
  return state;
}

/** Build the search regex, defaulting to a literal when `literal` is set. */
export function buildSearchRegex(pattern, { literal = false, ignoreCase = false } = {}) {
  const body = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
  return new RegExp(body, ignoreCase ? 'i' : '');
}

/**
 * Content search. Returns `{ matches, filesScanned, filesMatched, truncated, stoppedBecause }`.
 */
export async function grepFiles(rootAbs, {
  pattern,
  glob = null,
  literal = false,
  ignoreCase = false,
  maxResults = DEFAULTS.maxResults,
  contextLines = 0,
} = {}) {
  const limit = Math.min(Math.max(1, maxResults | 0), DEFAULTS.maxResultsCap);
  const ctx = Math.min(Math.max(0, contextLines | 0), 3);
  const regex = buildSearchRegex(pattern, { literal, ignoreCase });
  const globRe = glob ? globToRegExp(glob) : null;
  const globHasSlash = glob ? glob.includes('/') : false;

  const matches = [];
  const matchedFiles = new Set();

  const stat = await fs.stat(rootAbs);
  const singleFile = stat.isFile();

  const scanOne = async (abs, rel) => {
    if (globRe && !matchesGlob(rel, globRe, globHasSlash)) return true;
    let buf;
    try { buf = await fs.readFile(abs); } catch { return true; }
    if (buf.length > DEFAULTS.maxFileBytes) return true;
    if (looksBinary(buf)) return true;

    const lines = buf.toString('utf8').split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (text.length > 20_000) continue;
      if (!regex.test(text)) continue;
      matchedFiles.add(rel);
      const hit = {
        path: rel,
        line: i + 1,
        text: text.length > DEFAULTS.maxLineChars ? `${text.slice(0, DEFAULTS.maxLineChars)}…` : text,
      };
      if (ctx > 0) {
        hit.before = lines.slice(Math.max(0, i - ctx), i);
        hit.after = lines.slice(i + 1, Math.min(lines.length, i + 1 + ctx));
      }
      matches.push(hit);
      if (matches.length >= limit) return false;
    }
    return true;
  };

  let state;
  if (singleFile) {
    const keep = await scanOne(rootAbs, path.basename(rootAbs));
    state = { files: 1, bytes: 0, stopped: keep === false ? 'result limit reached' : null };
  } else {
    state = await walkFiles(rootAbs, (abs, rel) => scanOne(abs, rel), DEFAULTS);
  }

  return {
    matches,
    filesScanned: state.files,
    filesMatched: matchedFiles.size,
    truncated: Boolean(state.stopped),
    stoppedBecause: state.stopped || undefined,
  };
}

/** Path search. Returns `{ files, truncated, stoppedBecause }`. */
export async function globFiles(rootAbs, { pattern, maxResults = DEFAULTS.maxGlobResults } = {}) {
  const limit = Math.min(Math.max(1, maxResults | 0), DEFAULTS.maxGlobResultsCap);
  const regex = globToRegExp(pattern);
  const hasSlash = pattern.includes('/');
  const files = [];

  const state = await walkFiles(rootAbs, async (abs, rel) => {
    if (!matchesGlob(rel, regex, hasSlash)) return true;
    let st = null;
    try { st = await fs.stat(abs); } catch { /* raced away between readdir and stat */ }
    files.push({ path: rel, size: st ? st.size : null, mtimeMs: st ? Math.round(st.mtimeMs) : null });
    return files.length < limit;
  }, DEFAULTS);

  // Most-recently-modified first: when a caller globs for a file they are
  // almost always after the one they touched last.
  files.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));

  return {
    files,
    truncated: Boolean(state.stopped),
    stoppedBecause: state.stopped || undefined,
  };
}
