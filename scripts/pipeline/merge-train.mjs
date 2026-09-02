/**
 * The merge train: one lane, strictly serial, fast-forward only.
 *
 * Agents work in parallel; they LAND in single file. For each candidate:
 *
 *   1. take the lock                  one landing at a time, ever
 *   2. rebase onto the trunk          conflicts surface here, in the worktree
 *   3. footprint audit                diff --name-only ⊆ the approved list
 *   4. impacted tests                 seconds
 *   5. full suite, in the worktree    the rebased tip IS the post-merge tip,
 *                                     because the merge is a fast-forward
 *   6. merge --ff-only                refusal = trunk moved during 4–5: go
 *                                     back to 2, at most three times
 *   7. reap the worktree              non-optional, runs on the happy path;
 *                                     a bounce keeps the worktree for repair
 *
 * A failure at any step is a BOUNCE, not an error: the ticket goes back with
 * the failure attached as new context. Never a human resolving an agent's
 * conflict — that is the bottleneck reappearing.
 *
 * The suites are injectable so the mechanism can be tested against a
 * throwaway repo in milliseconds. The defaults run the real ones.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { listWorktrees, removeWorktree, WORKTREES_DIR } from '../worktree.mjs';
import { auditFootprint, changedFiles } from './evidence.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * A bounce must name the failure, not the last 4 KB of stderr. Vitest prints
 * a "Failed Tests" section then the summary; keep that, drop the noise.
 */
export function failureDigest(raw, limit = 6000) {
  const text = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /Failed (Tests|Suites)|^\s*FAIL\s/.test(l));
  const body = (start === -1 ? lines : lines.slice(start)).filter((l) => !/^\s*(stderr|stdout) \|/.test(l));
  const digest = body.join('\n').trim();
  return digest.length > limit ? `${digest.slice(0, limit)}\n…[${digest.length - limit} more chars]` : digest;
}

function node(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  const raw = (r.stdout ?? '') + (r.stderr ?? '');
  return { ok: r.status === 0, output: r.status === 0 ? '' : failureDigest(raw) };
}

/** The files vitest reported as FAIL, repo-relative, for a targeted re-run. */
export function failedFiles(digest) {
  return [...new Set([...digest.matchAll(/^\s*FAIL\s+(\S+\.(?:test|spec)\.(?:m?js|ts))/gm)].map((m) => m[1].replace(/\\/g, '/')))];
}

/** Run just these files, alone. Frontend files run from frontend/. */
export const defaultRetry = (worktree, files) => {
  const bySide = { backend: files.filter((f) => !f.startsWith('frontend/')), frontend: files.filter((f) => f.startsWith('frontend/')) };
  for (const [side, list] of Object.entries(bySide)) {
    if (!list.length) continue;
    const cwd = side === 'frontend' ? path.join(worktree, 'frontend') : worktree;
    const r = node(cwd, [path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=dot', ...list.map((f) => path.relative(cwd, path.join(worktree, f)))]);
    if (!r.ok) return r;
  }
  return { ok: true, output: '' };
};

export const defaultImpacted = (worktree, base) => node(worktree, [path.join(worktree, 'scripts', 'test-impacted.mjs'), '--base', base]);

export const defaultFullSuite = (worktree) => {
  const backend = node(worktree, [path.join(worktree, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=dot']);
  if (!backend.ok) return { ok: false, output: `backend:\n${backend.output}` };
  const frontendDir = path.join(worktree, 'frontend');
  const frontend = node(frontendDir, [path.join(frontendDir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=dot']);
  return frontend.ok ? { ok: true, output: '' } : { ok: false, output: `frontend:\n${frontend.output}` };
};

/* ───────────── lock ───────────── */

export function withTrainLock(repoRoot, fn) {
  const lock = path.join(repoRoot, '.git', 'agnt-merge-train.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`the merge train is already running (${fs.readFileSync(lock, 'utf8').trim()}); if that process is dead, delete ${lock}`);
    }
    throw err;
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

/* ───────────── the train ───────────── */

const bounce = (step, detail, extra = {}) => ({ status: 'bounced', step, detail, ...extra });

export function land(
  repoRoot,
  slug,
  { footprint = null, base = 'main', impacted = defaultImpacted, fullSuite = defaultFullSuite, retry = defaultRetry, maxAttempts = 3, log = () => {} } = {},
) {
  const worktree = path.join(repoRoot, WORKTREES_DIR, slug);
  const flaky = [];
  /**
   * A suite that fails under a loaded box and passes alone is contention,
   * not a defect — measured here: 350/350 green, then a bounce, then 350/350
   * again. Bouncing on that teaches everyone to ignore the train. So the
   * failed files get one run ALONE; if they pass, the land proceeds and the
   * flake is RECORDED in the result, never hidden. If they fail alone, it
   * was real, and the bounce carries that second run's output.
   */
  const gate = (step, result) => {
    if (result.ok) return null;
    const files = failedFiles(result.output);
    if (!files.length) return bounce(step, result.output);
    log(`[train] ${step}: ${files.length} file(s) failed under load; re-running alone`);
    const again = retry(worktree, files);
    if (!again.ok) return bounce(step, again.output, { failedAlone: files });
    flaky.push(...files);
    return null;
  };
  return withTrainLock(repoRoot, () => {
    const entry = listWorktrees(repoRoot).find((w) => path.resolve(w.path).toLowerCase() === path.resolve(worktree).toLowerCase());
    if (!entry) throw new Error(`${slug} is not a registered worktree`);
    const branch = entry.branch;
    if (!branch) throw new Error(`${slug} is detached; the train lands branches`);

    // The worktree directory itself is never "dirt", whether or not .gitignore says so.
    const primaryDirt = git(repoRoot, ['status', '--porcelain'])
      .split('\n')
      .filter((l) => l && !l.slice(3).startsWith(`${WORKTREES_DIR}/`));
    if (primaryDirt.length) throw new Error(`the primary checkout is dirty; the train will not land onto it:\n${primaryDirt.join('\n')}`);
    if (git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) !== base) throw new Error(`the primary checkout is not on ${base}`);
    if (git(worktree, ['status', '--porcelain'])) return bounce('dirty', `${slug} has uncommitted changes`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log(`[train] ${slug} attempt ${attempt}: rebase onto ${base}`);
      try {
        git(worktree, ['rebase', base]);
      } catch (err) {
        try {
          git(worktree, ['rebase', '--abort']);
        } catch {
          /* nothing to abort */
        }
        return bounce('rebase', `conflict rebasing ${branch} onto ${base}:\n${String(err.stderr ?? err.message).slice(-2000)}`);
      }

      const files = changedFiles(worktree, base);
      if (!files.all.length) return { status: 'empty', detail: `${branch} has no changes relative to ${base}` };
      const audit = auditFootprint(files.all, footprint);
      if (footprint && !audit.ok) {
        return bounce('footprint', `touched files outside the approved footprint: ${audit.extra.join(', ')}`, { extra: audit.extra });
      }

      log(`[train] ${slug}: impacted tests`);
      const quickBounce = gate('impacted', impacted(worktree, base));
      if (quickBounce) return quickBounce;

      log(`[train] ${slug}: full suite on the rebased tip`);
      const fullBounce = gate('suite', fullSuite(worktree));
      if (fullBounce) return fullBounce;

      const tip = git(worktree, ['rev-parse', 'HEAD']);
      try {
        git(repoRoot, ['merge', '--ff-only', branch]);
      } catch {
        log(`[train] ${slug}: ${base} moved during testing; retrying`);
        continue; // stale — the loop rebases again
      }

      log(`[train] ${slug}: landed ${tip.slice(0, 8)}; reaping`);
      const reaped = removeWorktree(repoRoot, slug);
      return { status: 'landed', sha: tip, branch, files: files.all, attempts: attempt, reaped: reaped.branchDeleted, flaky: [...new Set(flaky)] };
    }
    return bounce('stale', `${base} moved under ${branch} ${maxAttempts} times in a row`);
  });
}
