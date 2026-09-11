import {
  it as test,
  afterAll
} from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  execFileSync
} from 'node:child_process';
import {
  collect,
  scanLinks,
  scanProcesses
} from './worktree-lifecycle/observations.mjs';
const fixtures = [];
const temp = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-lifecycle-'));
  fixtures.push(dir);
  return dir;
};
afterAll(async () => {
  for (const dir of fixtures) await fs.rm(dir, {
    recursive: true,
    force: true
  });
});
const complete = () => ({
  complete: true,
  hits: [],
  edges: [],
  errors: [],
  boundary: 'fixture only'
});

function procIO(denied = false) {
  const fail = Object.assign(new Error('Denied'), {
    code: 'EACCES'
  });
  return {
    readdir: async p => p === '/proc' ? ['11'] : ['3'],
    stat: async () => ({
      uid: 1000
    }),
    readlink: async p => {
      if (denied) throw fail;
      return p.endsWith('exe') ? '/bin/node' : '/wt/sub/file';
    },
    readFile: async p => p.endsWith('/stat') ? `11 (worker) S 1 ${Array(17).fill('0').join(' ')} 100 0` : '/bin/node\0/wt/server.js\0'
  };
}
test('process hits bound to exact worktree paths', async () => {
  const r = await scanProcesses([{
    path: '/wt'
  }], {
    io: procIO(),
    platform: 'linux',
    uid: 1000
  });
  assert.equal(r.complete, true);
  assert.ok(r.hits.length);
  assert.ok(r.hits.every(h => h.path === '/wt' && h.pid === 11));
});
test('observer own argv is excluded but its cwd/fds still protect a tree', async () => {
  const r = await scanProcesses([{
    path: '/wt'
  }], {
    io: procIO(),
    platform: 'linux',
    uid: 1000,
    observerPid: 11
  });
  assert.ok(!r.hits.some(h => h.kind === 'argv-reference'));
  assert.ok(r.hits.some(h => h.kind === 'cwd'));
  assert.ok(r.hits.some(h => h.kind === 'fd'));
});
test('EACCES is incomplete not a clean scan', async () => {
  const r = await scanProcesses([{
    path: '/wt'
  }], {
    io: procIO(true),
    platform: 'linux',
    uid: 1000
  });
  assert.equal(r.complete, false);
  assert.ok(r.errors.length);
});
test('unsupported OS reports unknown', async () => assert.equal((await scanProcesses([], {
  platform: 'darwin'
})).complete, false));
test('descriptor cap cannot look like complete scan', async () => assert.equal((await scanProcesses([], {
  io: procIO(),
  platform: 'linux',
  uid: 1000,
  maxDescriptors: 0
})).complete, false));
test('process traversal disappearing is tolerated', async () => {
  const io = procIO();
  io.stat = async () => {
    throw Object.assign(new Error(), {
      code: 'ENOENT'
    });
  };
  assert.equal((await scanProcesses([], {
    io,
    platform: 'linux',
    uid: 1000
  })).complete, true);
});
test('link scanning includes lexical provider even when resolved provider differs', async () => {
  const dir = await temp();
  for (const p of ['consumer/node_modules', 'middle', 'provider/pkg']) await fs.mkdir(path.join(dir, p), {
    recursive: true
  });
  await fs.symlink(dir + '/provider', dir + '/middle/node_modules');
  await fs.symlink(dir + '/middle/node_modules/pkg', dir + '/consumer/node_modules/pkg');
  const r = await scanLinks(['consumer', 'middle', 'provider'].map(p => ({
    path: dir + '/' + p
  })));
  assert.equal(r.complete, true);
  assert.ok(r.edges.some(e => e.consumer === dir + '/consumer' && e.provider === dir + '/middle'));
  assert.ok(r.edges.some(e => e.consumer === dir + '/consumer' && e.provider === dir + '/provider'));
});
test('broken links and caps report incomplete', async () => {
  const dir = await temp();
  await fs.symlink(dir + '/absent', dir + '/broken');
  assert.equal((await scanLinks([{
    path: dir
  }])).complete, false);
  assert.equal((await scanLinks([{
    path: dir
  }], {
    maxEntries: 0
  })).complete, false);
});
test('real Git read-only collection preserves refs/index/status and does not invoke mutators', async () => {
  const dir = await temp();
  const git = (args) => execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['remote', 'add', 'origin', 'https://github.com/o/r.git']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  await fs.writeFile(dir + '/tracked.txt', 'fixture\n');
  git(['add', 'tracked.txt']);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']).trim();
  git(['update-ref', 'refs/remotes/origin/main', sha]);
  const before = await fs.readFile(dir + '/.git/index'),
    refs = git(['show-ref']);
  const calls = [];
  const run = (exe, args, cwd) => {
    calls.push({
      exe,
      args
    });
    if (exe === 'gh') return args[0] === 'pr' ? '[]' : JSON.stringify({
      sha
    });
    return execFileSync(exe, args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  };
  const o = {
    repo: dir,
    github: 'o/r',
    author: 'me',
    base: 'main'
  };
  const s = await collect(o, {
    run,
    processScan: complete,
    linkScan: complete
  });
  assert.equal(s.errors.length, 0);
  assert.equal(s.worktrees.length, 1);
  assert.equal(s.worktrees[0].patchEquivalent, true);
  assert.deepEqual(await fs.readFile(dir + '/.git/index'), before);
  assert.equal(git(['show-ref']), refs);
  assert.equal(git(['status', '--porcelain']), '');
  assert.ok(!calls.some(c => c.args.some(x => ['fetch', 'prune', 'merge', 'reset', 'update-ref', 'write-tree',
    'checkout', 'switch', 'clean'
  ].includes(x))));
  const failed = await collect(o, {
    run: (exe, args, cwd) => {
      if (exe === 'gh') throw new Error('secret stderr must not leak');
      return run(exe, args, cwd);
    },
    processScan: complete,
    linkScan: complete
  });
  assert.equal(failed.githubComplete, false);
  assert.ok(!JSON.stringify(failed).includes('secret stderr'));
  const invalid = await collect(o, {
    run: (exe, args, cwd) => exe === 'gh' ? '{}' : run(exe, args, cwd),
    processScan: complete,
    linkScan: complete
  });
  assert.equal(invalid.githubComplete, false);
});
