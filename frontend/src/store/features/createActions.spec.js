/**
 * The create actions talk to the routes the backend actually has.
 *
 * workflows/createWorkflow POSTed to /workflows/ and tools/createTool to
 * /custom-tools/ — neither route exists, so both always failed. And
 * /agents/save answers { agentId } with no agent, so agents/createAgent put
 * the new agent in the store with id undefined.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://api' } }));
const saveTool = vi.hoisted(() => vi.fn());
vi.mock('@/views/Terminal/RightPanel/types/ToolForgePanel/components/ToolPanel/components/TopMenu/components/ToolActions/toolActionsApi.js', () => ({
  saveTool,
  getTool: vi.fn(),
}));

import agents from './agents.js';
import workflows from './workflows.js';
import tools from './tools.js';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
let commit;
beforeEach(() => {
  commit = vi.fn();
  localStorage.setItem('token', 't');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('agents/createAgent', () => {
  it('puts the id the server minted on the stored agent and returns it', async () => {
    fetch.mockReturnValueOnce(ok({ message: 'New agent created', agentId: 'a-new' }));
    const res = await agents.actions.createAgent({ commit }, { name: 'Scout', avatar: '🦊' });
    expect(fetch).toHaveBeenCalledWith('http://api/agents/save', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body).agent).toMatchObject({ name: 'Scout', icon: '🦊' });
    expect(commit).toHaveBeenCalledWith('ADD_AGENT', expect.objectContaining({ id: 'a-new', name: 'Scout', avatar: '🦊' }));
    expect(res.agentId).toBe('a-new');
  });
});

describe('workflows/createWorkflow', () => {
  it('saves through /workflows/save with a fresh id and stores the whole workflow', async () => {
    fetch.mockImplementationOnce((url, init) => ok({ message: 'New workflow created', workflowId: JSON.parse(init.body).workflow.id }));
    const created = await workflows.actions.createWorkflow({ commit }, { name: 'Digest', description: '' });
    expect(fetch.mock.calls[0][0]).toBe('http://api/workflows/save');
    const sent = JSON.parse(fetch.mock.calls[0][1].body).workflow;
    expect(sent).toMatchObject({ name: 'Digest', nodes: [], edges: [] });
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toEqual({ ...sent });
    expect(commit).toHaveBeenCalledWith('ADD_WORKFLOW', created);
  });

  it('two creates are two workflows', async () => {
    fetch.mockImplementation((url, init) => ok({ workflowId: JSON.parse(init.body).workflow.id }));
    const a = await workflows.actions.createWorkflow({ commit }, { name: 'A' });
    const b = await workflows.actions.createWorkflow({ commit }, { name: 'B' });
    expect(a.id).not.toBe(b.id);
  });

  it('a refused save throws and stores nothing', async () => {
    fetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) }));
    await expect(workflows.actions.createWorkflow({ commit }, { name: 'X' })).rejects.toThrow('400');
    expect(commit).not.toHaveBeenCalledWith('ADD_WORKFLOW', expect.anything());
  });
});

describe('tools/createTool', () => {
  it('creates through saveTool WITHOUT an id (an id would update), and stores the new id', async () => {
    saveTool.mockResolvedValueOnce({ message: 'New custom tool created', toolId: 't-new', id: 't-new' });
    const dispatch = vi.fn(() => Promise.resolve());
    const created = await tools.actions.createTool({ commit, dispatch }, { id: 'stale', title: 'Summarize', base: 'AI' });
    expect(saveTool).toHaveBeenCalledWith({ title: 'Summarize', base: 'AI' });
    expect(created).toMatchObject({ id: 't-new', title: 'Summarize', is_builtin: false });
    expect(commit).toHaveBeenCalledWith('ADD_TOOL', created);
    expect(dispatch).toHaveBeenCalledWith('fetchTools');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('no id back is an error', async () => {
    saveTool.mockResolvedValueOnce({});
    await expect(tools.actions.createTool({ commit, dispatch: vi.fn() }, { title: 'X' })).rejects.toThrow(/id/);
  });
});
