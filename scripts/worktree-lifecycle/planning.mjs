import path from 'node:path';

export function parseWorktrees(text) {
  const rows = [];
  let w;
  for (const field of text.split('\0')) {
    if (!field) {
      if (w) {
        if (!w.head && !w.bare) throw new Error('Missing worktree HEAD');
        rows.push(w);
        w = null;
      }
      continue;
    }
    if (field.startsWith('worktree ')) {
      if (w) throw new Error('Missing worktree separator');
      w = {
        path: field.slice(9),
        head: null,
        branch: null,
        markers: []
      };
    } else if (!w) throw new Error('Invalid worktree record');
    else if (field.startsWith('HEAD ')) {
      w.head = field.slice(5);
      if (!/^[a-f0-9]{40,64}$/.test(w.head)) throw new Error('Invalid HEAD');
    } else if (field.startsWith('branch refs/heads/')) w.branch = field.slice(18);
    else if (field === 'bare') w.bare = true;
    else if (field === 'detached') continue;
    else if (/^(locked|prunable)( |$)/.test(field)) w.markers.push(field);
    else throw new Error('Unknown worktree field');
  }
  if (w || !text.endsWith('\0\0')) throw new Error('Unterminated worktree record');
  const paths = rows.map(row => row.path);
  if (paths.some(p => !path.isAbsolute(p)) || new Set(paths).size !== paths.length) {
    throw new Error('Worktree paths must be absolute and unique');
  }
  if (!rows.length) throw new Error('No worktrees');
  rows.forEach((r, i) => {
    r.primary = i === 0;
  });
  return rows;
}
export function parseStatus(text) {
  if (text && !text.endsWith('\0')) throw new Error('Unterminated status stream');
  const fields = text.split('\0'),
    rows = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    if (f.length < 4 || f[2] !== ' ') throw new Error('Invalid status record');
    const row = {
      code: f.slice(0, 2),
      path: f.slice(3)
    };
    if (/[RC]/.test(row.code)) {
      if (!fields[i + 1]) throw new Error('Missing rename path');
      row.originalPath = fields[++i];
    }
    rows.push(row);
  }
  return rows;
}
export function parseArgs(argv) {
  const [command, ...args] = argv;
  if (!['doctor', 'sync', 'retire'].includes(command)) throw new Error('Expected doctor, sync or retire');
  const o = {
    command,
    repo: process.cwd(),
    base: 'main'
  };
  const seen = new Set();
  const fields = new Map([
    ['--repo', 'repo'],
    ['--github', 'github'],
    ['--author', 'author'],
    ['--base', 'base'],
    ['--pr', 'pr'],
    ['--worktree', 'worktree']
  ]);
  while (args.length) {
    const f = args.shift();
    if (seen.has(f)) throw new Error('Duplicate option');
    seen.add(f);
    if (f === '--dry-run') {
      o.dryRun = true;
      continue;
    }
    const k = fields.get(f);
    if (!k || !args.length || args[0].startsWith('--')) throw new Error(
      'Unknown or missing option; read-only commands only');
    o[k] = args.shift();
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(o.github ?? '') || o.github.split('/').some(p => p === '.' || p ===
      '..')) throw new Error('Explicit owner/repo required');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(o.author ?? '')) throw new Error('Explicit GitHub author required');
  if (o.base !== 'main') throw new Error('Only main is supported in phase one');
  if (command !== 'doctor' && !o.dryRun) throw new Error('sync/retire require --dry-run; no executor installed');
  if (command === 'retire') {
    if (!/^[1-9]\d*$/.test(o.pr ?? '') || !Number.isSafeInteger(+o.pr) || !o.worktree) throw new Error(
      'Exact --pr and --worktree required');
    o.pr = +o.pr;
    o.worktree = path.resolve(o.worktree);
  } else if (o.pr || o.worktree) throw new Error('Target flags require retire');
  o.repo = path.resolve(o.repo);
  return o;
}
export function planLifecycle(s, o) {
  const blockers = [];
  if (s.errors.length) blockers.push('observation-errors');
  if (!s.githubComplete) blockers.push('github-observation-incomplete');
  if (!s.remoteMain || s.remoteMain !== s.originMain) blockers.push('upstream-ref-stale');
  if (!s.processes.complete) blockers.push('process-scan-incomplete');
  if (!s.links.complete) blockers.push('link-scan-incomplete');
  const targets = s.worktrees.map(w => {
    const exact = s.prs.filter(p => p.state === 'OPEN' && p.headRefOid === w.head && p.baseRefName === s.base);
    const active = s.processes.hits.some(p => p.path === w.path);
    const consumers = s.links.edges.filter(e => e.provider === w.path).map(e => e.consumer);
    const disposition = w.primary || active || w.status.length || w.markers.length ? 'PRESERVE' : exact.length ?
      'KEEP_ACTIVE' : 'INVESTIGATE';
    return {
      path: w.path,
      branch: w.branch,
      head: w.head,
      disposition,
      currentPRs: exact.map(p => p.number),
      activeProcess: active,
      consumers,
      status: w.status,
      ignored: w.ignored,
      markers: w.markers
    };
  });
  // Plans are advisory evidence, never an authorization or a deletion token.
  const result = {
    schemaVersion: 1,
    command: o.command,
    readOnly: true,
    authorized: false,
    canExecute: false,
    timestamp: s.timestamp,
    repo: s.repo,
    github: s.github,
    author: s.author,
    upstream: {
      local: s.originMain,
      remote: s.remoteMain
    },
    blockers,
    targets,
    boundaries: s.boundaries
  };
  if (o.command === 'retire') {
    const t = targets.find(t => t.path === o.worktree),
      w = s.worktrees.find(t => t.path === o.worktree),
      pr = s.prs.find(p => p.number === o.pr);
    result.targets = t ? [t] : [];
    result.pr = pr ?? {
      number: o.pr,
      state: 'UNKNOWN'
    };
    if (!t) blockers.push('target-not-registered');
    if (!pr || pr.state !== 'MERGED' || !pr.mergedAt) blockers.push('pr-not-merged');
    if (pr && pr.baseRefName !== s.base) blockers.push('pr-base-mismatch');
    if (t) {
      if (w.primary) blockers.push('primary-worktree');
      if (w.bare) blockers.push('bare-worktree');
      if (w.status.length) blockers.push('uncommitted-work');
      if (w.ignored.length) blockers.push('ignored-files-need-disposition');
      if (w.markers.length) blockers.push('operation-or-lock-active');
      if (t.activeProcess) blockers.push('active-process');
      if (t.consumers.length) blockers.push('dependency-provider');
      if (w.patchEquivalent !== true) blockers.push('patch-not-verified-upstream');
      if (pr && (w.branch ? w.branch !== pr.headRefName : w.head !== pr.headRefOid)) blockers.push(
      'pr-target-mismatch');
    }
    result.action = blockers.length ? 'BLOCKED' : 'NEEDS_OWNER_REVIEW';
    blockers.push('external-owner-and-consumer-review-required');
  } else if (o.command === 'sync') {
    if (!s.main) blockers.push('main-unavailable');
    else {
      if (s.main.ahead > 0) blockers.push('main-diverged');
      for (const t of targets.filter(t => t.branch === s.base)) {
        if (t.status.length || t.ignored.length || t.markers.length) blockers.push('main-worktree-not-clean');
        if (t.activeProcess) blockers.push('main-active-process');
      }
      result.main = {
        ...s.main,
        strategy: s.main.ahead > 0 ? 'stop-diverged' : s.main.behind === 0 ? 'already-current' : targets.some(t => t
          .branch === s.base) ? 'fast-forward-checkout-after-approval' : 'fast-forward-ref-after-approval'
      };
    }
    result.action = blockers.length ? 'BLOCKED' : 'PLAN_ONLY';
  } else result.action = 'REPORT_ONLY';
  return result;
}
