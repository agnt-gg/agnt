/**
 * Reading source for the guard specs in this folder: list src/ files and
 * strip comments, so prose about an identifier never counts as using it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Remove comments so that prose discussing these identifiers cannot vouch for
 * a file that never calls them — and so a commented-out guard reads as absent.
 *
 * String- and template-aware on purpose: a naive `//.*$` sweep truncates any
 * line containing a URL, which would silently delete real code from the text
 * being scanned and turn a guard into a source of false passes.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Every .js and .vue file under src/, as `{ rel, code }` with comments
 * stripped and `rel` in forward slashes. A file or folder that vanishes
 * mid-walk (parallel workers, live editors) is skipped, not fatal.
 */
export function sourceFiles({ includeSpecs = true } = {}) {
  const found = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|vue)$/.test(entry.name) && (includeSpecs || !/\.spec\.js$/.test(entry.name))) found.push(full);
    }
  })(FRONTEND_SRC);
  return found.flatMap((full) => {
    try {
      return [{ rel: path.relative(FRONTEND_SRC, full).split(path.sep).join('/'), code: stripComments(fs.readFileSync(full, 'utf8')) }];
    } catch {
      return [];
    }
  });
}
