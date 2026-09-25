/**
 * The workflow child must die with the backend, however the backend dies.
 *
 * Measured with real processes: a parent forks a child, the parent is killed
 * HARD (TerminateProcess on Windows, SIGKILL elsewhere), and the test watches
 * the child's pid. The negative control runs the same pair without the watch;
 * that child must survive, which proves the test can see an orphan at all.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countRunningWorkflows, exitWhenOrphaned } from './workflowProcessLifecycle.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PARENT = path.join(here, '__fixtures__', 'orphanParent.mjs');
const leftovers = [];

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function startPair(watch) {
  const parent = spawn(process.execPath, [PARENT], {
    env: { ...process.env, WATCH: watch ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  leftovers.push(parent.pid);
  const childPid = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('child never reported')), 15000);
    parent.stdout.on('data', (d) => {
      const m = /CHILD (\d+)/.exec(String(d));
      if (m) {
        clearTimeout(t);
        resolve(Number(m[1]));
      }
    });
  });
  leftovers.push(childPid);
  return { parent, childPid };
}

async function waitFor(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
});

describe('exitWhenOrphaned: real processes', () => {
  it('a watched child exits when its parent is killed hard', async () => {
    const { parent, childPid } = await startPair(true);
    expect(alive(childPid)).toBe(true);
    parent.kill('SIGKILL');
    expect(await waitFor(() => !alive(childPid), 8000)).toBe(true);
  }, 30000);

  it('NEGATIVE CONTROL: without the watch the child outlives its parent', async () => {
    const { parent, childPid } = await startPair(false);
    parent.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 2500));
    expect(alive(childPid)).toBe(true);
  }, 30000);
});

describe('exitWhenOrphaned: contract', () => {
  const quiet = { warn() {}, error() {} };
  function fakeProc() {
    const handlers = {};
    return { send() {}, once: (ev, fn) => (handlers[ev] = fn), fire: (ev) => handlers[ev]?.() };
  }

  it('is a no-op in a process that was not forked', () => {
    expect(exitWhenOrphaned({ once() {} }, { isShuttingDown: () => false, markShuttingDown() {}, release() {} })).toBe(false);
  });

  it('releases resources, then exits 0', async () => {
    const proc = fakeProc();
    const exits = [];
    let released = 0;
    let flagged = false;
    exitWhenOrphaned(proc, { isShuttingDown: () => flagged, markShuttingDown: () => (flagged = true), release: () => released++, exit: (c) => exits.push(c), graceMs: 10, log: quiet });
    proc.fire('disconnect');
    await new Promise((r) => setTimeout(r, 40));
    expect(released).toBe(1);
    expect(flagged).toBe(true);
    expect(exits).toEqual([0]);
  });

  it('leaves the exit to SHUTDOWN when a graceful shutdown already started', async () => {
    const proc = fakeProc();
    const exits = [];
    exitWhenOrphaned(proc, { isShuttingDown: () => true, markShuttingDown() {}, release() {}, exit: (c) => exits.push(c), graceMs: 10, log: quiet });
    proc.fire('disconnect');
    await new Promise((r) => setTimeout(r, 40));
    expect(exits).toEqual([]);
  });

  it('a throwing release still exits', async () => {
    const proc = fakeProc();
    const exits = [];
    exitWhenOrphaned(proc, { isShuttingDown: () => false, markShuttingDown() {}, release: () => { throw new Error('boom'); }, exit: (c) => exits.push(c), graceMs: 10, log: quiet });
    proc.fire('disconnect');
    await new Promise((r) => setTimeout(r, 40));
    expect(exits).toEqual([0]);
  });
});

describe('countRunningWorkflows', () => {
  it('counts engines executing or holding accepted triggers, not armed listeners', () => {
    const m = new Map([
      ['armed', { isRunning: false, triggerQueue: [] }],
      ['running', { isRunning: true, triggerQueue: [] }],
      ['queued', { isRunning: false, triggerQueue: [{}] }],
      ['bare', {}],
    ]);
    expect(countRunningWorkflows(m)).toBe(2);
    expect(countRunningWorkflows(new Map())).toBe(0);
  });
});
