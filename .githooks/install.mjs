#!/usr/bin/env node
/**
 * Point git at the tracked hooks in `.githooks`.
 *
 * `core.hooksPath` is used rather than copying files into `.git/hooks` because
 * a copy is a fork: it goes stale the moment the tracked hook changes, and
 * nothing tells you. A relative hooksPath resolves against the top level of the
 * working tree, and the config lives in the COMMON config shared by every
 * linked worktree, so one run covers the primary checkout and every worktree
 * created afterwards.
 *
 * Never exits non-zero. This runs from `postinstall`, and a machine that cannot
 * run the installer for some local reason must still be able to install the
 * app; a missing lint hook is not worth a failed `npm install`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const HOOKS_DIR = '.githooks';

function main() {
  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    console.log('git-hooks: not a git checkout (packaged build or tarball); skipping.');
    return;
  }

  if (!existsSync(path.join(root, HOOKS_DIR, 'commit-msg'))) {
    console.log(`git-hooks: ${HOOKS_DIR}/commit-msg is missing; skipping.`);
    return;
  }

  let current = '';
  try {
    current = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
  } catch {
    // Unset. git exits 1 for a missing key, which is not an error here.
  }

  if (current === HOOKS_DIR) {
    console.log(`git-hooks: already installed (core.hooksPath=${HOOKS_DIR}).`);
    return;
  }

  // Someone pointed hooks somewhere else deliberately. Say so and change nothing.
  if (current) {
    console.warn(
      `git-hooks: core.hooksPath is set to "${current}", not "${HOOKS_DIR}". Leaving it alone.\n`
      + `           Run: git config core.hooksPath ${HOOKS_DIR}`,
    );
    return;
  }

  try {
    execFileSync('git', ['config', 'core.hooksPath', HOOKS_DIR], { encoding: 'utf8' });
    console.log(`git-hooks: installed (core.hooksPath=${HOOKS_DIR}).`);
  } catch (error) {
    console.warn(`git-hooks: could not set core.hooksPath: ${error.message}`);
  }
}

main();
