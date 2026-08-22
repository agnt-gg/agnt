import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The 200 bug, reproduced end to end.
 *
 * The other two suites test each half in isolation: the bridge throws, and the
 * handler maps a throw to 503/500. Neither reproduces the actual defect, which
 * only existed where the halves MET —
 *
 *     bridge swallows  ->  returns { error: message }  ->  res.json(result)  ->  200
 *
 * — so a route test with a mocked bridge cannot see it, and a bridge test has
 * no res to inspect. This file therefore mocks the models, the database and the
 * realtime layer, and deliberately leaves WorkflowProcessBridge REAL.
 *
 * With the bridge in its never-spawned state, `POST /workflows/:id/start` used
 * to answer 200 with `{ error: 'Workflow process is not available' }`. Every
 * caller gates on `response.ok`, so the UI reported a start that never
 * happened.
 */

vi.mock('../services/auth/sessionTokenCache.js', () => ({
  subscribe: vi.fn(() => () => {}),
  getSessionToken: vi.fn(() => null),
  getSessionUserId: vi.fn(() => null),
}));
// The bridge forks a child on spawn(); it is never spawned here, but the import
// must not reach the real module.
vi.mock('child_process', () => ({ fork: vi.fn(), default: { fork: vi.fn() } }));

vi.mock('../models/WorkflowModel.js', () => ({
  default: {
    findOne: vi.fn(async () => ({
      id: 'wf-1',
      workflow_data: JSON.stringify({ id: 'wf-1', nodes: [], edges: [] }),
    })),
    delete: vi.fn(async () => ({ changes: 1 })),
    createOrUpdate: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('../models/WebhookModel.js', () => ({ default: { deleteByWorkflowId: vi.fn() } }));
vi.mock('../models/database/index.js', () => ({
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
const { default: bridge } = await import('../workflow/WorkflowProcessBridge.js');

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
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  // The state the bridge holds before anything forks a workflow process.
  bridge.workflowProcess = null;
  bridge.readyPromise = null;
  bridge.isReady = false;
});

describe('start, against a real bridge with no workflow process', () => {
  it('does not answer 200', async () => {
    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    // This is the regression, stated at the boundary that had it.
    expect(res.statusCode).not.toBe(200);
    expect(res.statusCode).toBe(503);
  });

  it('does not answer an error-shaped body with a success status', async () => {
    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    const looksLikeSuccess = res.statusCode >= 200 && res.statusCode < 300;
    expect(looksLikeSuccess && Boolean(res.body?.error)).toBe(false);
  });

  it('names the reason the process could not be reached', async () => {
    const res = makeRes();
    await WorkflowService.activateWorkflow(req, res);

    expect(res.body.reason).toBe('not-spawned');
    expect(res.body.details).toContain('unreachable');
  });
});

describe('stop, against a real bridge with no workflow process', () => {
  it('does not answer 200', async () => {
    const res = makeRes();
    await WorkflowService.deactivateWorkflow(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('Failed to stop workflow');
  });
});

describe('delete, against a real bridge with no workflow process', () => {
  it('still succeeds — a workflow must stay deletable while the process is down', async () => {
    const res = makeRes();
    await WorkflowService.deleteWorkflow(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain('deleted successfully');
  });
});
