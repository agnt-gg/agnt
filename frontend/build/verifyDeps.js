// Guard: node_modules must match package-lock.json before vite/vitest start.
//
// WHY THIS EXISTS
// ───────────────
// On 2026-08-03 (and at least twice before) every frontend build and test run
// died with "Cannot find package '@babel/core'" — a name that appears nowhere
// in package.json, because it was a transitive dependency of a plugin. The
// packages had been silently pruned from the SHARED node_modules by an npm
// reify in another session/worktree (main and all worktrees junction the same
// physical directory). Nothing verified the tree, so the damage surfaced
// hours later, in a different branch, as an unfindable error.
//
// This check runs at config-load time — the exact choke point where that
// failure used to surface — and turns it into a self-naming error with the
// fix command in it. On a healthy tree it costs a few milliseconds of
// existsSync calls.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Pure core: which lockfile packages are absent from disk?
 *
 * @param {object} lock   parsed package-lock.json (lockfileVersion >= 2)
 * @param {(pkgPath: string) => boolean} exists  existence probe, takes the
 *        lockfile-relative path e.g. "node_modules/@babel/core"
 * @returns {string[]} missing package names (without the node_modules/ prefix)
 */
export function findMissingPackages(lock, exists) {
  const missing = [];
  for (const [pkgPath, meta] of Object.entries(lock.packages ?? {})) {
    if (!pkgPath.startsWith('node_modules/')) continue; // root entry
    if (meta.link) continue; // workspace links resolve elsewhere
    // npm legitimately skips platform-mismatched optional packages
    // (@esbuild/linux-x64 on Windows, fsevents off macOS, ...). Their absence
    // is correct, not drift.
    if (meta.optional || meta.devOptional) continue;
    if (!exists(pkgPath)) missing.push(pkgPath.slice('node_modules/'.length));
  }
  return missing;
}

/**
 * Throws with a self-naming, self-fixing error message when node_modules has
 * drifted from package-lock.json. Silently returns when there is no lockfile
 * (nothing to verify against) — that is npm's job to complain about, not ours.
 *
 * @param {string} rootDir absolute path to the directory holding
 *        package-lock.json and node_modules (the frontend/ dir)
 */
export function verifyDeps(rootDir) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  } catch {
    return; // no lockfile — nothing to verify
  }

  const missing = findMissingPackages(lock, (p) => fs.existsSync(path.join(rootDir, p)));
  if (missing.length === 0) return;

  const shown = missing.slice(0, 10).map((m) => '  ' + m).join('\n');
  const more = missing.length > 10 ? `\n  … and ${missing.length - 10} more` : '';
  throw new Error(
    `node_modules is out of sync with package-lock.json — ${missing.length} package(s) missing:\n` +
    `${shown}${more}\n\n` +
    `Fix:   npm --prefix frontend ci   (or: cd frontend && npm install)\n` +
    `Cause: usually an npm run in another session or worktree pruned the shared\n` +
    `node_modules (all worktrees junction the same physical directory).`
  );
}
