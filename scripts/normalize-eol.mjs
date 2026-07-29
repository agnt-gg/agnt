#!/usr/bin/env node
/**
 * Bring the WORKING TREE in line with the repository's declared line endings.
 *
 * WHY THIS IS NEEDED AT ALL
 * -------------------------
 * Adding `.gitattributes` fixes the REPOSITORY. It does not touch the files on
 * disk, and every tool a developer runs reads the files on disk. Git only
 * rewrites a file when it writes it (checkout) or reads it into the index (add),
 * so files checked out during a `core.autocrlf=true` era keep their CRLF bytes
 * forever — while the clean filter normalises them on the way in, which means
 * `git status` reports the tree as clean the entire time.
 *
 * Measured on agnt-pro, 2026-07-29, at the same commit:
 *   fresh clone of HEAD ..... 1744 tracked files, 0 CRLF on disk
 *   the actual working tree .. 1744 tracked files, 1329 CRLF on disk
 *   `git status` ............. clean, both times
 *
 * WHY NOT `git rm --cached -r . && git reset --hard`
 * --------------------------------------------------
 * That is the usual recipe and it works, but `reset --hard` force-rewrites the
 * worktree from HEAD and destroys every uncommitted change, so it can only ever
 * be run on a clean tree — which in a repo with several concurrent sessions is
 * a window that rarely exists. This script only ever rewrites LINE ENDINGS, so
 * uncommitted content survives it. That makes it safe to run at any time, and
 * safe to run in CI.
 *
 * USAGE
 *   node scripts/normalize-eol.mjs            # rewrite what needs rewriting
 *   node scripts/normalize-eol.mjs --check    # report only; exit 1 if drifted
 *   node scripts/normalize-eol.mjs --verbose  # name every file touched
 *
 * The desired ending comes from `git check-attr`, i.e. from git's own
 * gitattributes engine rather than a reimplementation of it. A file with no
 * `eol` attribute is left exactly as it is.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHECK = process.argv.includes('--check');
const VERBOSE = process.argv.includes('--verbose');

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });

let REPO_ROOT;
try {
  REPO_ROOT = git(['rev-parse', '--show-toplevel']).trim();
} catch {
  console.error('normalize-eol: not inside a git repository.');
  process.exit(2);
}

/** Tracked files, NUL-separated so paths with spaces survive. */
const files = git(['ls-files', '-z'], { cwd: REPO_ROOT }).split('\0').filter(Boolean);

if (files.length === 0) {
  console.log('normalize-eol: no tracked files.');
  process.exit(0);
}

/**
 * Ask git what ending each path should have.
 *
 * `check-attr --stdin -z` emits NUL-separated triples: path, attr, value.
 * Batched because spawning git per file is the difference between one second
 * and several minutes on a 1,700-file repo.
 */
function desiredEndings(paths) {
  const out = git(['check-attr', '--stdin', '-z', 'eol'], {
    cwd: REPO_ROOT,
    input: paths.join('\0'),
  });
  const parts = out.split('\0');
  const map = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const value = parts[i + 2];
    if (value === 'lf') map.set(parts[i], '\n');
    else if (value === 'crlf') map.set(parts[i], '\r\n');
  }
  return map;
}

const wanted = desiredEndings(files);

const changed = [];
const skippedBinary = [];
let scanned = 0;

for (const rel of files) {
  const eol = wanted.get(rel);
  if (!eol) continue; // repo expresses no opinion — leave it alone

  const abs = path.join(REPO_ROOT, rel);
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    continue; // deleted or unreadable; not this script's problem
  }
  scanned++;

  // A NUL byte means git's own text detection would call this binary. Rewriting
  // line endings inside it corrupts it, and no `eol` attribute is worth that.
  if (buf.includes(0)) {
    skippedBinary.push(rel);
    continue;
  }

  const text = buf.toString('utf8');
  const normalized = eol === '\n'
    ? text.replace(/\r\n/g, '\n')
    : text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

  if (normalized === text) continue;

  changed.push(rel);
  if (!CHECK) fs.writeFileSync(abs, normalized, 'utf8');
}

const label = CHECK ? 'would rewrite' : 'rewrote';
console.log(`normalize-eol: scanned ${scanned} attributed file(s); ${label} ${changed.length}.`);
if (skippedBinary.length) {
  console.log(`normalize-eol: skipped ${skippedBinary.length} binary file(s).`);
}
if (VERBOSE || (CHECK && changed.length)) {
  for (const f of changed.slice(0, 200)) console.log(`  ${f}`);
  if (changed.length > 200) console.log(`  ... and ${changed.length - 200} more`);
}

if (CHECK && changed.length) {
  console.error(
    '\nnormalize-eol: working tree line endings disagree with .gitattributes.\n' +
    'Run: node scripts/normalize-eol.mjs'
  );
  process.exit(1);
}
