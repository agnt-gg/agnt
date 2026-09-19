import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The detail view and the list view must agree about whether a workflow is on.
 *
 * Every list endpoint returns the authoritative `workflows.status` column, and
 * the engine writes it. The detail response omitted the field entirely — and
 * saveWorkflow strips any status from the stored workflow JSON, so there was no
 * second copy to fall back on. A client opening one workflow could not tell
 * whether it was listening.
 */

vi.mock('../services/auth/sessionTokenCache.js', () => ({
  subscribe: vi.fn(() => () => {}),
  getSessionToken: vi.fn(() => null),
  getSessionUserId: vi.fn(() => null),
}));
vi.mock('child_process', () => ({ fork: vi.fn(), default: { fork: vi.fn() } }));
vi.mock('../workflow/WorkflowProcessBridge.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    default: { fetchWorkflowState: vi.fn(), activateWorkflow: vi.fn(), deactivateWorkflow: vi.fn() },
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
const { default: WorkflowModel } = await import('../models/WorkflowModel.js');

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

describe('WorkflowService.getWorkflowById — authoritative status', () => {
  it.each(['listening', 'stopped', 'error'])('returns the stored %s status', async (status) => {
    WorkflowModel.findOne.mockResolvedValue({
      id: 'wf-1',
      user_id: 'user-1',
      status,
      workflow_data: '{"nodes":[],"edges":[]}',
    });
    const res = makeRes();

    await WorkflowService.getWorkflowById(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(status);
  });

  it('still returns the workflow body alongside the status', async () => {
    WorkflowModel.findOne.mockResolvedValue({
      id: 'wf-1',
      user_id: 'user-1',
      status: 'listening',
      workflow_data: '{"nodes":[{"id":"n1"}],"edges":[]}',
    });
    const res = makeRes();

    await WorkflowService.getWorkflowById(req, res);

    expect(res.body.id).toBe('wf-1');
    expect(res.body.workflow.nodes).toHaveLength(1);
  });
});
