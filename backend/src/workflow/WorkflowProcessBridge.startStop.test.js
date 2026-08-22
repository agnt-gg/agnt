import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A start that did not happen must not be reported as one.
 *
 * `activateWorkflow` and `deactivateWorkflow` used to answer every IPC failure
 * with `return { error: error.message }`. The route handler passes the result
 * straight to `res.json(result)`, and `res.json` with no status is 200 — so a
 * failed start answered SUCCESS with an error-shaped body.
 *
 * Every caller gates on the status code, not the body:
 *
 *   WorkflowEngine.vue:268   if (!response.ok) throw ...
 *   Workflows.vue:910,933    if (!response.ok) throw ...
 *   agnt.js SDK              axios, which rejects on non-2xx
 *
 * `response.ok` was true, so none of those failure branches ran. The UI said
 * the workflow started. Nothing was armed, no trigger was listening, and the
 * only trace was a console.error in the backend log.
 *
 * This is the same defect fixed for fetchWorkflowState, in a worse place: that
 * one corrupted a status read, these corrupt the Start and Stop buttons.
 */

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock('child_process', () => ({ fork: forkMock, default: { fork: forkMock } }));
vi.mock('../services/auth/sessionTokenCache.js', () => ({
  subscribe: vi.fn(() => () => {}),
  getSessionToken: vi.fn(() => null),
  getSessionUserId: vi.fn(() => null),
}));

let children = [];

function makeChild() {
  const child = new EventEmitter();
  child.pid = 2000 + children.length;
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

async function spawnReady(bridge) {
  await bridge.spawn();
  return children[children.length - 1];
}

/** Put the bridge in the state it holds when no child was ever forked. */
function makeUnreachable(bridge) {
  bridge.workflowProcess = null;
  bridge.readyPromise = null;
  bridge.isReady = false;
}

const workflow = { id: 'wf-1', nodes: [], edges: [] };

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

describe('activateWorkflow', () => {
  it('returns what the child reported when the start succeeds', async () => {
    const { default: bridge } = await freshModule();
    const child = await spawnReady(bridge);

    child.send.mockImplementation((message) => {
      queueMicrotask(() =>
        child.emit('message', {
          id: message.id,
          success: true,
          data: { message: 'Workflow queued for execution', workflowId: 'wf-1' },
        })
      );
    });

    await expect(bridge.activateWorkflow(workflow, 'user-1')).resolves.toEqual({
      message: 'Workflow queued for execution',
      workflowId: 'wf-1',
    });
  });

  it('throws instead of resolving with { error } when the process is unreachable', async () => {
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();
    makeUnreachable(bridge);

    // The regression. This used to RESOLVE, so the caller saw a truthy result
    // and answered 200.
    const outcome = await bridge.activateWorkflow(workflow, 'user-1').then(
      (value) => ({ resolved: value }),
      (error) => ({ rejected: error })
    );

    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toBeInstanceOf(WorkflowProcessUnavailableError);
    expect(outcome.rejected.reason).toBe('not-spawned');
  });

  it('preserves the diagnosis when the child reports a failure', async () => {
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();
    const child = await spawnReady(bridge);

    const diagnosis = 'Workflow wf-1 cannot be executed:\n  - node "n1" is missing "text"';
    child.send.mockImplementation((message) => {
      queueMicrotask(() =>
        child.emit('message', { id: message.id, success: false, error: diagnosis })
      );
    });

    const error = await bridge.activateWorkflow(workflow, 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(WorkflowProcessUnavailableError);
    expect(error.message).toBe(diagnosis);
  });

  it('still logs before rethrowing', async () => {
    const { default: bridge } = await freshModule();
    makeUnreachable(bridge);

    await bridge.activateWorkflow(workflow, 'user-1').catch(() => {});

    expect(console.error).toHaveBeenCalledWith(
      'Error activating workflow via IPC:',
      expect.any(Error)
    );
  });
});

describe('deactivateWorkflow', () => {
  it('returns what the child reported when the stop succeeds', async () => {
    const { default: bridge } = await freshModule();
    const child = await spawnReady(bridge);

    child.send.mockImplementation((message) => {
      queueMicrotask(() =>
        child.emit('message', {
          id: message.id,
          success: true,
          data: { message: 'Workflow stopped', isActive: false },
        })
      );
    });

    await expect(bridge.deactivateWorkflow('wf-1', 'user-1')).resolves.toEqual({
      message: 'Workflow stopped',
      isActive: false,
    });
  });

  it('throws instead of resolving with { error } when the process is unreachable', async () => {
    const { default: bridge, WorkflowProcessUnavailableError } = await freshModule();
    makeUnreachable(bridge);

    const outcome = await bridge.deactivateWorkflow('wf-1', 'user-1').then(
      (value) => ({ resolved: value }),
      (error) => ({ rejected: error })
    );

    expect(outcome.resolved).toBeUndefined();
    expect(outcome.rejected).toBeInstanceOf(WorkflowProcessUnavailableError);
  });

  it('still logs before rethrowing', async () => {
    const { default: bridge } = await freshModule();
    makeUnreachable(bridge);

    await bridge.deactivateWorkflow('wf-1', 'user-1').catch(() => {});

    expect(console.error).toHaveBeenCalledWith(
      'Error deactivating workflow via IPC:',
      expect.any(Error)
    );
  });
});

describe('all three IPC methods now agree', () => {
  it('none of them resolves on an unreachable process', async () => {
    // fetchWorkflowState was fixed first; these two were left behind, so the
    // class reported the same failure two different ways depending on which
    // method you called.
    const { default: bridge } = await freshModule();
    makeUnreachable(bridge);

    const outcomes = await Promise.all(
      [
        bridge.activateWorkflow(workflow, 'user-1'),
        bridge.deactivateWorkflow('wf-1', 'user-1'),
        bridge.fetchWorkflowState('wf-1', 'user-1'),
      ].map((p) => p.then(() => 'resolved', () => 'rejected'))
    );

    expect(outcomes).toEqual(['rejected', 'rejected', 'rejected']);
  });
});
