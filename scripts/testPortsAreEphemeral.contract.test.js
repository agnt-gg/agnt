/**
 * No test may bind a fixed port.
 *
 * Every test in this repo that listens already does so on port 0 and reads
 * the port back from the socket — which is why two full suites can run at
 * the same time from two worktrees without colliding on a socket. That is a
 * property the parallel workflow depends on, and it is one that a single
 * copy-pasted `listen(3333)` silently removes: the test passes alone, passes
 * in CI, and fails only when another agent's suite happens to be running.
 *
 * The literal 3333 appears in plenty of tests as DATA — the default port that
 * URL builders and pairing logic must produce — and that is fine. What is
 * forbidden is passing a non-zero numeric literal to `.listen(`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// ~600 files read from disk while other workers are doing the same. Measured
// at 8.8s under full-suite contention; this is I/O-bound, not slow code.
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const testFiles = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter((f) => /\.(test|spec)\.(m?js|ts)$/.test(f));

describe('every listening test binds an ephemeral port', () => {
  it('has a non-trivial number of test files to check', () => {
    // If discovery ever comes back empty, the assertion below passes for the
    // wrong reason. `.every()` on nothing is true.
    expect(testFiles.length).toBeGreaterThan(300);
  });

  it('never passes a fixed port to .listen()', () => {
    const offenders = [];
    for (const rel of testFiles) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      for (const m of src.matchAll(/\.listen\(\s*([^,)]+)/g)) {
        const firstArg = m[1].trim();
        if (/^\d+$/.test(firstArg) && firstArg !== '0') {
          offenders.push(`${rel}: .listen(${firstArg}`);
        }
      }
    }
    expect(
      offenders,
      'a test binds a fixed port. Use listen(0) and read server.address().port — ' +
        'two suites running side by side must never contend for a socket',
    ).toEqual([]);
  });
});
