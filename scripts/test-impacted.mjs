#!/usr/bin/env node
/**
 * Run only the tests a change can affect.
 *
 *   npm run test:impacted            # against origin/main (or main)
 *   npm run test:impacted -- --base <ref> [--dry]
 *
 * WHAT COUNTS AS A CHANGE
 * ───────────────────────
 * Everything between the merge-base with the base ref and the working tree:
 * commits on the branch, staged and unstaged edits, and untracked files. A
 * branch that is about to land is judged on all of it, not just on HEAD.
 *
 * HOW SELECTION WORKS, AND WHERE IT IS BLIND
 * ──────────────────────────────────────────
 * `vitest related` walks the IMPORT graph: a changed module selects every
 * test that imports it, transitively. That is exact for code and useless for
 * anything a test reads with fs — the contract tests in scripts/ read
 * package.json and the CI workflows as text, and the tool-manifest tests read
 * JSON, and none of those reads are imports. So only true module files
 * (.js .mjs .cjs .ts .vue) go through `related`; any other changed file on a
 * side triggers that side's FULL suite. Slower on a doc change, never wrong.
 *
 * A change to the runner's own configuration (vitest.config.js, the setup
 * files, package.json) also means a full run: `related` cannot see what a
 * config change affects because it affects everything.
 *
 * A DELETED module is a full run too. Its importers are exactly the tests
 * that will now fail at import time, and the old graph is gone.
 *
 * The two suites are independent runners (see the vitest.config.js header),
 * so each side is planned and run separately. Exit code is the worst of the
 * two.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MODULE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.vue']);

/** Files whose change means "everything", per side. Prefix match on `/`-terminated entries. */
const FULL_RUN_TRIGGERS = {
  backend: ['vitest.config.js', 'package.json', 'package-lock.json', 'tests/setup/'],
  frontend: ['frontend/vitest.config.js', 'frontend/vitest.setup.js', 'frontend/package.json', 'frontend/package-lock.json', 'frontend/build/'],
};

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function refExists(cwd, ref) {
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export function resolveBase(cwd, requested) {
  if (requested) return requested;
  if (refExists(cwd, 'origin/main')) return 'origin/main';
  if (refExists(cwd, 'main')) return 'main';
  throw new Error('no base ref: pass --base <ref>');
}

/**
 * Every path that differs from the merge-base with `base`, as repo-relative
 * POSIX paths, split into those that still exist and those that do not.
 */
export function collectChangedFiles(cwd, base) {
  const mergeBase = git(cwd, ['merge-base', base, 'HEAD']);
  const lines = (out) => out.split('\n').map((s) => s.trim()).filter(Boolean);
  const changed = new Set([
    ...lines(git(cwd, ['diff', '--name-only', mergeBase, 'HEAD'])),
    ...lines(git(cwd, ['diff', '--name-only', 'HEAD'])),
    ...lines(git(cwd, ['ls-files', '--others', '--exclude-standard'])),
  ]);
  const present = [];
  const deleted = [];
  for (const rel of changed) {
    (fs.existsSync(path.join(cwd, rel)) ? present : deleted).push(rel);
  }
  return { mergeBase, present: present.sort(), deleted: deleted.sort() };
}

const sideOf = (rel) => (rel.startsWith('frontend/') ? 'frontend' : 'backend');
const isModule = (rel) => MODULE_EXT.has(path.posix.extname(rel));
const triggersFull = (rel, side) =>
  FULL_RUN_TRIGGERS[side].some((t) => (t.endsWith('/') ? rel.startsWith(t) : rel === t));

/**
 * Pure: decide what each runner should do. Returns, per side, one of
 *   { mode: 'skip' }                       nothing on this side changed
 *   { mode: 'full', reasons: [...] }       something `related` cannot see
 *   { mode: 'related', files: [...] }      module files to hand to vitest
 */
export function plan({ present, deleted }) {
  const out = {
    backend: { mode: 'skip', files: [], reasons: [] },
    frontend: { mode: 'skip', files: [], reasons: [] },
  };
  const escalate = (side, reason) => {
    out[side].mode = 'full';
    out[side].reasons.push(reason);
  };

  for (const rel of deleted) {
    if (isModule(rel)) escalate(sideOf(rel), `${rel} was deleted`);
  }
  for (const rel of present) {
    const side = sideOf(rel);
    if (triggersFull(rel, side)) escalate(side, `${rel} configures the runner`);
    else if (!isModule(rel)) escalate(side, `${rel} is not a module`);
    else {
      out[side].files.push(rel);
      if (out[side].mode === 'skip') out[side].mode = 'related';
    }
  }
  for (const side of ['backend', 'frontend']) {
    if (out[side].mode === 'full') out[side].files = [];
    if (out[side].mode === 'skip') out[side].reasons = [];
  }
  return out;
}

function vitestBin(cwd) {
  return path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
}

function runSide(root, side, step, dry) {
  const cwd = side === 'frontend' ? path.join(root, 'frontend') : root;
  const bin = fs.existsSync(vitestBin(cwd)) ? vitestBin(cwd) : vitestBin(root);
  const args =
    step.mode === 'full'
      ? [bin, 'run']
      : [bin, 'related', ...step.files.map((f) => path.relative(cwd, path.join(root, f))), '--run'];

  const label = step.mode === 'full' ? `FULL (${step.reasons[0]}${step.reasons.length > 1 ? `, +${step.reasons.length - 1}` : ''})` : `related to ${step.files.length} file${step.files.length === 1 ? '' : 's'}`;
  console.log(`[test:impacted] ${side}: ${label}`);
  if (dry) return 0;

  const r = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  return r.status ?? 1;
}

function main(argv) {
  const dry = argv.includes('--dry');
  const i = argv.indexOf('--base');
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const base = resolveBase(root, i === -1 ? undefined : argv[i + 1]);
  const changed = collectChangedFiles(root, base);
  const p = plan(changed);

  console.log(`[test:impacted] ${changed.present.length + changed.deleted.length} changed vs ${base} (${changed.mergeBase.slice(0, 8)})`);
  let worst = 0;
  for (const side of ['backend', 'frontend']) {
    if (p[side].mode === 'skip') {
      console.log(`[test:impacted] ${side}: nothing changed`);
      continue;
    }
    worst = Math.max(worst, runSide(root, side, p[side], dry));
  }
  process.exitCode = worst;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`test:impacted: ${err.message}`);
    process.exitCode = 1;
  }
}
