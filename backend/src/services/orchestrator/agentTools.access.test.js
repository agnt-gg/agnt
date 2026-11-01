/**
 * load_agent, list_agents and run_agent see the agents the AGNT API shows the caller (bravo, 2026-10-31):
 *   - load_agent failed every call: "SQLITE_ERROR: no such column: is_shareable" (it also parsed a
 *     `parameters` column the agents table never had);
 *   - list_agents returned 0 and run_agent refused "Research Analyst", because on a team instance the
 *     team's agents are stored under the workspace principal (scope:…) and these tools read rows by
 *     the caller's personal id. agnt_agents, which goes through the API, saw them.
 * Real (per-run) database; the API is stubbed where the test is about what the API decides.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const api = vi.hoisted(() => ({ agents: new Map(), calls: [] }));
vi.mock('../../libs/agnt2.js', () => ({
  default: class {
    constructor(token) {
      this.agents = {
        list: async () => { api.calls.push(['list', token]); return [...api.agents.values()]; },
        get: async (id) => {
          api.calls.push(['get', token, id]);
          if (!api.agents.has(id)) throw Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } });
          return api.agents.get(id);
        },
      };
    }
  },
}));

const { dbReady, default: db } = await import('../../models/database/index.js');
const { default: AgentModel } = await import('../../models/AgentModel.js');
const { AGENT_TOOLS, findAccessibleAgent } = await import('./agentTools.js');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (err) => (err ? reject(err) : resolve())));
const newUser = async (id = randomUUID()) => { await run('INSERT INTO users (id, email) VALUES (?, ?)', [id, `${id}@test.local`]); return id; };
const call = async (tool, args, token, context) => JSON.parse(await AGENT_TOOLS[tool].execute(args, token, context));
let owner; let scope; let teamAgentId; let ownAgentId;

beforeAll(async () => {
  await dbReady;
  owner = await newUser();
  scope = await newUser(`scope:${randomUUID().replace(/-/g, '')}`);
  teamAgentId = randomUUID(); ownAgentId = randomUUID();
  await AgentModel.createOrUpdate(teamAgentId, { id: teamAgentId, name: 'Research Analyst', status: 'active', assignedTools: [], assignedWorkflows: [] }, scope);
  await AgentModel.createOrUpdate(ownAgentId, { id: ownAgentId, name: 'My Helper', status: 'active', assignedTools: [], assignedWorkflows: [] }, owner);
  api.agents.set(teamAgentId, { id: teamAgentId, name: 'Research Analyst', status: 'active' });
});

describe('agent tools see what the API shows the caller', { timeout: 30000 }, () => {
  it('load_agent loads an agent against the real schema (no is_shareable, no parameters column)', async () => {
    const result = await call('load_agent', { agentId: ownAgentId }, undefined, { userId: owner });
    expect(result.error ?? null).toBeNull();
    expect(result).toMatchObject({ success: true, agent: { id: ownAgentId, name: 'My Helper' } });
  });

  it('list_agents lists the team\'s agents through the API, with the caller\'s own token', async () => {
    const result = await call('list_agents', {}, 'Bearer user-token', { userId: owner });
    expect(result.agents.map((a) => a.name)).toContain('Research Analyst');
    expect(api.calls).toContainEqual(['list', 'user-token']);
  });

  it('load_agent and run_agent\'s access check find a team agent the API allows', async () => {
    expect(await findAccessibleAgent(teamAgentId, { userId: owner, authToken: 'Bearer user-token' })).toMatchObject({ name: 'Research Analyst' });
    expect(await call('load_agent', { agentId: teamAgentId }, 'Bearer user-token', { userId: owner })).toMatchObject({ success: true });
  });

  it('what the API refuses stays refused, and an API outage is an error, not "not found"', async () => {
    expect(await findAccessibleAgent(ownAgentId, { userId: owner, authToken: 'Bearer user-token' })).toBeNull();
    const down = { get: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); } };
    await expect(findAccessibleAgent(teamAgentId, { userId: owner, api: down })).rejects.toThrow(/ECONNREFUSED/);
  });

  it('without a token (an internal run), only the caller\'s own agents are reachable', async () => {
    expect(await findAccessibleAgent(ownAgentId, { userId: owner })).toMatchObject({ id: ownAgentId });
    expect(await findAccessibleAgent(teamAgentId, { userId: owner })).toBeNull();
  });

  it('run_agent refuses an agent the caller cannot reach before starting anything', async () => {
    const result = await call('run_agent', { agentId: randomUUID() }, 'Bearer user-token', { userId: owner });
    expect(result).toMatchObject({ success: false, error: 'Agent not found or unauthorized' });
  });
});
