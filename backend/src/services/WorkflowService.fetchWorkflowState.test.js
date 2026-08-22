import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /workflows/:id/status must not report a workflow state it never read.
 *
 * The bridge answered an unreachable workflow process with
 * `{ status: 'error' }`, and this handler passed that through as 200. Since
 * 'error' is a genuine workflow status — ProcessWorker sets it on a workflow
 * whose engine failed — a client had no way to tell "your workflow failed"
 * from "I could not reach the workflow process".
 *
 * The handler's own `catch` was unreachable while that was true: it tested
 * `error.message.includes('not ready')`, but nothing ever threw. It was added
 * on 2026-03-10, two months after the swallow landed (2026-01-20) — someone
 * wrote handling for an error that structurally could not arrive.
 *
 * The predicate and error class are deliberately NOT mocked; the wiring
 * between them and this handler is part of what is under test.
 */

vi.mock('../services/auth/sessionTokenCache.js', () => ({
  subscribe: vi.fn(() => () => {}),
  getSessionToken: vi.fn(() => null),
  getSessionUserId: vi.fn(() => null),
}));
vi.mock('child_process', () => ({ fork: vi.fn(), default: { fork: vi.fn() } }));

const fetchWorkflowState = vi.fn();

vi.mock('../workflow/WorkflowProcessBridge.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    default: {
      fetchWorkflowState,
      activateWorkflow: vi.fn(),
      deactivateWorkflow: vi.fn(),
    },
  };
});

vi.mock('../models/WorkflowModel.js', () => ({ default: { findOne: vi.fn(), createOrUpdate: vi.fn() } }));
vi.mock('../models/WebhookModel.js', () => ({ default: {} }));
vi.mock('../models/database/index.js', () => ({
  default: { run: vi.fn() },
  dbRunWithRetry: vi.fn(async (fn) => fn()),
}));
vi.mock('../utils/realtimeSync.js', () => ({
  broadcast: vi.fn(),
  broadcastToUser: vi.fn(),
  RealtimeEvents: { WORKFLOW_CREATED: 'created', WORKFLOW_UPDATED: 'updated' },
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /workflows/:id/status — the process answered', () => {
  it('passes a real workflow state straight through', async () => {
    fetchWorkflowState.mockResolvedValue({ status: 'listening', outputs: { n1: 1 }, errors: {} });

    const res = makeRes();
    await WorkflowService.fetchWorkflowState(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'listening', outputs: { n1: 1 }, errors: {} });
  });

  it('still reports a workflow whose engine genuinely errored as status "error"', async () => {
    // The value this PR stops manufacturing must keep working when it is real.
    fetchWorkflowState.mockResolvedValue({ status: 'error', errors: { n1: 'boom' } });

    const res = makeRes();
    await WorkflowService.fetchWorkflowState(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('error');
    expect(res.body.errors).toEqual({ n1: 'boom' });
  });
});

describe('GET /workflows/:id/status — the process could not be reached', () => {
  it('answers 200 "initializing" while the process is still starting', async () => {
    // Benign and self-resolving. This branch existed but was unreachable.
    fetchWorkflowState.mockRejectedValue(
      new WorkflowProcessUnavailableError('Workflow process is not ready', 'not-ready')
    );

    const res = makeRes();
    await WorkflowService.fetchWorkflowState(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      status: 'initializing',
      message: 'Workflow process is starting up',
    });
  });

  it.each([
    ['not-spawned', 'Workflow process is not available'],
    ['init-failed', 'Workflow process failed to initialize'],
    ['timeout', 'Message FETCH_WORKFLOW_STATE timed out after 30000ms'],
  ])('answers 503 "unavailable" for reason %s', async (reason, message) => {
    fetchWorkflowState.mockRejectedValue(new WorkflowProcessUnavailableError(message, reason));

    const res = makeRes();
    await WorkflowService.fetchWorkflowState(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.reason).toBe(reason);
    expect(res.body.details).toBe(message);
  });

  it('never reports an unreachable process as a workflow in the error state', async () => {
    // The regression, stated directly: 'error' must not be manufactured.
    fetchWorkflowState.mockRejectedValue(
      new WorkflowProcessUnavailableError('Workflow process is not available', 'not-spawned')
    );

    const res = makeRes();
    await WorkflowService.fetchWorkflowState(req, res);

    expect(res.body.status).not.toBe('error');
    expect(res.statusCode).not.toBe(200);
  });
});

describe('GET /workflows/:id/status — the process reported a failure', () => {
  it('answers 500 and forwards the diagnosis instead of a generic string', async () => {
    const diagnosis =
      'Workflow wf-1 cannot be executed:\n  - node "n1" is missing "text" (got missing).';
    fetchWorkflowState.mockRejectedValue(new Error(diagnosis));

    const res = makeRes();
    await WorkflowService.fetchWorkflowState(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Error retrieving workflow status');
    // Previously discarded — which is exactly why such failures were invisible
    // from the API and had to be dug out of the workflow process log.
    expect(res.body.details).toBe(diagnosis);
  });

  it('does not classify a reported failure as unavailable', async () => {
    fetchWorkflowState.mockRejectedValue(new Error('something the child knows about'));

    const res = makeRes();
    await WorkflowService.fetchWorkflowState(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBeUndefined();
  });
});
