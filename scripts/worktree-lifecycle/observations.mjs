import fs from 'node:fs/promises';
import path from 'node:path';
import {
  execFileSync
} from 'node:child_process';
import {
  parseStatus,
  parseWorktrees
} from './planning.mjs';
const within = (p, root) => p === root || p.startsWith(root + path.sep);
const vanished = e => ['ENOENT', 'ESRCH'].includes(e.code);
export function command(exe, args, cwd) {
  try {
    return execFileSync(exe, args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GH_PROMPT_DISABLED: '1',
        GH_HOST: 'github.com',
        GIT_TERMINAL_PROMPT: '0',
        GIT_NO_LAZY_FETCH: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: 12 * 1024 * 1024
    });
  } catch {
    throw new Error(`${exe} observation failed (nonzero exit, timeout or output limit)`);
  }
}
export async function scanLinks(worktrees, {
  io = fs,
  maxEntries = 180000,
  timeoutMs = 20000
} = {}) {
  const edges = [],
    errors = [];
  let entries = 0;
  const until = Date.now() + timeoutMs;
  const add = (consumer, target, link) => {
    for (const provider of worktrees)
      if (provider.path !== consumer.path && within(target, provider.path)) {
        let e = edges.find(e => e.consumer === consumer.path && e.provider === provider.path);
        if (!e) {
          e = {
            consumer: consumer.path,
            provider: provider.path,
            count: 0,
            examples: []
          };
          edges.push(e);
        }
        e.count++;
        if (e.examples.length < 3) e.examples.push(link);
      }
  };
  async function walk(dir, owner, mode = 'source', depth = 0) {
    if (++entries > maxEntries || Date.now() > until || depth > 16) throw new Error('link scan cap/deadline');
    for (const e of await io.readdir(dir, {
        withFileTypes: true
      })) {
      if (++entries > maxEntries || Date.now() > until) throw new Error('link scan cap/deadline');
      if (e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        const target = path.resolve(dir, await io.readlink(p));
        add(owner, target, p);
        try {
          const real = await io.realpath(p);
          if (real !== target) add(owner, real, p);
        } catch (e) {
          errors.push({
            path: p,
            reason: e.code ?? 'unresolved-link'
          });
        }
      } else if (e.isDirectory()) {
        if (e.name === 'node_modules') await walk(p, owner, 'packages', depth + 1);
        else if (mode === 'packages' && (e.name.startsWith('@') || e.name === '.bin')) await walk(p, owner,
          'entries', depth + 1);
        else if (mode === 'source' && !['dist', '.cache', '.vite', 'coverage', 'test-results', 'playwright-report',
            '.worktrees', '__pycache__'
          ].includes(e.name)) await walk(p, owner, 'source', depth + 1);
      }
    }
  }
  for (const w of worktrees) try {
    await walk(w.path, w);
  } catch (e) {
    errors.push({
      path: w.path,
      reason: e.code ?? 'scan-capped-or-failed'
    });
  }
  return {
    complete: errors.length === 0,
    entries,
    edges,
    errors,
    boundary: 'Registered worktrees only; generated dirs and dependency internals skipped; no external lease/hardlink/consumer proof'
  };
}
function processStart(text) {
  const start = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  if (!/^\d+$/.test(start ?? '')) throw new Error('Invalid process identity');
  return start;
}

export async function scanProcesses(worktrees, {
  io = fs,
  platform = process.platform,
  uid = process.getuid?.(),
  root = '/proc',
  timeoutMs = 20000,
  maxDescriptors = 200000,
  observerPid = process.pid
} = {}) {
  const hits = [],
    errors = [];
  let examined = 0,
    descriptors = 0;
  const until = Date.now() + timeoutMs;
  if (platform !== 'linux' || uid === undefined) return {
    complete: false,
    hits,
    errors: [{
      reason: 'process inspection unsupported'
    }]
  };
  const add = (pid, p, kind) => {
    for (const w of worktrees)
      if (within(p.replace(/ \(deleted\)$/, ''), w.path)) {
        if (!hits.some(h => h.pid === pid && h.path === w.path && h.kind === kind)) hits.push({
          pid,
          path: w.path,
          kind
        });
      }
  };
  try {
    for (const name of await io.readdir(root)) {
      if (!/^\d+$/.test(name)) continue;
      if (Date.now() > until) throw new Error('deadline');
      const p = path.join(root, name),
        pid = +name;
      try {
        if ((await io.stat(p)).uid !== uid) continue;
        examined++;
        const start = processStart(await io.readFile(p + '/stat', 'utf8'));
        const denied = [];
        for (const kind of ['cwd', 'exe']) try {
          add(pid, await io.readlink(p + '/' + kind), kind);
        } catch (e) {
          if (!vanished(e)) denied.push({
            kind,
            reason: e.code ?? 'unknown'
          });
        }
        try {
          const argv = await io.readFile(p + '/cmdline', 'utf8');
          for (const w of worktrees)
            if (pid !== observerPid && argv.includes(w.path)) add(pid, w.path, 'argv-reference');
        } catch (e) {
          if (!vanished(e)) denied.push({
            kind: 'argv',
            reason: e.code ?? 'unknown'
          });
        }
        try {
          for (const fd of await io.readdir(p + '/fd')) {
            if (++descriptors > maxDescriptors || Date.now() > until) throw new Error('process scan cap/deadline');
            try {
              add(pid, await io.readlink(p + '/fd/' + fd), 'fd');
            } catch (e) {
              if (!vanished(e) && !denied.some(d => d.kind === 'fdlink')) denied.push({
                kind: 'fdlink',
                reason: e.code ?? 'unknown'
              });
            }
          }
        } catch (e) {
          if (!vanished(e)) denied.push({
            kind: 'fd',
            reason: e.code ?? 'cap-or-unknown'
          });
        }
        if (start !== processStart(await io.readFile(p + '/stat', 'utf8'))) {
          denied.push({ kind: 'identity', reason: 'process-start-changed' });
        }
        if (denied.length) errors.push({
          pid,
          denied
        });
      } catch (e) {
        if (!vanished(e)) errors.push({
          pid,
          reason: e.code ?? 'unknown'
        });
      }
    }
  } catch (e) {
    errors.push({
      reason: e.code ?? 'process-scan-capped-or-failed'
    });
  }
  return {
    complete: errors.length === 0,
    hits,
    errors,
    examined,
    descriptors,
    boundary: 'same UID point-in-time; unreadable processes block; no cross-user/global ownership proof'
  };
}
export async function collect(o, {
  run = command,
  io = fs,
  processScan = scanProcesses,
  linkScan = scanLinks,
  timeoutMs = 90000,
  now = Date.now
} = {}) {
  const errors = [];
  const deadline = now() + timeoutMs;
  const observe = (exe, args, cwd) => {
    if (now() >= deadline) throw new Error('Observation deadline reached');
    return run(exe, args, cwd);
  };
  const git = (args, cwd = o.repo) => observe('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], cwd);
  const worktreeSnapshot = git(['worktree', 'list', '--porcelain', '-z']);
  const worktrees = parseWorktrees(worktreeSnapshot);
  try {
    const remote = git(['ls-remote', '--get-url', 'origin']).trim();
    const escapedRepo = o.github.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expected = new RegExp(`^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${escapedRepo}(?:\\.git)?/?$`, 'i');
    if (!expected.test(remote)) errors.push('origin does not match the explicit GitHub repository');
  } catch {
    errors.push('origin identity unavailable');
  }
  const originMain = git(['rev-parse', '--verify', 'refs/remotes/origin/main']).trim();
  let main = null;
  try {
    const head = git(['rev-parse', '--verify', 'refs/heads/main']).trim();
    const [behind, ahead] = git(['rev-list', '--left-right', '--count', originMain + '...' + head]).trim().split(
      /\s+/).map(Number);
    if (![behind, ahead].every(Number.isSafeInteger)) throw new Error();
    main = {
      head,
      behind,
      ahead
    };
  } catch {
    errors.push('main observation failed');
  }
  for (const w of worktrees) {
    w.status = [];
    w.ignored = [];
    w.patchEquivalent = null;
    try {
      w.status = parseStatus(git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], w.path));
      w.ignored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], w.path).split(
        '\0').filter(Boolean);
      for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
        const p = git(['rev-parse', '--git-path', marker], w.path).trim();
        try {
          await io.lstat(path.resolve(w.path, p));
          w.markers.push(marker);
        } catch (e) {
          if (!vanished(e)) throw e;
        }
      }
      const cherry = git(['cherry', originMain, w.head]).trim();
      if (cherry && !cherry.split('\n').every(l => /^[+-] [a-f0-9]{40,64}$/.test(l))) throw new Error(
        'Invalid cherry output');
      // git cherry ignores merge commits: a merge resolution can contain
      // unique work even when all ordinary patches are equivalent upstream.
      const uniqueMerges = git(['rev-list', '--merges', `${originMain}..${w.head}`]).trim();
      w.patchEquivalent = !uniqueMerges && !cherry.split('\n').some(l => l.startsWith('+'));
    } catch {
      errors.push(`worktree observation failed: ${w.path}`);
      w.markers.push('observation-incomplete');
    }
  }
  let prs = [],
    remoteMain = null,
    githubComplete = false;
  try {
    const data = JSON.parse(observe('gh', ['pr', 'list', '--repo', o.github, '--author', o.author, '--state', 'all',
      '--limit', '1000', '--json', 'number,title,state,mergedAt,headRefName,headRefOid,baseRefName,url'
    ], o.repo));
    if (!Array.isArray(data) || data.length >= 1000 || data.some(p => !Number.isSafeInteger(p.number) || !['OPEN',
          'CLOSED', 'MERGED'
        ].includes(p.state) || typeof p.headRefName !== 'string' || typeof p.baseRefName !== 'string' || typeof p
        .url !== 'string' || !/^[a-f0-9]{40,64}$/.test(p.headRefOid))) throw new Error();
    if (new Set(data.map(pr => pr.number)).size !== data.length) throw new Error('Duplicate PR records');
    prs = data;
    const r = JSON.parse(observe('gh', ['api', `repos/${o.github}/commits/main`, '--jq', '{sha:.sha}'], o.repo));
    if (!/^[a-f0-9]{40,64}$/.test(r.sha)) throw new Error();
    remoteMain = r.sha;
    githubComplete = true;
  } catch {
    errors.push('GitHub observation failed or incomplete');
  }
  const [processes, links] = await Promise.all([processScan(worktrees), linkScan(worktrees)]);
  try {
    if (git(['worktree', 'list', '--porcelain', '-z']) !== worktreeSnapshot) errors.push('worktree refs changed during observation');
    if (git(['rev-parse', '--verify', 'refs/remotes/origin/main']).trim() !== originMain) errors.push('upstream ref changed during observation');
    if (main && git(['rev-parse', '--verify', 'refs/heads/main']).trim() !== main.head) errors.push('main ref changed during observation');
  } catch {
    errors.push('final ref observation failed or deadline reached');
  }
  return {
    timestamp: new Date().toISOString(),
    repo: o.repo,
    github: o.github,
    author: o.author,
    base: o.base,
    originMain,
    remoteMain,
    main,
    worktrees,
    prs,
    githubComplete,
    errors,
    processes,
    links,
    boundaries: [processes.boundary, links.boundary,
      'No fetch, prune, ref/index writes, repo-file writes, permission changes or deletions; outside owner review mandatory'
    ]
  };
}
