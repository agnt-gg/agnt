/**
 * The safety properties of scripts/worktree.mjs, driven against a throwaway
 * repository so nothing here can touch the real one.
 *
 * The property that matters most is the last one in each block: the real
 * node_modules must survive every operation. Every worktree carries a junction
 * into it, and a recursive delete that follows that junction is the failure
 * mode this script exists to prevent.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorktree,
  findOrphans,
  listWorktrees,
  removeWorktree,
  sweepOrphans,
  WORKTREES_DIR,
} from './worktree.mjs';

// Real git on a real filesystem, on Windows, under a virus scanner. A single
// create is ~1.5s here and the first one in a run pays a cold start on top.
vi.setConfig({ testTimeout: 60_000 });

let root;
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const canary = (rel) => path.join(root, rel, 'canary.txt');

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-wt-')));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
  // Mirrors the real repo: node_modules and .env are ignored. Git on Windows
  // sees a junction as a directory, so without this `git add .` in a
  // worktree would commit the primary's node_modules through the link.
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.env\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);

  // The things a worktree links to. If any canary disappears, a delete
  // followed a link into the primary checkout.
  for (const d of ['node_modules', path.join('frontend', 'node_modules'), 'backend']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(canary('node_modules'), 'root');
  fs.writeFileSync(canary(path.join('frontend', 'node_modules')), 'frontend');
  fs.writeFileSync(path.join(root, 'backend', '.env'), 'SECRET=1\n');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const onDisk = () => (fs.existsSync(path.join(root, WORKTREES_DIR)) ? fs.readdirSync(path.join(root, WORKTREES_DIR)).sort() : []);
const inGit = () => listWorktrees(root).slice(1).map((w) => path.basename(w.path)).sort();

describe('create', () => {
  it('adds a worktree on a new branch with node_modules linked, not copied', () => {
    const r = createWorktree(root, 'alpha');
    expect(r.branch).toBe('fix/alpha');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], r.path)).toBe('fix/alpha');

    for (const rel of ['node_modules', path.join('frontend', 'node_modules')]) {
      const link = path.join(r.path, rel);
      expect(fs.lstatSync(link).isSymbolicLink(), `${rel} should be a link`).toBe(true);
      expect(fs.readFileSync(path.join(link, 'canary.txt'), 'utf8')).toBe(rel === 'node_modules' ? 'root' : 'frontend');
    }
    expect(fs.readFileSync(path.join(r.path, 'backend', '.env'), 'utf8')).toBe('SECRET=1\n');
    expect(r.linked).toEqual(['node_modules', path.join('frontend', 'node_modules'), path.join('backend', '.env')]);
  });

  it('honours --branch and --from', () => {
    git(['branch', 'release']);
    const r = createWorktree(root, 'beta', { branch: 'feat/beta', from: 'release' });
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], r.path)).toBe('feat/beta');
  });

  it('refuses a slug that could escape .worktrees/', () => {
    expect(() => createWorktree(root, '../escape')).toThrow(/invalid slug/);
    expect(() => createWorktree(root, 'a/b')).toThrow(/invalid slug/);
    expect(() => createWorktree(root, '')).toThrow(/invalid slug/);
  });

  it('refuses to create over a leaked directory and names the cure', () => {
    fs.mkdirSync(path.join(root, WORKTREES_DIR, 'ghost'), { recursive: true });
    expect(() => createWorktree(root, 'ghost')).toThrow(/already exists.*sweep/);
  });
});

describe('remove', () => {
  it('detaches links first, removes the worktree, deletes the merged branch', () => {
    createWorktree(root, 'alpha');
    const r = removeWorktree(root, 'alpha');

    expect(r.detached.length).toBe(2);
    expect(r.branchDeleted).toBe(true);
    expect(onDisk()).toEqual([]);
    expect(inGit()).toEqual([]);
    expect(() => git(['rev-parse', '--verify', 'fix/alpha'])).toThrow();

    // THE property.
    expect(fs.readFileSync(canary('node_modules'), 'utf8')).toBe('root');
    expect(fs.readFileSync(canary(path.join('frontend', 'node_modules')), 'utf8')).toBe('frontend');
    // The hard-linked .env: the worktree's name is gone, the primary's is intact.
    expect(fs.readFileSync(path.join(root, 'backend', '.env'), 'utf8')).toBe('SECRET=1\n');
  });

  it('refuses a dirty worktree unless forced', () => {
    const r = createWorktree(root, 'alpha');
    fs.writeFileSync(path.join(r.path, 'wip.txt'), 'unsaved');
    expect(() => removeWorktree(root, 'alpha')).toThrow(/uncommitted changes/);
    expect(inGit()).toEqual(['alpha']);

    removeWorktree(root, 'alpha', { force: true });
    expect(onDisk()).toEqual([]);
  });

  it('keeps an unmerged branch rather than -D it on your behalf', () => {
    const r = createWorktree(root, 'alpha');
    fs.writeFileSync(path.join(r.path, 'work.txt'), 'real work');
    git(['add', '.'], r.path);
    git(['commit', '-q', '-m', 'work'], r.path);

    const res = removeWorktree(root, 'alpha');
    expect(res.branchDeleted).toBe(false);
    expect(res.branchKept).toBe('fix/alpha');
    expect(git(['rev-parse', '--verify', 'fix/alpha'])).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses something git does not list, and points at sweep', () => {
    fs.mkdirSync(path.join(root, WORKTREES_DIR, 'ghost'), { recursive: true });
    expect(() => removeWorktree(root, 'ghost')).toThrow(/not a registered worktree.*sweep/);
  });
});

describe('sweep', () => {
  /**
   * Reproduce the 2026-09-01 leak exactly: the checkout is on disk with its
   * junctions live, but git's admin entry for it is gone. `git worktree list`
   * no longer mentions it; the runner still collects tests from it.
   */
  function leak(slug) {
    const r = createWorktree(root, slug);
    fs.rmSync(path.join(root, '.git', 'worktrees', slug), { recursive: true, force: true });
    return r.path;
  }

  it('finds a directory git has forgotten', () => {
    leak('ghost');
    expect(inGit()).toEqual([]);
    expect(onDisk()).toEqual(['ghost']);
    expect(findOrphans(root).map((p) => path.basename(p))).toEqual(['ghost']);
  });

  it('--dry reports and deletes nothing', () => {
    leak('ghost');
    const r = sweepOrphans(root, { dry: true });
    expect(r.orphans.length).toBe(1);
    expect(r.removed).toEqual([]);
    expect(onDisk()).toEqual(['ghost']);
  });

  it('deletes the leak, and the real node_modules survives its junctions', () => {
    const p = leak('ghost');
    expect(fs.lstatSync(path.join(p, 'node_modules')).isSymbolicLink()).toBe(true);

    const r = sweepOrphans(root);
    expect(r.removed.map((x) => path.basename(x))).toEqual(['ghost']);
    expect(onDisk()).toEqual([]);

    expect(fs.readFileSync(canary('node_modules'), 'utf8')).toBe('root');
    expect(fs.readFileSync(canary(path.join('frontend', 'node_modules')), 'utf8')).toBe('frontend');
  });

  it('never touches a registered worktree, even a dirty one', () => {
    const live = createWorktree(root, 'live');
    fs.writeFileSync(path.join(live.path, 'wip.txt'), 'unsaved');
    leak('ghost');

    sweepOrphans(root);
    expect(onDisk()).toEqual(['live']);
    expect(inGit()).toEqual(['live']);
    expect(fs.readFileSync(path.join(live.path, 'wip.txt'), 'utf8')).toBe('unsaved');
  });

  it('is a no-op when on-disk and git agree', () => {
    createWorktree(root, 'live');
    expect(sweepOrphans(root)).toEqual({ orphans: [], removed: [] });
    expect(onDisk()).toEqual(inGit());
  });
});
