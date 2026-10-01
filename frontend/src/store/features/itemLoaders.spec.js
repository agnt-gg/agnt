// Full-item loaders the Focused editors (and any screen) share.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://local/api' } }));
const { getTool, saveTool } = vi.hoisted(() => ({ getTool: vi.fn(), saveTool: vi.fn() }));
vi.mock('@/views/Terminal/RightPanel/types/ToolForgePanel/components/ToolPanel/components/TopMenu/components/ToolActions/toolActionsApi.js', () => ({ getTool, saveTool }));

import workflows from './workflows.js';
import tools from './tools.js';

describe('workflows/fetchWorkflowById', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'tok');
    global.fetch = vi.fn();
  });

  it('returns the full workflow and commits nothing', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ workflow: { id: 'w 1', nodes: [{ id: 'n' }] } }) });
    const commit = vi.fn();
    const wf = await workflows.actions.fetchWorkflowById({ commit }, 'w 1');
    expect(wf).toEqual({ id: 'w 1', nodes: [{ id: 'n' }] });
    expect(fetch.mock.calls[0][0]).toBe('http://local/api/workflows/w%201');
    expect(commit).not.toHaveBeenCalled();
  });

  it('fails loudly', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(workflows.actions.fetchWorkflowById({}, 'gone')).rejects.toThrow('404');
    await expect(workflows.actions.fetchWorkflowById({}, '')).rejects.toThrow('No workflow id');
  });
});

describe('tools custom-tool loaders', () => {
  beforeEach(() => {
    getTool.mockReset();
    saveTool.mockReset();
  });

  it('fetchCustomTool unwraps the tool', async () => {
    getTool.mockResolvedValueOnce({ tool: { id: 't', title: 'Scraper' } });
    await expect(tools.actions.fetchCustomTool({}, 't')).resolves.toEqual({ id: 't', title: 'Scraper' });
  });

  it('saveCustomTool updates in place and refreshes the list', async () => {
    saveTool.mockResolvedValueOnce({ id: 't' });
    const dispatch = vi.fn(() => Promise.resolve());
    await tools.actions.saveCustomTool({ dispatch }, { id: 't', title: 'New' });
    expect(saveTool).toHaveBeenCalledWith({ id: 't', title: 'New' });
    expect(dispatch).toHaveBeenCalledWith('fetchTools');
  });

  it('saveCustomTool refuses to create, and catches a save that made a copy', async () => {
    await expect(tools.actions.saveCustomTool({ dispatch: vi.fn() }, { title: 'x' })).rejects.toThrow('needs an id');
    saveTool.mockResolvedValueOnce({ id: 'copy' });
    await expect(tools.actions.saveCustomTool({ dispatch: vi.fn() }, { id: 't' })).rejects.toThrow('copy');
  });
});
