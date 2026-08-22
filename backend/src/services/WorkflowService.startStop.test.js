import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start and Stop must answer 2xx only when they did something.
 *
 * The bridge swallowed IPC failures into `{ error: message }` and these
 * handlers passed that to `res.json(result)` — 200, with an error-shaped body.
 * Every caller gates on the status code (`response.ok`, or axios rejecting on
 * non-2xx), so the failure branch never ran and the UI reported a start that
 * never happened.
 *
 * Two further consequences are pinned below:
 *
 *   - deleteWorkflow calls deactivateWorkflow first. Now that it throws, the
 *     delete must NOT start failing when the workflow process is unreachable.
 *   - The retry around the post-save reactivate has been dead code since it was
 *     written: `catch (reactivateError)` could not fire against a method that
 *     never threw. It is live now.
 */

vi.mock('../services/auth/sessionTokenCache.js', () => ({
  subscribe: vi.fn(() => () => {}),
  getSessionToken: vi.fn(() => null),
  getSessionUserId: vi.fn(() => null),
}));
vi.mock('child_process', () => ({ fork: vi.fn(), default: { fork: vi.fn() } }));

const activateWorkflow = vi.fn();
const deactivateWorkflow = vi.fn();
const fetchWorkflowState = vi.fn();

vi.mock('../workflow/WorkflowProcessBridge.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    default: { activateWorkflow, deactivateWorkflow, fetchWorkflowState },
  };
});

const findOne = vi.fn();
const deleteWorkflowRow = vi.fn(async () => ({ changes: 1 }));
const deleteWebhook = vi.fn(async () => ({}));

vi.mock('../models/WorkflowModel.js', () => ({
  default: { findOne, delete: deleteWorkflowRow, createOrUpdate: vi.fn(), update: vi.fn() },
}));
vi.mock('../models/WebhookModel.js', () => ({ default: { deleteByWorkflowId: deleteWebhook } }));
vi.mock('../models/database/index.js', () => ({
  // Must invoke the callback: markWorkflowUserModified awaits a Promise that
  // only settles from it, so a bare vi.fn() hangs the save forever.
  default: { run: vi.fn((sql, params, cb) => cb && cb()) },
  dbRunWithRetry: vi.fn(async (fn) => fn()),
}));
vi.mock('../utils/realtimeSync.js', () => ({
  broadcast: vi.fn(),
  broadcastToUser: vi.fn(),
  RealtimeEvents: { WORKFLOW_CREATED: 'c', WORKFLOW_UPDATED: 'u', WORKFLOW_DELETED: 'd' },
}));
vi.mock('../plugins/PluginManager.js', () => ({ default: {} }));
vi.mock('../plugins/PluginInstaller.js', () => ({ default: {} }));

const { default: WorkflowService } = await import('./WorkflowService.js');
const { WorkflowProcessUnavailableError } = await import('../workflow/WorkflowProcessBridge.js');

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const req = { params: { id: 'wf-1' }, user: { userId: 'user-1' } };
const storedRow = { id: 'wf-1', workflow_data: JSON.stringify({ id: 'wf-1', nodes: [], edges: [] }) };

const unavailable = (reason = 'not-spawned', message = 'Workflow process is not available') =>
  new WorkflowProcessUnavailableError(message, reason);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  findOne.mockResolvedValue(storedRow);
});

describe('POST /workflows/:id/start', () => {
  it('answers 200 with the result when the workflow really started', async () => {
    activateWorkflow.mockResolvedValue({ message: 'Workflow queued for execution', workflowId: 'wf-1' });

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Workflow queued for execution');
  });

  it('answers 503 — not 200 — when the workflow process is unreachable', async () => {
    activateWorkflow.mockRejectedValue(unavailable());

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.reason).toBe('not-spawned');
    expect(res.body.details).toContain('unreachable');
  });

  it('never answers 2xx with an error-shaped body', async () => {
    // The exact regression: `{ error: ... }` used to arrive as 200, and every
    // caller checks response.ok rather than the body.
    activateWorkflow.mockRejectedValue(unavailable('timeout', 'Message ACTIVATE_WORKFLOW timed out after 30000ms'));

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toBeTruthy();
  });

  it('answers 500 with the diagnosis when the process reported a failure', async () => {
    const diagnosis = 'Workflow wf-1 cannot be executed:\n  - node "n1" is missing "text"';
    activateWorkflow.mockRejectedValue(new Error(diagnosis));

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.details).toBe(diagnosis);
  });

  it('answers 409 — not 200 — when the workflow is already running', async () => {
    // ProcessManager REFUSES by resolving with an error-shaped payload rather
    // than throwing, so the throw path fixed above never sees it and res.json
    // sent it as 200. Found by Copilot on this PR.
    activateWorkflow.mockResolvedValue({
      error: 'Workflow is already queued or running',
      code: 'ALREADY_ACTIVE',
      workflowId: 'wf-1',
    });

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.details).toBe('Workflow is already queued or running');
    expect(res.body.code).toBe('ALREADY_ACTIVE');
  });

  it('answers 500 when the enqueue itself failed', async () => {
    activateWorkflow.mockResolvedValue({
      error: 'Failed to enqueue workflow',
      code: 'ENQUEUE_FAILED',
      workflowId: 'wf-1',
    });

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.details).toBe('Failed to enqueue workflow');
  });

  it('discriminates on the code, never on the message text', async () => {
    // Reword the sentence and keep the code: the status must not move. The
    // previous change removed a `error.message.includes('not ready')` check for
    // exactly this reason — do not reintroduce the pattern one layer up.
    //
    // The wording deliberately shares NO keyword with the original. An earlier
    // version of this test used "...is already up and running", which still
    // contained "already" — so a mutant that matched on the text passed it, and
    // the test proved nothing. Mutation testing caught that.
    activateWorkflow.mockResolvedValue({
      error: 'this workflow is up and running, friend',
      code: 'ALREADY_ACTIVE',
      workflowId: 'wf-1',
    });

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(409);
  });

  it('does not infer 409 from wording when the code says otherwise', async () => {
    // The other half of the same guarantee: a message that reads like the
    // already-running case must NOT be treated as one when the code disagrees.
    activateWorkflow.mockResolvedValue({
      error: 'the queue already rejected this workflow',
      code: 'ENQUEUE_FAILED',
      workflowId: 'wf-1',
    });

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(500);
  });

  it('falls back to 500 for an error-shaped result carrying no code', async () => {
    activateWorkflow.mockResolvedValue({ error: 'something older, with no code' });

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(500);
  });

  it('does not mistake a successful result for a refusal', async () => {
    activateWorkflow.mockResolvedValue({ message: 'Workflow queued for execution', workflowId: 'wf-1' });

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('still answers 404 for a workflow that does not exist, without touching the bridge', async () => {
    findOne.mockResolvedValue(null);

    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.statusCode).toBe(404);
    expect(activateWorkflow).not.toHaveBeenCalled();
  });
});

describe('POST /workflows/:id/stop', () => {
  it('answers 200 with the result when the workflow really stopped', async () => {
    deactivateWorkflow.mockResolvedValue({ message: 'Workflow stopped', isActive: false });

    const res = makeRes();
    await WorkflowService.deactivateWorkflow(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it('answers 503 when the workflow process is unreachable', async () => {
    deactivateWorkflow.mockRejectedValue(unavailable('not-ready', 'Workflow process is not ready'));

    const res = makeRes();
    await WorkflowService.deactivateWorkflow(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.reason).toBe('not-ready');
  });

  it('answers 500 with the diagnosis when the process reported a failure', async () => {
    deactivateWorkflow.mockRejectedValue(new Error('worker refused to stop'));

    const res = makeRes();
    await WorkflowService.deactivateWorkflow(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.details).toBe('worker refused to stop');
  });
});

describe('DELETE /workflows/:id — must not regress', () => {
  it('deletes the workflow even when the process cannot confirm the stop', async () => {
    // deleteWorkflow deactivates first. Before this change that call swallowed;
    // now it throws, and letting it escape would make a workflow undeletable
    // until the workflow process came back.
    deactivateWorkflow.mockRejectedValue(unavailable());

    const res = makeRes();
    await WorkflowService.deleteWorkflow(req, res);

    expect(res.statusCode).toBe(200);
    expect(deleteWorkflowRow).toHaveBeenCalledWith('wf-1', 'user-1');
    expect(deleteWebhook).toHaveBeenCalled();
  });

  it('says why the stop could not be confirmed instead of discarding it', async () => {
    deactivateWorkflow.mockRejectedValue(unavailable('timeout', 'Message DEACTIVATE_WORKFLOW timed out after 30000ms'));

    await WorkflowService.deleteWorkflow(req, makeRes());

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('still deletes normally when the stop succeeds', async () => {
    deactivateWorkflow.mockResolvedValue({ message: 'Workflow stopped', isActive: false });

    const res = makeRes();
    await WorkflowService.deleteWorkflow(req, res);

    expect(res.statusCode).toBe(200);
    expect(deleteWorkflowRow).toHaveBeenCalled();
  });
});

describe('the post-save reactivate retry is no longer dead code', () => {
  it('retries the activation once when the first attempt fails', async () => {
    // `catch (reactivateError)` has been unreachable since it was written,
    // because activateWorkflow never threw. Now it can fire.
    fetchWorkflowState.mockResolvedValue({ status: 'listening' });
    deactivateWorkflow.mockResolvedValue({});
    activateWorkflow
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce({ message: 'Workflow queued for execution' });

    const saveReq = {
      body: { workflow: { id: 'wf-1', name: 'w', nodes: [], edges: [] } },
      user: { userId: 'user-1' },
    };
    await WorkflowService.saveWorkflow(saveReq, makeRes());

    expect(activateWorkflow).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to reactivate workflow after save:',
      'first attempt failed'
    );
  });

  it('does not fail the save when both activation attempts fail', async () => {
    fetchWorkflowState.mockResolvedValue({ status: 'listening' });
    deactivateWorkflow.mockResolvedValue({});
    activateWorkflow.mockRejectedValue(new Error('still failing'));

    const saveReq = {
      body: { workflow: { id: 'wf-1', name: 'w', nodes: [], edges: [] } },
      user: { userId: 'user-1' },
    };
    const res = makeRes();
    await WorkflowService.saveWorkflow(saveReq, res);

    // The save itself already succeeded; the restart check is best-effort.
    expect(res.statusCode).toBe(201);
    expect(activateWorkflow).toHaveBeenCalledTimes(2);
  });
});
