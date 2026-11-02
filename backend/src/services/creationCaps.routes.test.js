/**
 * The free agent/workflow caps, as the editor meets them.
 *
 * A save that would make one too many answers 403 with requiredFeature (the
 * shape the app turns into an upgrade prompt), writes nothing, and never
 * applies to an edit of something that already exists. The cap rule itself
 * is proven against a real database in auth/creationLimit.test.js; this pins
 * that the services ask it, at the right moment, and answer correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanLimitError } from './auth/connectionLimit.js';

const assertCanCreate = vi.fn(async () => {});
vi.mock('./auth/creationLimit.js', async (importOriginal) => ({ ...(await importOriginal()), assertCanCreate }));

const agentModel = { findOne: vi.fn(), createOrUpdate: vi.fn(async () => ({})) };
const workflowModel = { findOne: vi.fn(), createOrUpdate: vi.fn(async () => ({})), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) };
vi.mock('../models/AgentModel.js', () => ({ default: agentModel }));
vi.mock('../models/WorkflowModel.js', () => ({ default: workflowModel }));
vi.mock('./OrchestratorService.js', () => ({ default: vi.fn() }));
vi.mock('../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => ({ selectedProvider: 'p', selectedModel: 'm' })) } }));
vi.mock('../models/database/index.js', () => ({ default: { run: (_sql, _args, done) => done && done() }, dbRunWithRetry: vi.fn(async (fn) => fn()) }));
vi.mock('../models/WebhookModel.js', () => ({ default: {} }));
vi.mock('../workflow/WorkflowProcessBridge.js', () => ({ default: { fetchWorkflowState: vi.fn(async () => ({ status: 'stopped' })) }, isWorkflowProcessUnavailable: () => false }));
vi.mock('../utils/realtimeSync.js', () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), RealtimeEvents: {} }));
vi.mock('../plugins/PluginManager.js', () => ({ default: {} }));
vi.mock('../plugins/PluginInstaller.js', () => ({ default: {} }));

const { default: AgentService } = await import('./AgentService.js');
const { default: WorkflowService } = await import('./WorkflowService.js');

const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (code) => ((r.statusCode = code), r);
  r.json = (body) => ((r.body = body), r);
  return r;
};
const atCap = (limit) => assertCanCreate.mockRejectedValueOnce(new PlanLimitError(`The free plan makes 3 ${limit}.`, limit));
const blankWorkflow = (id) => ({ id, name: 'w', nodes: [], edges: [] });

beforeEach(() => {
  vi.clearAllMocks();
  agentModel.findOne.mockResolvedValue(null);
  workflowModel.findOne.mockResolvedValue(null);
});

describe('agents', () => {
  it('a new agent past the cap: 403 upgrade, nothing written', async () => {
    atCap('agents');
    const r = res();
    await AgentService.saveOrUpdateAgent({ user: { userId: 'u1' }, body: { agent: { name: 'Fourth' } } }, r);
    expect(assertCanCreate).toHaveBeenCalledWith('agent', 'u1');
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ code: 'PLAN_LIMIT', requiredFeature: 'agents' });
    expect(agentModel.createOrUpdate).not.toHaveBeenCalled();
  });
  it('editing an agent the account owns is never capped', async () => {
    agentModel.findOne.mockResolvedValue({ id: 'a1', created_by: 'u1' });
    const r = res();
    await AgentService.saveOrUpdateAgent({ user: { userId: 'u1' }, body: { agent: { id: 'a1', name: 'Renamed' } } }, r);
    expect(assertCanCreate).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(200);
  });
  it("copying someone else's agent makes a new one: capped", async () => {
    agentModel.findOne.mockResolvedValue({ id: 'a1', created_by: 'someone-else' });
    await AgentService.saveOrUpdateAgent({ user: { userId: 'u1' }, body: { agent: { id: 'a1', name: 'Mine now' } } }, res());
    expect(assertCanCreate).toHaveBeenCalledWith('agent', 'u1');
  });
});

describe('workflows', () => {
  it('a new workflow past the cap: 403 upgrade, nothing written', async () => {
    atCap('workflows');
    const r = res();
    await WorkflowService.saveWorkflow({ user: { userId: 'u1' }, body: { workflow: blankWorkflow('w-new') } }, r);
    expect(assertCanCreate).toHaveBeenCalledWith('workflow', 'u1');
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ code: 'PLAN_LIMIT', requiredFeature: 'workflows' });
    expect(workflowModel.createOrUpdate).not.toHaveBeenCalled();
  });
  it('saving an existing workflow is never capped', async () => {
    workflowModel.findOne.mockResolvedValue({ id: 'w1', user_id: 'u1' });
    const r = res();
    await WorkflowService.saveWorkflow({ user: { userId: 'u1' }, body: { workflow: blankWorkflow('w1') } }, r);
    expect(assertCanCreate).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(201);
  });
  it('renaming a workflow that does not exist yet creates it: capped', async () => {
    workflowModel.findOne.mockResolvedValue(null);
    atCap('workflows');
    const r = res();
    await WorkflowService.renameWorkflow({ user: { userId: 'u1' }, params: { id: 'w-new' }, body: { name: 'x' } }, r);
    expect(r.statusCode).toBe(403);
    expect(workflowModel.create).not.toHaveBeenCalled();
  });
});
