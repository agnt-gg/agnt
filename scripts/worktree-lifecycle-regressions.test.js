import { it, expect } from 'vitest';
import { parseStatus, parseWorktrees, planLifecycle } from './worktree-lifecycle/planning.mjs';
import { collect, scanProcesses } from './worktree-lifecycle/observations.mjs';
import { runPlanner } from './worktree-lifecycle/cli.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const enoent = () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };
const complete = () => ({ complete: true, hits: [], edges: [], errors: [], boundary: 'fixture' });
function runner({ merges = false, remote = 'https://github.com/o/r.git', drift = false } = {}) {
  let seen = 0;
  return (exe, args) => {
    if (exe === 'gh') return args[0] === 'pr' ? '[]' : JSON.stringify({ sha: base });
    if (args.includes('--get-url')) return remote;
    if (args.includes('--porcelain')) return `worktree /repo\0HEAD ${++seen > 1 && drift ? base : head}\0branch refs/heads/feature\0\0`;
    if (args.includes('rev-parse')) {
      if (args.includes('--git-path')) return '/repo/.git/' + args.at(-1);
      if (args.includes('--show-toplevel')) return '/repo';
      return args.at(-1) === 'refs/heads/main' ? base : base;
    }
    if (args.includes('status') || args.includes('ls-files') || args.includes('cherry')) return '';
    if (args.includes('rev-list')) return args.includes('--merges') ? merges ? head + '\n' : '' : '0\t0';
    throw new Error('Unexpected fixture command');
  };
}
const options = { repo: '/repo', github: 'o/r', author: 'me', base: 'main' };
const dependencies = { io: { lstat: enoent }, processScan: complete, linkScan: complete };

it.each([' M file', 'R  new\0old'])('rejects truncated status stream %j', input => {
  expect(() => parseStatus(input)).toThrow();
});
it('rejects non-absolute or duplicate worktree paths', () => {
  expect(() => parseWorktrees(`worktree relative\0HEAD ${head}\0\0`)).toThrow();
  expect(() => parseWorktrees(`worktree /repo\0HEAD ${head}\0\0worktree /repo\0HEAD ${base}\0\0`)).toThrow();
});
it('unrepresented merge commits cannot be proved integrated by empty git cherry', async () => {
  const s = await collect(options, { ...dependencies, run: runner({ merges: true }) });
  expect(s.worktrees[0].patchEquivalent).toBe(false);
});
it('remote repository mismatch is an explicit blocker', async () => {
  const s = await collect(options, { ...dependencies, run: runner({ remote: 'https://github.com/other/repo.git' }) });
  expect(s.errors).toContain('origin does not match the explicit GitHub repository');
});
it('ref drift during collection invalidates the observation', async () => {
  const s = await collect(options, { ...dependencies, run: runner({ drift: true }) });
  expect(s.errors).toContain('worktree refs changed during observation');
});
it('process start identity change is incomplete', async () => {
  let statReads = 0;
  const io = {
    readdir: async p => p === '/proc' ? ['12'] : [],
    stat: async () => ({ uid: 1000 }),
    readlink: async () => '/unrelated',
    readFile: async p => p.endsWith('/stat') ? `12 (worker) S 1 ${Array(17).fill('0').join(' ')} ${++statReads} 0` : '',
  };
  const s = await scanProcesses([], { io, uid: 1000, platform: 'linux' });
  expect(s.complete).toBe(false);
});
it('help is offline and malformed flags never invoke collection', async () => {
  let observed = false;
  const output = [];
  const deps = { observe: async () => { observed = true; }, print: x => output.push(x) };
  expect(await runPlanner(['doctor', '--help'], deps)).toBe(0);
  expect(await runPlanner(['retire', '--force'], deps)).toBe(1);
  expect(observed).toBe(false);
});
it('doctor reports partial visibility with exit 2', async () => {
  const s = await collect(options, { ...dependencies, run: runner() });
  s.processes.complete = false;
  expect(await runPlanner(['doctor', '--github', 'o/r', '--author', 'me'], { observe: async () => s, print: () => {} })).toBe(2);
});
it('collection deadline stops admitting subprocesses', async () => {
  let calls = 0;
  await expect(collect(options, { ...dependencies, now: () => 0, timeoutMs: 0, run: () => { calls++; } })).rejects.toThrow(/deadline/);
  expect(calls).toBe(0);
});
it('duplicate GitHub PR records invalidate collection', async () => {
  const run = runner();
  const pr = { number: 1, state: 'MERGED', mergedAt: '2026-09-08T00:00:00Z', headRefName: 'feature', headRefOid: head, baseRefName: 'main', url: 'https://github.com/o/r/pull/1' };
  const s = await collect(options, { ...dependencies, run: (exe, args, cwd) => exe === 'gh' && args[0] === 'pr' ? JSON.stringify([pr, pr]) : run(exe, args, cwd) });
  expect(s.githubComplete).toBe(false);
});
it('hitting the PR enumeration cap is explicitly incomplete', async () => {
  const run = runner();
  const prs = Array.from({length: 1000}, (_, i) => ({number: i + 1, state: 'OPEN', headRefName: 'feature', headRefOid: head, baseRefName: 'main', url: `https://github.com/o/r/pull/${i + 1}`}));
  const s = await collect(options, { ...dependencies, run: (exe, args, cwd) => exe === 'gh' && args[0] === 'pr' ? JSON.stringify(prs) : run(exe, args, cwd) });
  expect(s.githubComplete).toBe(false);
});
it('CLI never relays collector exception contents', async () => {
  let output;
  const code = await runPlanner(['doctor', '--github', 'o/r', '--author', 'me'], { observe: async () => { throw new Error('private content'); }, print: x => { output = x; } });
  expect(code).toBe(1);
  expect(output).not.toContain('private content');
});
