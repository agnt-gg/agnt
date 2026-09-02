import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorktree } from '../worktree.mjs';
import { auditFootprint, buildBundle, changedFiles, classifyTier, redThenGreen } from './evidence.mjs';

vi.setConfig({ testTimeout: 60_000 });

describe('auditFootprint', () => {
  it('passes when every changed file was declared', () => {
    expect(auditFootprint(['a.js', 'b.js'], ['a.js', 'b.js', 'c.js'])).toEqual({ ok: true, audited: true, extra: [] });
  });
  it('names exactly what exceeded the contract', () => {
    expect(auditFootprint(['a.js', 'z.js'], ['a.js'])).toEqual({ ok: false, audited: true, extra: ['z.js'] });
  });
  it('cannot pass without a footprint to audit against', () => {
    expect(auditFootprint(['a.js'], null)).toEqual({ ok: false, audited: false, extra: ['a.js'] });
  });
});

describe('classifyTier', () => {
  const honoured = { ok: true, audited: true, extra: [] };
  const proven = { ok: true, reason: 'fail on parent, pass on candidate' };

  it('tier 0: pure additions, inside the footprint, proven', () => {
    expect(classifyTier({ added: ['backend/src/new.js', 'backend/src/new.test.js'], footprint: honoured, redThenGreen: proven }).tier).toBe(0);
  });

  it('tier 1: edits an existing file', () => {
    const r = classifyTier({ modified: ['backend/src/x.js'], footprint: honoured, redThenGreen: proven });
    expect(r.tier).toBe(1);
    expect(r.reasons).toContain('edits 1 existing file');
  });

  it('tier 1: exceeded the footprint but nothing sensitive', () => {
    const r = classifyTier({ added: ['a.js'], footprint: { ok: false, audited: true, extra: ['a.js'] }, redThenGreen: proven });
    expect(r.tier).toBe(1);
  });

  it('tier 1: touched a chokepoint', () => {
    expect(classifyTier({ added: ['hot.js'], footprint: honoured, redThenGreen: proven, hot: new Set(['hot.js']) }).tier).toBe(1);
  });

  it('tier 1: no new tests means nothing was proven', () => {
    expect(classifyTier({ added: ['a.js'], footprint: honoured, redThenGreen: null }).tier).toBe(1);
  });

  it('tier 2: sensitive paths, deleted tests, repeat bounces, no footprint, failed proof', () => {
    expect(classifyTier({ modified: ['backend/src/routes/AuthRoutes.js'], footprint: honoured, redThenGreen: proven }).tier).toBe(2);
    expect(classifyTier({ deleted: ['backend/src/x.test.js'], footprint: honoured, redThenGreen: proven }).tier).toBe(2);
    expect(classifyTier({ added: ['a.js'], footprint: honoured, redThenGreen: proven, bounces: 2 }).tier).toBe(2);
    expect(classifyTier({ added: ['a.js'], footprint: { ok: false, audited: false, extra: [] }, redThenGreen: proven }).tier).toBe(2);
    expect(classifyTier({ added: ['a.js'], footprint: honoured, redThenGreen: { ok: false, reason: 'passes on parent' } }).tier).toBe(2);
  });
});

describe('against a real repo', () => {
  let root;
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-ev-')));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t']);
    git(['config', 'user.name', 't']);
    git(['config', 'commit.gpgsign', 'false']);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'base']);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function branchWith(files) {
    const wt = createWorktree(root, 'cand');
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(wt.path, rel);
      if (content === null) fs.rmSync(p);
      else {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
      }
    }
    git(['add', '-A'], wt.path);
    git(['commit', '-q', '-m', 'work'], wt.path);
    return wt.path;
  }

  it('changedFiles splits added / modified / deleted since the merge-base', () => {
    const wt = branchWith({ 'src/a.js': 'export const a = 2;\n', 'src/b.js': 'new', 'src/a.test.js': 'test' });
    // main moves on; that must not appear as the branch's change
    fs.writeFileSync(path.join(root, 'src', 'main-only.js'), 'x');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'main moved']);
    const c = changedFiles(wt, 'main');
    expect(c).toEqual({ added: ['src/a.test.js', 'src/b.js'], modified: ['src/a.js'], deleted: [], all: ['src/a.js', 'src/a.test.js', 'src/b.js'] });
  });

  it('redThenGreen runs the new tests on the parent and on the candidate, and cleans up', () => {
    const wt = branchWith({ 'src/a.js': 'export const a = 2;\n', 'src/a.test.js': 'expects a === 2' });
    const calls = [];
    // A stand-in runner: "passes" iff the code under test says a = 2.
    const run = (cwd, files) => {
      calls.push({ cwd: path.basename(cwd), files });
      return { ok: fs.readFileSync(path.join(cwd, 'src', 'a.js'), 'utf8').includes('= 2') };
    };
    const r = redThenGreen(root, wt, { run });
    expect(r).toEqual({ ok: true, files: ['src/a.test.js'], reason: 'fail on parent, pass on candidate' });
    expect(calls.map((c) => c.cwd)).toEqual(['base', 'cand']);
    expect(calls[0].files).toEqual(['src/a.test.js']);
    // the probe checkout is gone and git agrees
    expect(git(['worktree', 'list']).split('\n').length).toBe(2);
  });

  it('redThenGreen rejects a test that already passes on the parent', () => {
    const wt = branchWith({ 'src/a.test.js': 'tautology' });
    const r = redThenGreen(root, wt, { run: () => ({ ok: true }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already pass on the parent/);
  });

  it('redThenGreen is null when no tests changed — there is nothing to prove', () => {
    const wt = branchWith({ 'src/b.js': 'x' });
    expect(redThenGreen(root, wt, { run: () => ({ ok: true }) })).toBeNull();
  });

  it('buildBundle assembles the whole thing with a pre-computed revert', () => {
    const wt = branchWith({ 'src/b.js': 'new', 'src/b.test.js': 't' });
    const bundle = buildBundle(root, wt, {
      ticket: { id: 'T-0001', footprint: ['src/b.js', 'src/b.test.js'] },
      run: (cwd) => ({ ok: fs.existsSync(path.join(cwd, 'src', 'b.js')) }),
    });
    expect(bundle.ticket).toBe('T-0001');
    expect(bundle.branch).toBe('fix/cand');
    expect(bundle.tier).toBe(0);
    expect(bundle.footprintHonored).toBe(true);
    expect(bundle.redThenGreen.ok).toBe(true);
    expect(bundle.commits.length).toBe(1);
    expect(bundle.revert).toMatch(/^git revert --no-edit [0-9a-f]{40}\^\.\.[0-9a-f]{40}$/);
  });
});
