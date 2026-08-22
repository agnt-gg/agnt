import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /workflows/save must refuse a workflow the engine cannot execute.
 *
 * Before this guard the endpoint validated only that the body was an object,
 * then stringified whatever arrived into the row. The save answered 201, the
 * workflow appeared in the list, and the mismatch surfaced only at activation —
 * as a TypeError inside the workflow process that reached the caller as an
 * unqualified 'error'.
 *
 * The assertion that matters in every rejection case is not the status code but
 * `createOrUpdate` never being called: a refused save must leave no row behind.
 */

const createOrUpdate = vi.fn(async () => ({}));
const findOne = vi.fn(async () => null);
const fetchWorkflowState = vi.fn(async () => ({ status: 'stopped' }));
const dbRun = vi.fn((sql, params, cb) => cb && cb());

vi.mock('../models/WorkflowModel.js', () => ({
  default: { findOne, createOrUpdate, update: vi.fn(), delete: vi.fn() },
}));
vi.mock('../models/WebhookModel.js', () => ({ default: {} }));
vi.mock('../workflow/WorkflowProcessBridge.js', () => ({
  default: { fetchWorkflowState, activateWorkflow: vi.fn(), deactivateWorkflow: vi.fn() },
}));
vi.mock('../models/database/index.js', () => ({
  default: { run: dbRun },
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

/** Minimal express double that records what the handler answered. */
function makeRes() {
  const res = {
    statusCode: undefined,
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
  return res;
}

const makeReq = (workflow) => ({ body: { workflow }, user: { userId: 'user-1' } });

const validWorkflow = () => ({
  id: 'wf-1',
  name: 'valid',
  nodes: [
    { id: 'n1', text: 'Timer Trigger', type: 'trigger-timer', category: 'trigger', parameters: {} },
    { id: 'n2', text: 'Run JS', type: 'execute-javascript', category: 'action', parameters: {} },
  ],
  edges: [{ id: 'e1', start: { id: 'n1', type: 'output' }, end: { id: 'n2', type: 'input' } }],
});

beforeEach(() => {
  vi.clearAllMocks();
  findOne.mockResolvedValue(null);
});

describe('saveWorkflow — a workflow the engine can run', () => {
  it('persists it and answers 201', async () => {
    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq(validWorkflow()), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.workflowId).toBe('wf-1');
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });

  it('still accepts a blank draft', async () => {
    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq({ id: 'wf-2', name: 'draft', nodes: [], edges: [] }), res);

    expect(res.statusCode).toBe(201);
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('saveWorkflow — a workflow the engine cannot run', () => {
  it('rejects a node without text and stores nothing', async () => {
    const wf = validWorkflow();
    delete wf.nodes[0].text;

    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq(wf), res);

    expect(res.statusCode).toBe(400);
    expect(createOrUpdate).not.toHaveBeenCalled();
  });

  it('answers with the specific field, not just "invalid"', async () => {
    const wf = validWorkflow();
    delete wf.nodes[1].text;

    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq(wf), res);

    expect(res.body.error).toMatch(/shape the workflow engine executes/i);
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.join(' ')).toContain('node "n2"');
    expect(res.body.details.join(' ')).toContain('"text"');
  });

  it('rejects the react-flow shape that agent tooling produces', async () => {
    const res = makeRes();
    await WorkflowService.saveWorkflow(
      makeReq({
        id: 'wf-3',
        name: 'react-flow',
        nodes: [{ id: 'trigger-1', type: 'trigger-timer', data: { label: 'Timer', properties: {} } }],
        edges: [{ id: 'e1', source: 'trigger-1', target: 'js-1' }],
      }),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(createOrUpdate).not.toHaveBeenCalled();
  });

  it('rejects an edge pointing at a node that does not exist', async () => {
    const wf = validWorkflow();
    wf.edges[0].end = { id: 'ghost', type: 'input' };

    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq(wf), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.details.join(' ')).toContain('ghost');
    expect(createOrUpdate).not.toHaveBeenCalled();
  });

  it('does not mark an existing row user-modified when the save is refused', async () => {
    // PRD-057 stamps is_user_modified on update. A refused save must leave the
    // existing row completely untouched, including that flag.
    findOne.mockResolvedValue({ id: 'wf-1', source_plugin: 'some-plugin' });

    const wf = validWorkflow();
    delete wf.nodes[0].text;

    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq(wf), res);

    expect(res.statusCode).toBe(400);
    expect(createOrUpdate).not.toHaveBeenCalled();
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('rejects before generating an id, so a bad payload mints nothing', async () => {
    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq({ name: 'no id', nodes: [{ id: 'n1' }], edges: [] }), res);

    expect(res.statusCode).toBe(400);
    expect(findOne).not.toHaveBeenCalled();
    expect(createOrUpdate).not.toHaveBeenCalled();
  });

  it('still rejects a non-object body with the original message', async () => {
    const res = makeRes();
    await WorkflowService.saveWorkflow(makeReq(null), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/must be \{ workflow/i);
  });
});
