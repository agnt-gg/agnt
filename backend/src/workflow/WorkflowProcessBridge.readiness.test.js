import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Startup readiness: a slow start is not a failed start.
 *
 * 2026-09-30: the child reported READY one second after fork, but the parent's
 * event loop was frozen for 37 s. When it thawed, Node ran the overdue 30 s
 * startup timer BEFORE reading the READY already waiting in the IPC pipe, the
 * spawn was declared failed, restartActiveWorkflows() never ran, and every
 * timer workflow stayed disarmed for the rest of the session.
 */

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock('child_process', () => ({ fork: forkMock, default: { fork: forkMock } }));

let children = [];

function makeChild() {
  const child = new EventEmitter();
  child.pid = 2000 + children.length;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.sent = [];
  child.send = vi.fn((message) => {
    child.sent.push(message);
    if (message.id !== undefined) queueMicrotask(() => child.emit('message', { id: message.id, success: true, data: {} }));
  });
  return child;
}

async function freshBridge() {
  vi.resetModules();
  return (await import('./WorkflowProcessBridge.js')).default;
}

const settledState = async (promise) => {
  let state = 'pending';
  promise.then(() => { state = 'resolved'; }, (e) => { state = `rejected: ${e.message}`; });
  await Promise.resolve();
  await Promise.resolve();
  return state;
};

beforeEach(() => {
  children = [];
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // These children do NOT report READY on their own; each test decides when.
  forkMock.mockImplementation(() => {
    const child = makeChild();
    children.push(child);
    return child;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  forkMock.mockReset();
});

describe('WorkflowProcessBridge startup readiness', () => {
  it('keeps waiting past 30 s instead of declaring a slow start failed', async () => {
    const bridge = await freshBridge();
    const ready = bridge.spawn();
    ready.catch(() => {});

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await settledState(ready)).toBe('pending');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('still waiting'));

    children[0].emit('message', { type: 'READY' });
    expect(await settledState(ready)).toBe('resolved');
    expect(bridge.isReady).toBe(true);
  });

  it('lets a READY already waiting in the pipe beat a deadline that fired first (the 2026-09-30 race)', async () => {
    const bridge = await freshBridge();
    const ready = bridge.spawn();
    ready.catch(() => {});

    // Run exactly the deadline timer, as a thawing event loop would, then
    // deliver the READY that was sitting in the pipe the whole time, before
    // the next check phase.
    vi.advanceTimersToNextTimer(); // 30 s warning
    vi.advanceTimersToNextTimer(); // 5 min deadline: failure is only SCHEDULED
    children[0].emit('message', { type: 'READY' });
    await vi.runAllTimersAsync();

    expect(await settledState(ready)).toBe('resolved');
    expect(bridge.isReady).toBe(true);
  });

  it('fails a start that never reports ready, then re-arms workflows exactly once if READY finally comes', async () => {
    const bridge = await freshBridge();
    const ready = bridge.spawn();
    ready.catch(() => {});

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(await settledState(ready)).toMatch(/rejected: .*did not report ready within 5 minutes/);
    expect(bridge.isReady).toBe(false);

    children[0].emit('message', { type: 'READY' });
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.isReady).toBe(true);
    const rearms = children[0].sent.filter((m) => m.type === 'RESTART_ACTIVE_WORKFLOWS');
    expect(rearms).toHaveLength(1);
    // Later callers must not trip over the old rejection.
    await expect(bridge.readyPromise).resolves.toBeUndefined();
  });

  it('fails at once, not after a timer, when the child exits before READY', async () => {
    const bridge = await freshBridge();
    const ready = bridge.spawn();
    ready.catch(() => {});

    children[0].stderr.emit('data', Buffer.from('Error: Cannot find module x\n'));
    children[0].emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(0);

    expect(await settledState(ready)).toMatch(/rejected: .*exited before it was ready/);
    // The crash is explained with the child's own last words, once.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Cannot find module x'));
  });

  it('is not fooled by a first message that is not READY', async () => {
    const bridge = await freshBridge();
    const ready = bridge.spawn();
    ready.catch(() => {});

    children[0].emit('message', { type: 'STATUS_UPDATE', data: { workflowId: 'w', status: {} } });
    children[0].emit('message', { type: 'READY' });

    expect(await settledState(ready)).toBe('resolved');
  });

  it('ignores a READY from a child that has been replaced', async () => {
    const bridge = await freshBridge();
    const first = bridge.spawn();
    first.catch(() => {});
    const stale = children[0];

    const second = bridge.spawn();
    second.catch(() => {});
    stale.emit('message', { type: 'READY' });

    expect(bridge.isReady).toBe(false);
    children[1].emit('message', { type: 'READY' });
    expect(await settledState(second)).toBe('resolved');
  });

  it('drains the child\u2019s stdout without re-logging it', async () => {
    const bridge = await freshBridge();
    const ready = bridge.spawn();
    ready.catch(() => {});
    const child = children[0];

    expect(child.stdout.listenerCount('data')).toBeGreaterThan(0);
    expect(child.stderr.listenerCount('data')).toBeGreaterThan(0);
    console.log.mockClear();
    child.stdout.emit('data', Buffer.from('[PluginManager] Registered plugin tool: x\n'));
    expect(console.log).not.toHaveBeenCalled();
  });
});
