import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An unreachable workflow process must not be reported as a workflow state.
 *
 * `fetchWorkflowState` used to answer every IPC failure with
 * `{ status: 'error', error: error.message }`. That is wrong twice:
 *
 *   1. `'error'` is a REAL workflow status — ProcessWorker sets it on a
 *      workflow whose engine failed, and ProcessManager reads it back out of
 *      the database. So "I could not reach the workflow process" and "this
 *      workflow failed" arrived as the same value, and no caller could tell
 *      them apart.
 *   2. When the child answers `{ success: false, error }`, that message is a
 *      real diagnosis — e.g. `Workflow wf-1 cannot be executed: node "n1" is
 *      missing "text"`. It was replaced by the word `error` before any caller
 *      saw it, which is precisely why such failures were undiagnosable from
 *      the API.
 *
 * These tests pin the distinction: TRANSPORT failures throw
 * WorkflowProcessUnavailableError; a failure the child REPORTED throws a plain
 * Error still carrying the child's message.
 */

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock('child_process', () => ({ fork: forkMock, default: { fork: forkMock } }));
vi.mock('../services/auth/sessionTokenCache.js', () => ({
  subscribe: vi.fn(() => () => {}),
  getSessionToken: vi.fn(() => null),
  getSessionUserId: vi.fn(() => null),
}));

let children = [];

/** A child that acknowledges nothing unless a test tells it to. */
function makeChild() {
  const child = new EventEmitter();
  child.pid = 1000 + children.length;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
  });
  child.send = vi.fn();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

async function freshModule() {
  vi.resetModules();
  return import('./WorkflowProcessBridge.js');
}

/** Spawn a child and drive it to READY. */
async function spawnReady(bridge) {
  const p = bridge.spawn();
  await p;
  return children[children.length - 1];
}

beforeEach(() => {
  children = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  forkMock.mockImplementation(() => {
    const child = makeChild();
    children.push(child);
    queueMicrotask(() => child.emit('message', { type: 'READY' }));
    return child;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  forkMock.mockReset();
});

describe('transport failures are typed and named', () => {
  it('rejects with WorkflowProcessUnavailableError when nothing was ever spawned', async () => {
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();

    // The branch under test is `if (!this.workflowProcess)`; this is that state.
    bridge.workflowProcess = null;
    bridge.readyPromise = null;
    bridge.isReady = false;

    const error = await bridge.sendMessage('FETCH_WORKFLOW_STATE', {}).catch((e) => e);

    expect(error).toBeInstanceOf(WorkflowProcessUnavailableError);
    expect(error.code).toBe('WORKFLOW_PROCESS_UNAVAILABLE');
    expect(error.reason).toBe('not-spawned');
  });

  it('rejects with reason "not-ready" when the child exists but has not reported READY', async () => {
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();

    // The state after a child dies: the process object is still installed but
    // the exit handler has cleared isReady.
    bridge.workflowProcess = makeChild();
    bridge.readyPromise = null;
    bridge.isReady = false;

    const error = await bridge.sendMessage('FETCH_WORKFLOW_STATE', {}).catch((e) => e);

    expect(error).toBeInstanceOf(WorkflowProcessUnavailableError);
    expect(error.reason).toBe('not-ready');
  });

  it('rejects with reason "init-failed" when the ready promise rejected', async () => {
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();

    bridge.isReady = false;
    bridge.readyPromise = Promise.reject(new Error('spawn blew up'));
    // Keep the rejection from tripping the unhandled-rejection detector before
    // sendMessage awaits it.
    bridge.readyPromise.catch(() => {});

    const error = await bridge.sendMessage('FETCH_WORKFLOW_STATE', {}).catch((e) => e);

    expect(error).toBeInstanceOf(WorkflowProcessUnavailableError);
    expect(error.reason).toBe('init-failed');
    // The reason this whole change exists: do not drop the underlying error.
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.message).toBe('spawn blew up');
  });

  it('leaves cause undefined for the reasons that have no underlying error', async () => {
    const { WorkflowProcessUnavailableError } = await freshModule();
    const synthesised = new WorkflowProcessUnavailableError('Workflow process is not ready', 'not-ready');

    expect(synthesised.cause).toBeUndefined();
    expect('cause' in synthesised).toBe(false);
  });

  it('rejects with reason "timeout" when the child never answers', async () => {
    vi.useFakeTimers();
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();
    await spawnReady(bridge);

    // child.send is a no-op mock, so no reply ever arrives.
    const pending = bridge.sendMessage('FETCH_WORKFLOW_STATE', {}, 5000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5001);
    const error = await pending;

    expect(error).toBeInstanceOf(WorkflowProcessUnavailableError);
    expect(error.reason).toBe('timeout');
    expect(error.message).toContain('timed out');
  });
});

describe('a failure the child REPORTED is not a transport failure', () => {
  it('rejects with a plain Error that still carries the child\'s diagnosis', async () => {
    const { default: bridge, WorkflowProcessUnavailableError, isWorkflowProcessUnavailable } =
      await freshModule();
    const child = await spawnReady(bridge);

    const diagnosis = 'Workflow wf-1 cannot be executed:\n  - node "n1" is missing "text"';
    child.send.mockImplementation((message) => {
      queueMicrotask(() =>
        child.emit('message', { id: message.id, success: false, error: diagnosis })
      );
    });

    const error = await bridge.fetchWorkflowState('wf-1', 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    // The whole point: this must NOT be mistaken for an unreachable process.
    expect(error).not.toBeInstanceOf(WorkflowProcessUnavailableError);
    expect(isWorkflowProcessUnavailable(error)).toBe(false);
    // And the message survives all the way out, instead of becoming 'error'.
    expect(error.message).toBe(diagnosis);
  });
});

describe('fetchWorkflowState', () => {
  it('returns the state the child reported', async () => {
    const { default: bridge } = await freshModule();
    const child = await spawnReady(bridge);

    child.send.mockImplementation((message) => {
      queueMicrotask(() =>
        child.emit('message', {
          id: message.id,
          success: true,
          data: { status: 'listening', outputs: { n1: 1 }, errors: {} },
        })
      );
    });

    await expect(bridge.fetchWorkflowState('wf-1', 'user-1')).resolves.toEqual({
      status: 'listening',
      outputs: { n1: 1 },
      errors: {},
    });
  });

  it('throws instead of returning { status: "error" } when the process is unreachable', async () => {
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();

    bridge.workflowProcess = null;
    bridge.readyPromise = null;
    bridge.isReady = false;

    // The regression. This used to RESOLVE with { status: 'error' }, which is
    // indistinguishable from a workflow whose engine genuinely failed.
    const result = await bridge.fetchWorkflowState('wf-1', 'user-1').then(
      (value) => ({ resolved: value }),
      (error) => ({ rejected: error })
    );

    expect(result.resolved).toBeUndefined();
    expect(result.rejected).toBeInstanceOf(WorkflowProcessUnavailableError);
  });

  it('still logs the failure before rethrowing', async () => {
    const { default: bridge } = await freshModule();
    bridge.workflowProcess = null;
    bridge.readyPromise = null;
    bridge.isReady = false;

    await bridge.fetchWorkflowState('wf-1', 'user-1').catch(() => {});

    expect(console.error).toHaveBeenCalledWith(
      'Error fetching workflow state via IPC:',
      expect.any(Error)
    );
  });
});

describe('isWorkflowProcessUnavailable', () => {
  it('recognises the typed error', async () => {
    const { WorkflowProcessUnavailableError, isWorkflowProcessUnavailable } = await freshModule();
    expect(isWorkflowProcessUnavailable(new WorkflowProcessUnavailableError('x', 'timeout'))).toBe(
      true
    );
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['null', null],
    ['undefined', undefined],
  ])('does not misclassify %s', async (_label, value) => {
    const { isWorkflowProcessUnavailable } = await freshModule();
    expect(isWorkflowProcessUnavailable(value)).toBe(false);
  });

  it('matches on code rather than message text', async () => {
    // The route handler previously tested error.message.includes('not ready'),
    // which matched one of four transport failures and would break on a reword.
    const { isWorkflowProcessUnavailable } = await freshModule();
    const reworded = new Error('the workflow process is still warming up');
    reworded.code = 'WORKFLOW_PROCESS_UNAVAILABLE';
    expect(isWorkflowProcessUnavailable(reworded)).toBe(true);
  });
});
