import { describe, it, expect, vi, beforeEach } from 'vitest';

// bravo smoke test, Nov 2026: POST /agents/save answered 500 for caller mistakes:
//   no status        -> "SQLITE_CONSTRAINT: NOT NULL constraint failed: agents.status"
//   no { agent } box -> "Cannot read properties of undefined (reading 'assignedTools')"
const sql = [];
vi.mock('./OrchestratorService.js', () => ({ default: vi.fn() }));
vi.mock('../models/database/index.js', () => ({
  default: {
    run: (statement, args, done) => { sql.push({ statement, args }); done.call({ changes: 1 }, null); },
    get: (_statement, _args, done) => done(null, null),
  },
}));
vi.mock('../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => ({ selectedProvider: 'openai', selectedModel: 'gpt-4o' })) } }));
vi.mock('../models/AgentModel.js', () => ({ default: { findOne: vi.fn(), createOrUpdate: vi.fn() } }));
vi.mock('../utils/realtimeSync.js', () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), RealtimeEvents: { AGENT_CREATED: 'created', AGENT_UPDATED: 'updated' } }));
const { default: AgentService, DEFAULT_AGENT_STATUS } = await import('./AgentService.js');
const { default: AgentModel } = await import('../models/AgentModel.js');
const { withScopeRequest } = await import('./authorization/ScopeRequestContext.js');

const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const save = async (req) => { const res = response(); await AgentService.saveOrUpdateAgent(req, res); return res; };
const savedAgent = () => AgentModel.createOrUpdate.mock.calls[0]?.[1];
const creatorRows = () => sql.filter(({ statement }) => statement.includes('INSERT OR IGNORE INTO scope_resource_creators'));

beforeEach(() => {
  vi.clearAllMocks();
  sql.length = 0;
  AgentModel.findOne.mockResolvedValue(null);
  AgentModel.createOrUpdate.mockResolvedValue({});
});

describe('POST /agents/save refuses caller mistakes with 400, never 500', () => {
  it.each([[undefined], [{}], [{ name: 'Flat' }], [{ agent: 'x' }], [{ agent: [] }]])('body %j', async (body) => {
    const res = await save({ user: { userId: 'u' }, body });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/\{ agent: \{ \.\.\. \} \}/);
    expect(AgentModel.createOrUpdate).not.toHaveBeenCalled();
  });

  it('a new agent without a name', async () => {
    const res = await save({ user: { userId: 'u' }, body: { agent: { status: 'ACTIVE' } } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/name/);
  });

  it('PUT /agents/:id whose body names a different agent', async () => {
    const res = await save({ user: { userId: 'u' }, params: { id: 'a1' }, body: { agent: { id: 'a2', name: 'X' } } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(AgentModel.createOrUpdate).not.toHaveBeenCalled();
  });
});

describe('fields the caller may omit get a value instead of a constraint failure', () => {
  it('a new agent without status starts ACTIVE, with empty tool lists', async () => {
    const res = await save({ user: { userId: 'u' }, body: { agent: { name: 'No status' } } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(savedAgent()).toMatchObject({ status: DEFAULT_AGENT_STATUS, assignedTools: [], assignedWorkflows: [] });
    expect(DEFAULT_AGENT_STATUS).toBe('ACTIVE');
  });

  it('an edit that omits name and status keeps the stored ones', async () => {
    AgentModel.findOne.mockResolvedValue({ id: 'a1', name: 'Stored', status: 'INACTIVE', created_by: 'u' });
    const res = await save({ user: { userId: 'u' }, params: { id: 'a1' }, body: { agent: { description: 'only this' } } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(AgentModel.createOrUpdate.mock.calls[0][0]).toBe('a1');
    expect(savedAgent()).toMatchObject({ id: 'a1', name: 'Stored', status: 'INACTIVE', description: 'only this' });
  });
});

describe('the teammate who creates a teamspace agent is recorded, so they can delete it', () => {
  it('records the verified actor for a new agent in a team scope', async () => {
    const req = { user: { userId: 'scope:workspace-owner' }, body: { agent: { name: 'Mine' } } };
    const res = response();
    await withScopeRequest(req, { actorId: 'member-2', resourceOwnerId: 'scope:workspace-owner' }, () => AgentService.saveOrUpdateAgent(req, res));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(creatorRows().map((row) => row.args)).toEqual([['agents', savedAgent().id, 'member-2']]);
  });

  it('records nothing for an edit, or outside a team scope', async () => {
    AgentModel.findOne.mockResolvedValue({ id: 'a1', name: 'Theirs', status: 'ACTIVE', created_by: 'scope:workspace-owner' });
    const edit = { user: { userId: 'scope:workspace-owner' }, body: { agent: { id: 'a1', name: 'Edited' } } };
    await withScopeRequest(edit, { actorId: 'member-3', resourceOwnerId: 'scope:workspace-owner' }, () => AgentService.saveOrUpdateAgent(edit, response()));
    AgentModel.findOne.mockResolvedValue(null);
    await save({ user: { userId: 'u' }, body: { agent: { name: 'Personal' } } });
    expect(creatorRows()).toEqual([]);
  });
});
