#!/usr/bin/env node
/**
 * Linked-worktree lifecycle for parallel work: create, remove, sweep, list.
 *
 *   npm run wt -- create <slug> [--branch fix/<slug>] [--from main]
 *   npm run wt -- remove <slug> [--force]
 *   npm run wt -- sweep [--dry]
 *   npm run wt -- list
 *
 * WHY A SCRIPT AND NOT FOUR GIT COMMANDS
 * ──────────────────────────────────────
 * A worktree that is useful for this repo is more than `git worktree add`:
 * it needs node_modules (1.4 GB, so linked rather than installed), the
 * frontend's node_modules, and backend/.env when one exists. And removing it
 * is more than `git worktree remove`: the links must come out FIRST, because
 * a recursive delete that follows a junction into the real node_modules is
 * a 30,000-file accident. Every one of those steps has been done by hand
 * here, and every one has been forgotten by hand at least once.
 *
 * WHY sweep EXISTS
 * ────────────────
 * On 2026-09-01 the repo had a directory under .worktrees/ that git no longer
 * knew about: the branch was deleted, the admin entry was gone, and a
 * half-removed checkout with two live junctions was still on disk. Because
 * .worktrees/ is gitignored, nothing in git, CI or review reported it. The
 * only symptom was the test runner collecting 625 phantom files from it. A
 * leak that nothing reports needs something that goes looking — that is
 * sweep, and it is meant to run in every abort path, not just the happy one.
 *
 * SAFETY PROPERTIES (each one is pinned by scripts/worktree.test.js)
 * ─────────────────
 * - sweep only ever deletes directories under .worktrees/ that are ABSENT
 *   from `git worktree list`. A registered worktree is never touched.
 * - links are unlinked before any recursive delete, and the delete itself
 *   refuses to follow symlinks or junctions. The real node_modules survives.
 * - remove refuses a dirty worktree unless --force.
 * - a branch is deleted only if it is fully merged (`git branch -d`); an
 *   unmerged branch is reported and kept. This script never runs `-D`.
 *
 * Every function takes an explicit repoRoot so the test can drive it against
 * a throwaway repository instead of this one.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKTREES_DIR = '.worktrees';

/** Directories linked (not copied) into every worktree, relative to root. */
export const LINKED_DIRS = ['node_modules', path.join('frontend', 'node_modules')];

/** Files hard-linked into every worktree when present in the primary checkout. */
export const LINKED_FILES = [path.join('backend', '.env')];

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function git(repoRoot, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'],
  }).trim();
}

/**
 * The PRIMARY checkout, even when invoked from inside a linked worktree.
 * `--show-toplevel` would answer with the worktree itself; the common git
 * dir is the one thing every worktree shares, and its parent is the root.
 */
export function primaryRoot(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return path.dirname(path.resolve(cwd, common));
}

function samePath(a, b) {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function assertSlug(slug) {
  if (!SLUG.test(slug)) {
    throw new Error(`invalid slug "${slug}": letters, digits, '.', '_' and '-' only, no path separators`);
  }
}

/** Every worktree git knows about, primary first. */
export function listWorktrees(repoRoot) {
  const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: path.resolve(line.slice('worktree '.length)), branch: null, bare: false };
      entries.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (current && line === 'bare') {
      current.bare = true;
    }
  }
  return entries;
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Remove a symlink or junction WITHOUT touching its target. On Windows a
 * directory junction is removed with rmdir; a file symlink with unlink. Try
 * both so the same code works for either kind on either platform.
 */
function unlinkLink(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    fs.rmdirSync(p);
  }
}

/** Detach every link we may have created, plus any other link at the top level. */
function detachLinks(worktreePath) {
  const detached = [];
  const candidates = new Set(LINKED_DIRS.map((d) => path.join(worktreePath, d)));
  let top = [];
  try {
    top = fs.readdirSync(worktreePath);
  } catch {
    return detached;
  }
  for (const name of top) candidates.add(path.join(worktreePath, name));
  for (const p of candidates) {
    if (isLink(p)) {
      unlinkLink(p);
      detached.push(p);
    }
  }
  return detached;
}

/**
 * Recursive delete that never descends into a link. Node's fs.rm also
 * unlinks rather than follows, but the property is important enough here to
 * make it explicit rather than rely on a library guarantee.
 */
function deleteTree(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    unlinkLink(p);
    return;
  }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) deleteTree(path.join(p, name));
    fs.rmdirSync(p);
    return;
  }
  fs.rmSync(p, { force: true });
}

function attachLinks(repoRoot, worktreePath) {
  const linked = [];
  for (const rel of LINKED_DIRS) {
    const target = path.join(repoRoot, rel);
    const link = path.join(worktreePath, rel);
    if (!fs.existsSync(target)) continue;
    if (fs.existsSync(link)) deleteTree(link); // a stale real dir from the checkout, if any
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'junction');
    linked.push(rel);
  }
  for (const rel of LINKED_FILES) {
    const src = path.join(repoRoot, rel);
    const dst = path.join(worktreePath, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
      fs.linkSync(src, dst);
    } catch {
      fs.copyFileSync(src, dst); // different volume; a copy is the best we can do
    }
    linked.push(rel);
  }
  return linked;
}

export function createWorktree(repoRoot, slug, { branch = `fix/${slug}`, from = 'main' } = {}) {
  assertSlug(slug);
  const dir = path.join(repoRoot, WORKTREES_DIR, slug);
  if (fs.existsSync(dir)) throw new Error(`${path.relative(repoRoot, dir)} already exists — run sweep if it is a leak`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(repoRoot, ['worktree', 'add', dir, '-b', branch, from]);
  const linked = attachLinks(repoRoot, dir);
  return { path: dir, branch, linked };
}

export function removeWorktree(repoRoot, slug, { force = false } = {}) {
  assertSlug(slug);
  const dir = path.join(repoRoot, WORKTREES_DIR, slug);
  const entry = listWorktrees(repoRoot).find((w) => samePath(w.path, dir));
  if (!entry) throw new Error(`${path.relative(repoRoot, dir)} is not a registered worktree — use sweep for leaks`);

  if (!force) {
    // Anything under a linked directory, or a linked file, is not the
    // user's work — it is the primary checkout seen through a link. Git on
    // Windows reports a junction as an ordinary directory, so it must be
    // filtered here whether or not .gitignore happens to cover it.
    const toPosix = (p) => p.split(path.sep).join('/');
    const linkedDirs = LINKED_DIRS.map((d) => `${toPosix(d)}/`);
    const linkedFiles = new Set(LINKED_FILES.map(toPosix));
    const dirty = git(dir, ['status', '--porcelain', '--untracked-files=all'])
      .split('\n')
      .filter((line) => {
        if (!line) return false;
        const file = line.slice(3).trim();
        return !linkedFiles.has(file) && !linkedDirs.some((d) => file.startsWith(d));
      })
      .join('\n');
    if (dirty) throw new Error(`${slug} has uncommitted changes; commit them or pass --force:\n${dirty}`);
  }

  const detached = detachLinks(dir);
  for (const rel of LINKED_FILES) {
    // A hard link, so this drops the worktree's name for the file and leaves
    // the primary checkout's copy exactly as it was.
    fs.rmSync(path.join(dir, rel), { force: true });
  }
  git(repoRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), dir]);

  let branchDeleted = false;
  let branchKept = null;
  if (entry.branch) {
    try {
      git(repoRoot, ['branch', '-d', entry.branch], { quiet: true });
      branchDeleted = true;
    } catch {
      branchKept = entry.branch; // not fully merged: never -D on someone's behalf
    }
  }
  return { path: dir, detached, branchDeleted, branchKept };
}

/**
 * Directories under .worktrees/ that git does not list. After `worktree
 * prune` has dropped stale admin entries, anything left on disk that is not
 * registered is a leak by definition.
 */
export function findOrphans(repoRoot) {
  git(repoRoot, ['worktree', 'prune']);
  const base = path.join(repoRoot, WORKTREES_DIR);
  if (!fs.existsSync(base)) return [];
  const registered = listWorktrees(repoRoot).map((w) => w.path);
  const orphans = [];
  for (const name of fs.readdirSync(base)) {
    const p = path.join(base, name);
    if (!fs.lstatSync(p).isDirectory()) continue;
    if (!registered.some((r) => samePath(r, p))) orphans.push(p);
  }
  return orphans;
}

export function sweepOrphans(repoRoot, { dry = false } = {}) {
  const orphans = findOrphans(repoRoot);
  const removed = [];
  for (const p of orphans) {
    if (dry) continue;
    detachLinks(p);
    deleteTree(p);
    removed.push(p);
  }
  return { orphans, removed };
}

/* ─────────────────────────── CLI ─────────────────────────── */

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const root = primaryRoot();
  const rel = (p) => path.relative(root, p) || '.';

  switch (cmd) {
    case 'create': {
      const slug = rest[0];
      if (!slug) throw new Error('usage: create <slug> [--branch <name>] [--from <ref>]');
      const r = createWorktree(root, slug, { branch: flag(rest, '--branch') ?? `fix/${slug}`, from: flag(rest, '--from') ?? 'main' });
      console.log(`created ${rel(r.path)} on ${r.branch}` + (r.linked.length ? ` (linked: ${r.linked.join(', ')})` : ''));
      return;
    }
    case 'remove': {
      const slug = rest[0];
      if (!slug) throw new Error('usage: remove <slug> [--force]');
      const r = removeWorktree(root, slug, { force: rest.includes('--force') });
      console.log(`removed ${rel(r.path)}` + (r.branchDeleted ? ', branch deleted' : r.branchKept ? `, branch ${r.branchKept} KEPT (not merged)` : ''));
      return;
    }
    case 'sweep': {
      const dry = rest.includes('--dry');
      const r = sweepOrphans(root, { dry });
      if (!r.orphans.length) {
        console.log('sweep: no orphaned worktrees');
        return;
      }
      for (const p of r.orphans) console.log(`${dry ? 'orphan' : 'removed'} ${rel(p)}`);
      return;
    }
    case 'list': {
      for (const w of listWorktrees(root)) console.log(`${rel(w.path).padEnd(40)} ${w.branch ?? '(detached)'}`);
      return;
    }
    default:
      console.error('usage: worktree.mjs <create|remove|sweep|list> ...');
      process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`worktree: ${err.message}`);
    process.exitCode = 1;
  }
}
