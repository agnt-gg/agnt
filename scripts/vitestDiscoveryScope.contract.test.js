/**
 * What the backend runner is allowed to discover.
 *
 * A linked worktree is a full second checkout living under the repo root. Test
 * discovery is a filesystem walk, so it descends into one and collects every
 * test file again — and because every other pattern in vitest.config.js is
 * root-relative, 'frontend/**' does not match '.worktrees/wt-x/frontend/**'.
 * A worktree therefore smuggles back in exactly the four groups that config
 * deliberately drops, and they fail exactly as its header predicts.
 *
 * Measured on 2026-09-01 with one worktree checked out: 963 files collected,
 * 625 of them duplicates, a 338-file suite reporting 662 failures. The damage
 * scales with the number of branches in flight, so the more parallel the work
 * the redder the gate — which is the opposite of what a gate is for. Nothing
 * else reports it either: .worktrees/ is gitignored (.gitignore:26), so git,
 * CI and code review are all silent and the only symptom is a suite that
 * cannot go green.
 *
 * These assertions are deliberately structural rather than glob-matched.
 * picomatch resolves in node_modules today but is declared by nothing in
 * package.json, and a guard that quietly dies on a hoisting change is not a
 * guard.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import rootConfig from '../vitest.config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exclude = rootConfig.test.exclude;

/** Patterns whose job is to keep the walker out of linked worktrees. */
const worktreePatterns = exclude.filter(
  (pattern) => typeof pattern === 'string' && pattern.includes('.worktrees'),
);

describe('linked worktrees are not a second copy of the suite', () => {
  it('excludes them at all', () => {
    expect(
      worktreePatterns.length,
      'vitest.config.js has no .worktrees exclusion — every checked-out branch ' +
        'now adds a full duplicate of this suite, including the frontend, e2e ' +
        'and node:test files this runner cannot execute',
    ).toBeGreaterThan(0);
  });

  it('targets the directory, not anything merely named like it', () => {
    // '**/*worktree*/**' would also match backend/src/utils/worktrees.js and
    // silently drop real coverage. The literal dotted segment is the contract.
    for (const pattern of worktreePatterns) {
      expect(
        pattern,
        `"${pattern}" does not name the .worktrees/ directory as a path segment, ` +
          'so it can match ordinary source files that happen to contain the word',
      ).toMatch(/(^|\/)\.worktrees\//);
    }
  });

  it('reaches the whole tree beneath them', () => {
    // A worktree holds the entire repo. Anything short of a recursive suffix
    // leaves the nested backend/, frontend/ and tests/ trees collectable.
    for (const pattern of worktreePatterns) {
      expect(
        pattern.endsWith('/**'),
        `"${pattern}" stops short of recursing — the duplicate backend/ and ` +
          'frontend/ trees inside the worktree are still discovered',
      ).toBe(true);
    }
  });
});

describe('the exclusions that were already load-bearing survive', () => {
  // Each of these has its own runner named in the vitest.config.js header.
  // Dropping one does not remove a suite from the repo, it removes it from
  // anyone's attention — the exact failure that config exists to prevent.
  const REQUIRED = [
    'frontend/**',
    'tests/e2e/**',
    'tests/unit/**',
    'backend/plugins/tests/**',
    'backend/tests/providers/providers/**',
    'backend/tests/providers/suites/**',
  ];

  for (const pattern of REQUIRED) {
    it(`still excludes ${pattern}`, () => {
      expect(
        exclude,
        `${pattern} has its own runner and cannot execute here — see the ` +
          'vitest.config.js header for which npm script owns it',
      ).toContain(pattern);
    });
  }
});

describe('the frontend runner is scoped by its own location', () => {
  it('does not reach above frontend/ to find the worktrees', () => {
    // frontend/vitest.config.js needs no .worktrees exclusion for one reason
    // only: its root is the directory the config sits in, and .worktrees/ is
    // the root's SIBLING, not its child. Measured: 243 spec files collected
    // with a worktree present, i.e. exactly one copy. Setting a root here
    // would put that back in play.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'frontend', 'vitest.config.js'),
      'utf8',
    );

    expect(
      source,
      'frontend/vitest.config.js now sets a root. If it points above frontend/, ' +
        'that runner starts collecting .worktrees copies too and needs the same ' +
        'exclusion the backend config carries',
    ).not.toMatch(/^\s*root\s*:/m);
  });
});
