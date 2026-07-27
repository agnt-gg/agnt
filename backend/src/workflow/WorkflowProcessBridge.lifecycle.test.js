import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Workflow-process lifecycle invariants.
 *
 * The bridge owns exactly one child process, but three independent callers can
 * race for it: a manual restart, the child's own 'exit' handler, and the
 * force-kill timer armed by a previous shutdown. Every bug fixed here was a
 * variant of the same root cause — a handler that re-read `this.workflowProcess`
 * at FIRE time instead of binding the process it was created for.
 *
 * The headline failure: shutdown() armed a 5s force-kill that re-read the field,
 * restart() replaced that field ~1.6s later, and the timer then SIGKILLed the
 * healthy replacement. Signal deaths report `code === null`, which the old
 * auto-restart guard (`code !== 0 && code !== null`) skipped — so nothing ever
 * came back. Every workflow stayed dead until AGNT was restarted, silently.
 */

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock('child_process', () => ({ fork: forkMock, default: { fork: forkMock } }));

/** Kill events observed across all children, in order. */
let killLog = [];
/** Every child the bridge has forked, oldest first. */
let children = [];
let childSeq = 0;

function makeChild() {
  const child = new EventEmitter();
  child.pid = 1000 + ++childSeq;
  child.seq = childSeq;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  child.kill = vi.fn((signal) => {
    child.killed = true;
    killLog.push({ seq: child.seq, signal });
  });

  // Ack every IPC request on the microtask queue so `await` flushes it without
  // needing timer advancement.
  child.send = vi.fn((message) => {
    queueMicrotask(() => child.emit('message', { id: message.id, success: true, data: {} }));
  });

  /** Simulate the OS reaping the process. */
  child.simulateExit = (code, signal) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
  };

  return child;
}

async function freshBridge() {
  vi.resetModules();
  const mod = await import('./WorkflowProcessBridge.js');
  return mod.default;
}

/** Spawn and drive the child to READY. */
async function spawnReady(bridge) {
  const p = bridge.spawn();
  await p;
  return children[children.length - 1];
}

beforeEach(() => {
  killLog = [];
  children = [];
  childSeq = 0;
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  forkMock.mockImplementation(() => {
    const child = makeChild();
    children.push(child);
    // The bridge registers its READY listener synchronously right after fork
    // returns, so a microtask is late enough to be observed.
    queueMicrotask(() => child.emit('message', { type: 'READY' }));
    return child;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  forkMock.mockReset();
});

describe('WorkflowProcessBridge lifecycle', () => {
  it('force-kills only the process shutdown() was asked to stop, never its replacement', async () => {
    const bridge = await freshBridge();
    const first = await spawnReady(bridge);

    // The child never acknowledges its own death, so the 5s force-kill timer
    // armed by shutdown() WILL fire. Meanwhile restart() installs a fresh child.
    await bridge.restart();

    const second = children[1];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(bridge.workflowProcess).toBe(second);

    // Let every pending force-kill timer fire.
    await vi.advanceTimersByTimeAsync(10000);

    expect(killLog).toEqual([{ seq: 1, signal: 'SIGKILL' }]);
    expect(first.killed).toBe(true);
    expect(second.killed).toBe(false);
    expect(bridge.workflowProcess).toBe(second);
  });

  it('cancels the force-kill when the child exits gracefully during the SHUTDOWN round-trip', async () => {
    const bridge = await freshBridge();
    const child = await spawnReady(bridge);

    // Exit lands while the SHUTDOWN ack is still in flight — the exact window
    // where a listener attached in a `finally` block would arrive too late.
    child.send = vi.fn((message) => {
      queueMicrotask(() => {
        child.simulateExit(0, null);
        child.emit('message', { id: message.id, success: true, data: {} });
      });
    });

    await bridge.shutdown();
    await vi.advanceTimersByTimeAsync(10000);

    expect(killLog).toEqual([]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('auto-restarts after a signal death (code === null), which the old guard skipped', async () => {
    const bridge = await freshBridge();
    const child = await spawnReady(bridge);

    expect(forkMock).toHaveBeenCalledTimes(1);

    // OOM-killer / external SIGKILL: no exit code, only a signal.
    child.simulateExit(null, 'SIGKILL');

    await vi.advanceTimersByTimeAsync(6000);

    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(bridge.workflowProcess).toBe(children[1]);
  });

  it('auto-restarts after a non-zero exit code', async () => {
    const bridge = await freshBridge();
    const child = await spawnReady(bridge);

    child.simulateExit(1, null);
    await vi.advanceTimersByTimeAsync(6000);

    expect(forkMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT auto-restart an exit that shutdown() deliberately caused', async () => {
    const bridge = await freshBridge();
    const child = await spawnReady(bridge);

    await bridge.shutdown();
    // Force-kill path: signal death, but planned. The tag must win over the
    // signal rule, or every graceful shutdown would resurrect itself.
    child.simulateExit(null, 'SIGKILL');

    await vi.advanceTimersByTimeAsync(20000);

    expect(forkMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-restart a clean exit', async () => {
    const bridge = await freshBridge();
    const child = await spawnReady(bridge);

    child.simulateExit(0, null);
    await vi.advanceTimersByTimeAsync(20000);

    expect(forkMock).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent restarts into one, so triggers are never armed twice', async () => {
    const bridge = await freshBridge();
    await spawnReady(bridge);

    // The 'exit' auto-restart and a manual restart firing together.
    const a = bridge.restart();
    const b = bridge.restart();
    await Promise.all([a, b]);

    // 1 initial spawn + exactly 1 restart spawn. Two would mean two live
    // workflow processes both listening on every trigger.
    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(children).toHaveLength(2);
    expect(bridge.restartPromise).toBeNull();
  });

  it('allows a fresh restart once the previous one has settled', async () => {
    const bridge = await freshBridge();
    await spawnReady(bridge);

    await bridge.restart();
    await bridge.restart();

    expect(forkMock).toHaveBeenCalledTimes(3);
  });

  it('ignores a late exit from a superseded process', async () => {
    const bridge = await freshBridge();
    const first = await spawnReady(bridge);

    await bridge.restart();
    expect(bridge.isReady).toBe(true);

    // The old process finally dies, long after being replaced.
    first.simulateExit(null, 'SIGKILL');

    expect(bridge.isReady).toBe(true);
    expect(bridge.workflowProcess).toBe(children[1]);

    // ...and it must not trigger yet another restart.
    await vi.advanceTimersByTimeAsync(20000);
    expect(forkMock).toHaveBeenCalledTimes(2);
  });

  it('shutdown() on an already-dead child arms no timer at all', async () => {
    const bridge = await freshBridge();
    const child = await spawnReady(bridge);

    child.simulateExit(0, null);
    await bridge.shutdown();
    await vi.advanceTimersByTimeAsync(10000);

    expect(killLog).toEqual([]);
  });
});
