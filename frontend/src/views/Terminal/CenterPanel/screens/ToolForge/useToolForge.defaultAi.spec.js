/**
 * An AI tool on "Default AI" is saved and loaded with an EMPTY provider and
 * model, so the backend runs it on whatever the user has selected at the time
 * (CustomToolExecutor -> resolveAccountAi). Until 2026-10-21 saving and loading
 * filled in the current selection, pinning every tool to that day's model.
 */
import { describe, it, expect, vi } from 'vitest';

const saved = [];
vi.mock('@/views/Terminal/RightPanel/types/ToolForgePanel/components/ToolPanel/components/TopMenu/components/ToolActions/toolActionsApi.js', () => ({
  saveTool: vi.fn(async (tool) => { saved.push(tool); return { toolId: tool.id }; }),
  fetchTools: vi.fn(async () => []),
  getTool: vi.fn(async () => null),
  deleteTool: vi.fn(),
}));
vi.mock('@/views/_components/base/stream', () => ({ handleGenerateClick: vi.fn() }));
vi.mock('@/store/state', () => ({ default: { state: { aiProvider: { selectedProvider: 'anthropic', selectedModel: 'claude-3' } } } }));

const { default: useToolForge } = await import('./useToolForge.js');

describe('Default AI tools', () => {
  it('save with no provider: stored empty, not as the current selection', async () => {
    const { saveToolTemplate } = useToolForge();
    await saveToolTemplate({ name: 'Summarise', toolType: 'AI', promptTemplate: 'Summarise {{text}}', provider: '', model: '', fields: [] });
    expect(saved.at(-1).parameters).toMatchObject({ provider: '', model: '' });
  });

  it('a pinned provider and model are saved as chosen', async () => {
    const { saveToolTemplate } = useToolForge();
    await saveToolTemplate({ name: 'Pinned', toolType: 'AI', promptTemplate: 'x', provider: 'openai', model: 'gpt-4', fields: [] });
    expect(saved.at(-1).parameters).toMatchObject({ provider: 'openai', model: 'gpt-4' });
  });

  it('loading a Default AI tool keeps it on Default AI', async () => {
    const { getTool } = await import('@/views/Terminal/RightPanel/types/ToolForgePanel/components/ToolPanel/components/TopMenu/components/ToolActions/toolActionsApi.js');
    getTool.mockResolvedValueOnce({ id: 't1', base: 'AI', title: 'Summarise', parameters: { instructions: 'x', provider: '', model: '' } });
    const { loadTool } = useToolForge();
    expect(await loadTool('t1')).toMatchObject({ provider: '', model: '' });
  });
});
