/**
 * The repo's own declared line-ending policy, read from `.gitattributes`.
 *
 * WHY
 * ---
 * A repository states its convention in one place. Before this, no write path in
 * AGNT read it — so a new file created in a repo that declares `* text=auto
 * eol=lf` got whatever the writer happened to emit, and a `*.bat text eol=crlf`
 * rule (which exists because cmd.exe genuinely needs CRLF) was invisible.
 *
 * SCOPE — DELIBERATELY A SUBSET
 * -----------------------------
 * This answers exactly one question: "which line ending does this repo want for
 * this path?" It is not a gitattributes engine. Implemented:
 *
 *   - the nearest-first walk up to the filesystem root, stopping at a `.git`
 *     directory, with deeper files taking precedence (git's rule)
 *   - last matching pattern within a file wins (git's rule)
 *   - `eol=lf` / `eol=crlf`
 *   - `-text` and `binary`, which mean "never convert" -> no policy
 *   - leading `!` negation, `/`-anchored patterns, `*`, `?`, `**`, and
 *     `[charclass]`
 *
 * Not implemented, because nothing here needs it: macro attributes
 * (`[attr]foo`), `text=auto` inferring a working-tree ending on its own (git
 * uses core.eol for that; AGNT resolves an existing file's own bytes instead,
 * which is strictly more accurate), and per-attribute unset semantics beyond
 * the two above. An unrecognised rule yields no policy, which lets
 * `lineEndings.reconcile` fall through to the file's actual bytes — the safe
 * direction.
 */

import fs from 'fs/promises';
import path from 'path';

/** Bounded so a long-lived server cannot accumulate an entry per directory. */
const MAX_CACHE = 500;

/**
 * dirPath -> { mtimeMs, rules } | { mtimeMs: null, rules: null }
 *
 * Keyed on mtime so editing a `.gitattributes` takes effect without a restart.
 * A negative result is cached too: the walk is per-write, and most directories
 * will never have one.
 */
const _cache = new Map();

function cacheSet(key, value) {
  if (_cache.size >= MAX_CACHE) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.delete(key);
  _cache.set(key, value);
  return value;
}

export function clearGitAttributesCache() {
  _cache.clear();
}

/**
 * Translate one gitattributes pattern into an anchored RegExp.
 *
 * `**` must be handled before `*`, and `*` must not cross a directory
 * separator — the usual pair of mistakes in this conversion.
 */
function patternToRegExp(pattern, { anchored }) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        out += '\\[';
      } else {
        let cls = pattern.slice(i + 1, close);
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        out += '[' + cls + ']';
        i = close;
      }
    } else if ('.+^${}()|\\/'.includes(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  // An unanchored pattern (no interior slash) matches at any depth.
  return new RegExp(anchored ? `^${out}$` : `(^|/)${out}$`);
}

function parseAttributes(text) {
  const rules = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Split off the pattern, honouring backslash-escaped spaces.
    const m = line.match(/^((?:[^\s\\]|\\.)+)\s+(.*)$/);
    if (!m) continue;
    let pattern = m[1].replace(/\\(.)/g, '$1');
    const attrs = m[2].split(/\s+/).filter(Boolean);

    const negated = pattern.startsWith('!');
    if (negated) pattern = pattern.slice(1);

    const anchored = pattern.includes('/') && !pattern.startsWith('**/');
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    const dirOnly = pattern.endsWith('/');
    if (dirOnly) pattern = pattern.slice(0, -1);
    if (!pattern) continue;

    let eol = null;
    let noConvert = false;
    for (const a of attrs) {
      if (a === 'eol=lf') eol = '\n';
      else if (a === 'eol=crlf') eol = '\r\n';
      else if (a === '-text' || a === 'binary' || a === 'text=false') noConvert = true;
    }
    if (!eol && !noConvert) continue;

    let re;
    try {
      re = patternToRegExp(pattern, { anchored });
    } catch {
      continue; // A malformed pattern must not take the write path down.
    }
    rules.push({ re, eol, noConvert, negated, dirOnly });
  }
  return rules;
}

async function rulesFor(dir) {
  const file = path.join(dir, '.gitattributes');
  let mtimeMs = null;
  try {
    const st = await fs.stat(file);
    mtimeMs = st.mtimeMs;
  } catch {
    return cacheSet(dir, { mtimeMs: null, rules: null }).rules;
  }

  const hit = _cache.get(dir);
  if (hit && hit.mtimeMs === mtimeMs) return hit.rules;

  try {
    const text = await fs.readFile(file, 'utf-8');
    return cacheSet(dir, { mtimeMs, rules: parseAttributes(text) }).rules;
  } catch {
    return cacheSet(dir, { mtimeMs, rules: null }).rules;
  }
}

/**
 * Resolve the declared ending for `absPath`, or null when the repo says nothing.
 *
 * Nearest `.gitattributes` wins, so the walk goes from the file's own directory
 * upward and returns on the first decision. Stops at a directory containing
 * `.git` (the repo boundary) or at the filesystem root.
 *
 * Never throws. A policy lookup failing must degrade to "no policy" — falling
 * back to the file's own bytes — rather than failing the write.
 */
export async function resolveEolPolicy(absPath, { maxDepth = 40 } = {}) {
  // A falsy path is not a path, and must not be answered for. `path.resolve('')`
  // is `process.cwd()`, so without this line an empty path silently walked up
  // from wherever the process happened to start and returned a policy for an
  // unrelated directory. The result therefore depended on the caller's cwd: in
  // the main checkout the parent of cwd holds no `.gitattributes` and the
  // accident looked like "returns null", while inside a linked worktree the
  // parent IS the repo root, so the identical call returned '\n' and the test
  // asserting otherwise failed in every worktree and nowhere else.
  if (typeof absPath !== 'string' || absPath === '') return null;

  try {
    let dir = path.dirname(path.resolve(absPath));
    for (let depth = 0; depth < maxDepth; depth++) {
      const rules = await rulesFor(dir);
      if (rules && rules.length) {
        const rel = path.relative(dir, absPath).split(path.sep).join('/');
        let decision = null;
        for (const rule of rules) {
          const target = rule.dirOnly ? path.dirname(rel) : rel;
          if (!rule.re.test(target)) continue;
          decision = rule.negated ? null : rule.noConvert ? { eol: null } : { eol: rule.eol };
        }
        if (decision) return decision.eol;
      }

      let atRepoRoot = false;
      try {
        await fs.stat(path.join(dir, '.git'));
        atRepoRoot = true;
      } catch { /* keep walking */ }
      if (atRepoRoot) return null;

      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch { /* fall through */ }
  return null;
}
