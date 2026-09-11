import {
  it as test,
  afterAll
} from 'vitest';
import assert from 'node:assert/strict';
import {
  parseArgs,
  parseWorktrees,
  parseStatus,
  planLifecycle
} from './worktree-lifecycle/planning.mjs';
const sha = 'a'.repeat(40),
  base = 'b'.repeat(40);

function sample() {
  return {
    timestamp: '2026-09-09T00:00:00Z',
    repo: '/repo',
    github: 'o/r',
    author: 'me',
    base: 'main',
    errors: [],
    boundaries: ['external leases not verified'],
    githubComplete: true,
    originMain: base,
    remoteMain: base,
    main: {
      head: sha,
      behind: 2,
      ahead: 0
    },
    processes: {
      complete: true,
      hits: [],
      errors: []
    },
    links: {
      complete: true,
      edges: [],
      errors: []
    },
    prs: [{
      number: 1,
      state: 'MERGED',
      headRefName: 'feat/x',
      headRefOid: sha,
      baseRefName: 'main',
      mergedAt: '2026-09-08',
      url: 'https://github.com/o/r/pull/1'
    }],
    worktrees: [{
      path: '/repo',
      head: base,
      branch: 'integration',
      primary: true,
      status: [],
      ignored: [],
      markers: [],
      patchEquivalent: true
    }, {
      path: '/wt x',
      head: sha,
      branch: 'feat/x',
      primary: false,
      status: [],
      ignored: [],
      markers: [],
      patchEquivalent: true
    }]
  };
}
const opts = {
  command: 'retire',
  pr: 1,
  worktree: '/wt x'
};
test('NUL worktree parser preserves spaces/newlines without quote ambiguity', () => {
  const rows = parseWorktrees(
    `worktree /repo\0HEAD ${base}\0branch refs/heads/main\0\0worktree /wt\nspace\0HEAD ${sha}\0detached\0locked owner\0\0`
    );
  assert.equal(rows[1].path, '/wt\nspace');
  assert.equal(rows[1].branch, null);
  assert.deepEqual(rows[1].markers, ['locked owner']);
});
test('porcelain NUL rename and untracked paths parse exactly', () => {
  assert.deepEqual(parseStatus('R  new name\0old name\0?? file\nname\0'), [{
    code: 'R ',
    path: 'new name',
    originalPath: 'old name'
  }, {
    code: '??',
    path: 'file\nname'
  }]);
});
test('reject malformed worktree records', () => assert.throws(() => parseWorktrees('HEAD x\0\0')));
test('reject incomplete rename', () => assert.throws(() => parseStatus('R  new\0')));
test('strict required GitHub and author options', () => assert.throws(() => parseArgs(['doctor'])));
test('parse explicit read-only target', () => assert.deepEqual(parseArgs(['retire', '--repo', '/repo', '--github',
  'o/r', '--author', 'me', '--pr', '1', '--worktree', '/wt x', '--dry-run'
]), {
  command: 'retire',
  repo: '/repo',
  github: 'o/r',
  author: 'me',
  base: 'main',
  pr: 1,
  worktree: '/wt x',
  dryRun: true
}));
for (const args of [
    ['sync', '--execute'],
    ['retire', '--force'],
    ['doctor', '--token', 'secret'],
    ['doctor', '--github', '../x', '--author', 'a'],
    ['doctor', '--github', 'o/r', '--github', 'a/b', '--author', 'a'],
    ['retire', '--github', 'o/r', '--author', 'a', '--pr', 'NaN'],
    ['sync', '--github', 'o/r', '--author', 'a'],
    ['doctor', '--github', 'o/r', '--author', 'a', '--pr', '1']
  ]) test('reject args ' + JSON.stringify(args), () => assert.throws(() => parseArgs(args)));
test('merged clean worktree remains human-review only, not authorized', () => {
  const p = planLifecycle(sample(), opts);
  assert.equal(p.action, 'NEEDS_OWNER_REVIEW');
  assert.equal(p.authorized, false);
  assert.equal(p.canExecute, false);
  assert.ok(p.blockers.includes('external-owner-and-consumer-review-required'));
  assert.equal(p.targets[0].head, sha);
});
for (const [name, mutate, reason] of [
    ['open PR', s => s.prs[0].state = 'OPEN', 'pr-not-merged'],
    ['dirty', s => s.worktrees[1].status = [{
      code: ' M',
      path: 'x'
    }], 'uncommitted-work'],
    ['untracked', s => s.worktrees[1].status = [{
      code: '??',
      path: 'x'
    }], 'uncommitted-work'],
    ['ignored', s => s.worktrees[1].ignored = ['dist/'], 'ignored-files-need-disposition'],
    ['markers', s => s.worktrees[1].markers = ['MERGE_HEAD'], 'operation-or-lock-active'],
    ['process', s => s.processes.hits = [{
      pid: 1,
      path: '/wt x'
    }], 'active-process'],
    ['unreadable process', s => s.processes.complete = false, 'process-scan-incomplete'],
    ['dependent', s => s.links.edges = [{
      consumer: '/consumer',
      provider: '/wt x'
    }], 'dependency-provider'],
    ['link scan capped', s => s.links.complete = false, 'link-scan-incomplete'],
    ['unmerged patch', s => s.worktrees[1].patchEquivalent = false, 'patch-not-verified-upstream'],
    ['GH incomplete', s => s.githubComplete = false, 'github-observation-incomplete'],
    ['fetch needed', s => s.remoteMain = 'c'.repeat(40), 'upstream-ref-stale'],
    ['new local branch', s => s.worktrees[1].branch = 'feat/y', 'pr-target-mismatch'],
    ['observation error', s => s.errors.push('Git failed'), 'observation-errors'],
    ['PR wrong base', s => s.prs[0].baseRefName = 'other', 'pr-base-mismatch'],
  ]) test(name + ' blocks retirement', () => {
  const s = sample();
  mutate(s);
  assert.ok(planLifecycle(s, opts).blockers.includes(reason));
  assert.equal(planLifecycle(s, opts).canExecute, false);
});
test('primary checkout cannot be retired', () => {
  const p = planLifecycle(sample(), {
    ...opts,
    worktree: '/repo'
  });
  assert.ok(p.blockers.includes('primary-worktree'));
});
test('unknown target not silently selected', () => assert.ok(planLifecycle(sample(), {
  ...opts,
  worktree: '/missing'
}).blockers.includes('target-not-registered')));
test('doctor labels only exact OPEN PR heads active', () => {
  const s = sample();
  s.prs[0].state = 'OPEN';
  assert.equal(planLifecycle(s, {
    command: 'doctor'
  }).targets[1].disposition, 'KEEP_ACTIVE');
  s.prs[0].headRefOid = base;
  assert.equal(planLifecycle(s, {
    command: 'doctor'
  }).targets[1].disposition, 'INVESTIGATE');
});
test('sync reports ff path but no execution', () => {
  const p = planLifecycle(sample(), {
    command: 'sync'
  });
  assert.equal(p.main.strategy, 'fast-forward-ref-after-approval');
  assert.equal(p.canExecute, false);
});
test('sync refuses divergence', () => {
  const s = sample();
  s.main.ahead = 1;
  assert.ok(planLifecycle(s, {
    command: 'sync'
  }).blockers.includes('main-diverged'));
});
test('sync refuses dirty checked-out main', () => {
  const s = sample();
  s.worktrees[0].branch = 'main';
  s.worktrees[0].status = [{
    code: '??',
    path: 'x'
  }];
  assert.ok(planLifecycle(s, {
    command: 'sync'
  }).blockers.includes('main-worktree-not-clean'));
});
test('sync refuses live checked-out main', () => {
  const s = sample();
  s.worktrees[0].branch = 'main';
  s.processes.hits = [{
    pid: 1,
    path: '/repo'
  }];
  assert.ok(planLifecycle(s, {
    command: 'sync'
  }).blockers.includes('main-active-process'));
});
test('unchanged main needs no update', () => {
  const s = sample();
  s.main = {
    head: base,
    ahead: 0,
    behind: 0
  };
  assert.equal(planLifecycle(s, {
    command: 'sync'
  }).main.strategy, 'already-current');
});
test('missing main is not invented', () => {
  const s = sample();
  s.main = null;
  assert.ok(planLifecycle(s, {
    command: 'sync'
  }).blockers.includes('main-unavailable'));
});
