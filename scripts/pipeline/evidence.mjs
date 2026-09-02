/**
 * The evidence bundle: what a candidate branch can PROVE about itself.
 *
 * Every field here is computed, never claimed. An agent can write a confident
 * summary; it cannot make `git diff --name-only` agree with a footprint it
 * exceeded, and it cannot make a test fail on the parent commit that it did
 * not actually write. That second one — red-then-green — is the field that
 * lets tier 0 land without a human reading the diff: the train checks out
 * the merge-base, runs the branch's new tests there, REQUIRES them to fail,
 * then runs them on the candidate and requires them to pass. A test that
 * passes on both proves nothing, and nothing else catches that.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { attachLinks, detachLinks } from '../worktree.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/* ───────────── pure ───────────── */

export function auditFootprint(changed, declared) {
  if (!declared) return { ok: false, audited: false, extra: [...changed] };
  const allowed = new Set(declared);
  const extra = changed.filter((f) => !allowed.has(f));
  return { ok: extra.length === 0, audited: true, extra };
}

const TIER2_PATHS = /(^|\/)(auth|oauth|payment|billing|licens|migration|security|crypto)/i;
const TEST_FILE = /\.(test|spec)\.(m?js|ts)$|\/tests?\//;

/**
 * 0  auto-land, digest only     pure additions, footprint honoured, red-then-green
 * 1  batch acknowledgement      edits existing code, or touched a hot file
 * 2  a human reads the diff     sensitive paths, deleted tests, repeat bounces,
 *                               or the proof itself is missing
 */
export function classifyTier({ added = [], modified = [], deleted = [], footprint, redThenGreen, bounces = 0, hot = new Set() }) {
  const reasons = [];
  const all = [...added, ...modified, ...deleted];

  for (const f of all) if (TIER2_PATHS.test(f)) reasons.push(`touches ${f}`);
  for (const f of deleted) if (TEST_FILE.test(f)) reasons.push(`deletes test ${f}`);
  if (bounces >= 2) reasons.push(`bounced ${bounces} times`);
  if (!footprint.audited) reasons.push('no footprint to audit against');
  if (redThenGreen && !redThenGreen.ok) reasons.push(`red-then-green failed: ${redThenGreen.reason}`);
  if (reasons.length) return { tier: 2, reasons };

  if (!footprint.ok) reasons.push(`exceeded footprint: ${footprint.extra.join(', ')}`);
  if (modified.length) reasons.push(`edits ${modified.length} existing file${modified.length === 1 ? '' : 's'}`);
  if (deleted.length) reasons.push(`deletes ${deleted.length} file${deleted.length === 1 ? '' : 's'}`);
  for (const f of all) if (hot.has(f)) reasons.push(`${f} is a chokepoint`);
  if (!redThenGreen) reasons.push('no new tests to prove against');
  if (reasons.length) return { tier: 1, reasons };

  return { tier: 0, reasons: ['pure additions inside the footprint, proven red-then-green'] };
}

/* ───────────── computed ───────────── */

export function changedFiles(worktree, base) {
  const status = git(worktree, ['diff', '--name-status', `${base}...HEAD`]);
  const added = [];
  const modified = [];
  const deleted = [];
  for (const line of status.split('\n').filter(Boolean)) {
    const [code, ...rest] = line.split('\t');
    const file = rest[rest.length - 1];
    if (code.startsWith('A')) added.push(file);
    else if (code.startsWith('D')) deleted.push(file);
    else modified.push(file);
  }
  return { added, modified, deleted, all: [...added, ...modified, ...deleted].sort() };
}

function vitest(cwd, files) {
  const bin = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
  const r = spawnSync(process.execPath, [bin, 'run', '--reporter=dot', ...files], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  return { ok: r.status === 0, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

/**
 * Run the branch's NEW test files against the merge-base and against the
 * candidate. `run(cwd, files)` is injectable so the mechanism can be tested
 * without running vitest inside vitest.
 */
export function redThenGreen(repoRoot, worktree, { base = 'main', run = vitest } = {}) {
  const mergeBase = git(worktree, ['merge-base', base, 'HEAD']);
  const { added, modified } = changedFiles(worktree, mergeBase);
  const newTests = [...added, ...modified].filter((f) => /\.(test|spec)\.(m?js|ts)$/.test(f));
  if (!newTests.length) return null;

  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-rtg-'));
  const checkout = path.join(probe, 'base');
  try {
    git(repoRoot, ['worktree', 'add', '--detach', checkout, mergeBase]);
    attachLinks(repoRoot, checkout);
    // The tests as the CANDIDATE wrote them, dropped onto the parent's code.
    for (const f of newTests) {
      const dst = path.join(checkout, f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(worktree, f), dst);
    }
    const red = run(checkout, newTests);
    if (red.ok) {
      return { ok: false, files: newTests, reason: 'the new tests already pass on the parent commit — they prove nothing' };
    }
    const green = run(worktree, newTests);
    if (!green.ok) {
      return { ok: false, files: newTests, reason: 'the new tests fail on the candidate itself' };
    }
    return { ok: true, files: newTests, reason: 'fail on parent, pass on candidate' };
  } finally {
    detachLinks(checkout);
    try {
      git(repoRoot, ['worktree', 'remove', '--force', checkout]);
    } catch {
      /* already gone */
    }
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

export function buildBundle(repoRoot, worktree, { ticket = {}, base = 'main', hot = new Set(), run } = {}) {
  const branch = git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commits = git(worktree, ['rev-list', '--reverse', `${base}..HEAD`]).split('\n').filter(Boolean);
  const files = changedFiles(worktree, base);
  const footprint = auditFootprint(files.all, ticket.footprint);
  const rtg = redThenGreen(repoRoot, worktree, { base, run });
  const { tier, reasons } = classifyTier({ ...files, footprint, redThenGreen: rtg, bounces: ticket.bounces ?? 0, hot });
  const stat = git(worktree, ['diff', '--shortstat', `${base}...HEAD`]);

  return {
    ticket: ticket.id ?? null,
    branch,
    commits,
    tier,
    tierReasons: reasons,
    footprintHonored: footprint.ok,
    footprintExtra: footprint.extra,
    files: { added: files.added, modified: files.modified, deleted: files.deleted },
    diffstat: stat,
    redThenGreen: rtg,
    revert: commits.length ? `git revert --no-edit ${commits[0]}^..${commits[commits.length - 1]}` : null,
  };
}
