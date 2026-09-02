/**
 * The train, driven against a throwaway repo with stubbed suites. What is
 * pinned: it lands only fast-forwards, refuses what exceeds the footprint,
 * bounces instead of leaving a half-rebase, survives the trunk moving under
 * it, reaps on success and keeps the worktree on a bounce.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorktree, listWorktrees } from '../worktree.mjs';
import { failedFiles, failureDigest, land, withTrainLock } from './merge-train.mjs';

vi.setConfig({ testTimeout: 60_000 });

let root;
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const ok = () => ({ ok: true, output: '' });
const fail = (why) => () => ({ ok: false, output: why });
const worktreeCount = () => listWorktrees(root).length - 1;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-train-')));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  // Deliberately NOT ignoring .worktrees/ — the train must not depend on it.
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function candidate(slug, files) {
  const wt = createWorktree(root, slug);
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(wt.path, rel), content);
  git(['add', '-A'], wt.path);
  git(['commit', '-q', '-m', `work on ${slug}`], wt.path);
  return wt;
}

describe('land', () => {
  it('rebases, audits, tests, fast-forwards, reaps', () => {
    const wt = candidate('one', { 'b.txt': 'b\n' });
    const steps = [];
    const r = land(root, 'one', {
      footprint: ['b.txt'],
      impacted: () => (steps.push('impacted'), ok()),
      fullSuite: () => (steps.push('suite'), ok()),
    });
    expect(r.status).toBe('landed');
    expect(r.files).toEqual(['b.txt']);
    expect(steps).toEqual(['impacted', 'suite']);
    expect(git(['rev-parse', 'HEAD'])).toBe(r.sha);
    expect(fs.existsSync(path.join(root, 'b.txt'))).toBe(true);
    expect(fs.existsSync(wt.path)).toBe(false);
    expect(worktreeCount()).toBe(0);
    expect(() => git(['rev-parse', '--verify', 'fix/one'])).toThrow(); // branch reaped
    // linear: the landed commit's parent is the old main
    expect(git(['rev-parse', 'HEAD^'])).toBe(git(['rev-parse', 'main@{1}']));
  });

  it('bounces on a file outside the footprint, and lands nothing', () => {
    const wt = candidate('one', { 'b.txt': 'b\n', 'sneaky.txt': 's\n' });
    const before = git(['rev-parse', 'HEAD']);
    const r = land(root, 'one', { footprint: ['b.txt'], impacted: ok, fullSuite: ok });
    expect(r.status).toBe('bounced');
    expect(r.step).toBe('footprint');
    expect(r.extra).toEqual(['sneaky.txt']);
    expect(git(['rev-parse', 'HEAD'])).toBe(before);
    expect(fs.existsSync(wt.path)).toBe(true); // kept for repair
  });

  it('bounces a failing suite with its output attached', () => {
    candidate('one', { 'b.txt': 'b\n' });
    const r = land(root, 'one', { impacted: ok, fullSuite: fail('AssertionError: expected 1 to be 2') });
    expect(r.status).toBe('bounced');
    expect(r.step).toBe('suite');
    expect(r.detail).toMatch(/expected 1 to be 2/);
  });

  it('bounces a rebase conflict and leaves no rebase in progress', () => {
    const wt = candidate('one', { 'a.txt': 'branch version\n' });
    fs.writeFileSync(path.join(root, 'a.txt'), 'main version\n');
    git(['commit', '-q', '-am', 'main edits a']);
    const r = land(root, 'one', { impacted: ok, fullSuite: ok });
    expect(r.status).toBe('bounced');
    expect(r.step).toBe('rebase');
    expect(fs.existsSync(path.join(root, '.git', 'worktrees', 'one', 'rebase-merge'))).toBe(false);
    expect(git(['status', '--porcelain'], wt.path)).toBe('');
  });

  it('when the trunk moves during testing, it rebases again and still fast-forwards', () => {
    candidate('one', { 'b.txt': 'b\n' });
    let moved = false;
    const fullSuite = () => {
      if (!moved) {
        moved = true;
        fs.writeFileSync(path.join(root, 'c.txt'), 'landed by someone else\n');
        git(['add', 'c.txt']);
        git(['commit', '-q', '-m', 'someone else lands']);
      }
      return ok();
    };
    const r = land(root, 'one', { impacted: ok, fullSuite });
    expect(r.status).toBe('landed');
    expect(r.attempts).toBe(2);
    expect(git(['log', '--oneline']).split('\n').length).toBe(3); // base, someone else, ours — no merge commit
    expect(fs.existsSync(path.join(root, 'c.txt'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'b.txt'))).toBe(true);
  });

  it('a suite that fails under load but passes alone lands, with the flake on the record', () => {
    candidate('one', { 'b.txt': 'b\n' });
    const retried = [];
    const r = land(root, 'one', {
      impacted: ok,
      fullSuite: fail(' FAIL  backend/src/x.test.js > something\n FAIL  frontend\\src\\y.spec.js > other\n Test Files  2 failed'),
      retry: (_wt, files) => (retried.push(files), ok()),
    });
    expect(r.status).toBe('landed');
    expect(retried).toEqual([['backend/src/x.test.js', 'frontend/src/y.spec.js']]);
    expect(r.flaky).toEqual(['backend/src/x.test.js', 'frontend/src/y.spec.js']);
  });

  it('a suite that fails alone too is a real bounce, carrying the second run', () => {
    candidate('one', { 'b.txt': 'b\n' });
    const r = land(root, 'one', {
      impacted: ok,
      fullSuite: fail(' FAIL  backend/src/x.test.js > something'),
      retry: fail('AssertionError: still broken'),
    });
    expect(r.status).toBe('bounced');
    expect(r.step).toBe('suite');
    expect(r.failedAlone).toEqual(['backend/src/x.test.js']);
    expect(r.detail).toMatch(/still broken/);
  });

  it('a failure with no file to retry bounces immediately', () => {
    candidate('one', { 'b.txt': 'b\n' });
    const r = land(root, 'one', { impacted: fail('Error: vitest exploded before collecting'), fullSuite: ok, retry: () => { throw new Error('must not retry'); } });
    expect(r.status).toBe('bounced');
    expect(r.step).toBe('impacted');
  });

  it('refuses a dirty primary checkout', () => {
    candidate('one', { 'b.txt': 'b\n' });
    fs.writeFileSync(path.join(root, 'a.txt'), 'uncommitted\n');
    expect(() => land(root, 'one', { impacted: ok, fullSuite: ok })).toThrow(/primary checkout is dirty/);
  });

  it('reports a branch with nothing to land', () => {
    createWorktree(root, 'empty');
    expect(land(root, 'empty', { impacted: ok, fullSuite: ok }).status).toBe('empty');
  });
});

describe('failure digest', () => {
  it('keeps the Failed Tests section and the summary, drops ANSI and stderr chatter', () => {
    const raw = '\u001b[90mstderr\u001b[2m | x.test.js > noisy\nsome log line\n\u001b[31m\u23af\u001b[39m Failed Tests 1 \n FAIL  backend/src/x.test.js > it\nAssertionError: expected 1 to be 2\n Test Files  1 failed | 3 passed';
    const d = failureDigest(raw);
    expect(d).not.toMatch(/\u001b/);
    expect(d).not.toMatch(/noisy|some log line/);
    expect(d).toMatch(/^.*Failed Tests 1/);
    expect(d).toMatch(/expected 1 to be 2/);
    expect(d).toMatch(/Test Files  1 failed/);
  });
  it('failedFiles reads FAIL lines and normalises separators', () => {
    expect(failedFiles(' FAIL  backend/src/a.test.js > x\n FAIL  frontend\\src\\b.spec.js\n FAIL  backend/src/a.test.js > y')).toEqual(['backend/src/a.test.js', 'frontend/src/b.spec.js']);
    expect(failedFiles('nothing here')).toEqual([]);
  });
});

describe('the lock', () => {
  it('serialises: a second train refuses while the first holds it', () => {
    withTrainLock(root, () => {
      expect(() => withTrainLock(root, () => {})).toThrow(/already running/);
    });
    // released afterwards, even though the inner one threw
    expect(withTrainLock(root, () => 'ran')).toBe('ran');
  });
});
