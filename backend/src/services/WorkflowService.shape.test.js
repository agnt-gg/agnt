/**
 * The save and update routes store the shape the canvas reads, whoever sends
 * what. Reported 2026-10-21 (AGNT One): the main chat saved a React-Flow
 * workflow through POST /workflows/save; it stored, and the full editor's
 * canvas was dead. The same chat's PUT /workflows/:id without a `workflow`
 * body came back as a 500 from SQLite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stored = new Map();
vi.mock('../models/WorkflowModel.js', async () => {
  const { normalizeWorkflowJson } = await import('../workflow/normalizeWorkflowShape.js');
  return {
    default: {
      findOne: vi.fn(async (id) => (stored.has(id) ? { id, user_id: 'u1', workflow_data: stored.get(id) } : null)),
      // The real model normalizes too (covered by its own write path); this
      // stand-in records exactly what the route handed it.
      createOrUpdate: vi.fn(async (id, data) => { stored.set(id, data); return { changes: 1 }; }),
      update: vi.fn(async (id, data) => { stored.set(id, normalizeWorkflowJson(data)); return 1; }),
    },
  };
});
vi.mock('../workflow/WorkflowProcessBridge.js', () => ({
  default: { fetchWorkflowState: vi.fn(async () => ({ status: 'stopped' })), deactivateWorkflow: vi.fn(), activateWorkflow: vi.fn() },
  isWorkflowProcessUnavailable: () => false,
}));
vi.mock('../utils/realtimeSync.js', () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), RealtimeEvents: new Proxy({}, { get: (_t, k) => String(k) }) }));
// markWorkflowUserModified (local to WorkflowService) writes through db.run.
vi.mock('../models/database/index.js', () => ({ default: { run: vi.fn((_sql, _params, done) => done?.(null)), all: vi.fn(), get: vi.fn() } }));
vi.mock('../models/WebhookModel.js', () => ({ default: {} }));
vi.mock('../plugins/PluginManager.js', () => ({ default: {} }));
vi.mock('../plugins/PluginInstaller.js', () => ({ default: {} }));

import WorkflowService from './WorkflowService.js';
import WorkflowModel from '../models/WorkflowModel.js';

const reply = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const REACT_FLOW = {
  id: 'wf-1',
  name: 'Daily AI Briefing',
  nodes: [
    { id: 'trigger-1', type: 'trigger-timer', position: { x: 80, y: 220 }, data: { label: 'Daily', parameters: { schedule: 'Daily' } } },
    { id: 'search-1', type: 'web-search', position: { x: 380, y: 220 }, data: { label: 'Search', parameters: { query: 'AI' } } },
  ],
  edges: [{ id: 'e1', start: { id: 'trigger-1', type: 'trigger-timer' }, end: { id: 'search-1', type: 'web-search' } }],
};

beforeEach(() => { stored.clear(); vi.clearAllMocks(); });

describe('POST /workflows/save', () => {
  it('a React-Flow workflow is converted and stored in the canvas shape (no longer refused for missing text)', async () => {
    const res = reply();
    await WorkflowService.saveWorkflow({ body: { workflow: structuredClone(REACT_FLOW) }, user: { userId: 'u1' } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
    const saved = JSON.parse(stored.get('wf-1'));
    expect(saved.nodes[0]).toEqual({ id: 'trigger-1', type: 'trigger-timer', text: 'Daily', x: 80, y: 220, parameters: { schedule: 'Daily' } });
    expect(saved.edges[0].start.type).toBe('output');
  });
});

describe('PUT /workflows/:id', () => {
  it('without a workflow body: 400 naming the contract, not a 500 from SQLite', async () => {
    const res = reply();
    await WorkflowService.updateWorkflow({ params: { id: 'wf-1' }, body: { name: 'x', nodes: [] }, user: { userId: 'u1' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/\{ workflow: \{ \.\.\. \} \}/);
    expect(WorkflowModel.update).not.toHaveBeenCalled();
  });

  it('a React-Flow workflow is converted before it is stored', async () => {
    const res = reply();
    await WorkflowService.updateWorkflow({ params: { id: 'wf-1' }, body: { workflow: structuredClone(REACT_FLOW) }, user: { userId: 'u1' } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).not.toBe(400);
    const sentToModel = JSON.parse(WorkflowModel.update.mock.calls[0][1]);
    expect(sentToModel.nodes[1]).toMatchObject({ text: 'Search', x: 380, y: 220, parameters: { query: 'AI' } });
  });
});
