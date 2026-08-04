// A canvas turn is an ORCHESTRATOR turn that happens to carry many surfaces.
//
// Two single-winner ladders in this file were written when a chat could only
// look at one surface. The moment the canvas chat starts sending a second
// surface's state, both would mis-fire — quietly, and in ways that look like
// the model got worse rather than like a routing bug:
//
//   detectChatType         sees workflowState -> 'workflow' -> 25 tool rounds
//   detectSidebarSpecialty sees workflowState -> ten workflow tools, no shell,
//                          no files, no search
//
// These tests are the whole reason federation can be turned on safely.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));

import { detectChatType, getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { DEFAULT_TOOLS, TOOL_GROUPS } from './toolSelector.js';

const schema = (name) => ({
  type: 'function',
  function: { name, description: `${name} does a thing.`, parameters: { type: 'object', properties: {} } },
});

function buildRegistry() {
  const names = new Set(DEFAULT_TOOLS);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) names.add(n);
  return [...names].map(schema);
}

const namesOf = (s) => s.map((x) => x.function.name);
const getToolSchemas = (ctx) => getChatConfig('orchestrator').getToolSchemas(ctx);

beforeEach(() => {
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockResolvedValue(buildRegistry());
});

describe('detectChatType — a canvas turn stays an orchestrator turn', () => {
  const canvasBody = (extra) => ({
    workspaceState: { id: 'ws_1', surfaces: [{ instanceId: 'w_1', widgetId: 'workflow-forge' }] },
    ...extra,
  });

  it('is orchestrator even while federating a workflow window', () => {
    const req = { path: '/orchestrator/chat', body: canvasBody({ workflowState: { id: 'wf_9' } }) };
    expect(detectChatType(req)).toBe('orchestrator');
  });

  it('is orchestrator while federating FIVE surfaces at once', () => {
    const req = {
      path: '/orchestrator/chat',
      body: canvasBody({
        workflowState: { id: 'wf_9' },
        widgetState: { id: 'cw_1' },
        toolState: { id: 't_1' },
        agentState: { id: 'agent-chat' },
        codeContext: { openFilePath: '/a.html' },
      }),
    };
    expect(detectChatType(req)).toBe('orchestrator');
  });

  it('keeps 100 tool rounds — the regression this guard prevents is 100 -> 25', () => {
    const req = { path: '/orchestrator/chat', body: canvasBody({ workflowState: { id: 'wf_9' } }) };
    expect(getChatConfig(detectChatType(req)).maxToolRounds).toBe(100);
  });

  it('leaves every sidebar surface classified exactly as before', () => {
    expect(detectChatType({ path: '/orchestrator/chat', body: { workflowState: { id: 'wf_9' } } })).toBe('workflow');
    expect(detectChatType({ path: '/orchestrator/chat', body: { widgetId: 'cw_1' } })).toBe('widget');
    expect(detectChatType({ path: '/orchestrator/chat', body: { toolState: {} } })).toBe('tool');
    expect(detectChatType({ path: '/orchestrator/chat', body: { codeContext: {} } })).toBe('artifact');
    expect(detectChatType({ path: '/orchestrator/chat', body: { agentState: {} } })).toBe('agent');
    expect(detectChatType({ path: '/orchestrator/chat', body: {} })).toBe('orchestrator');
  });

  it('an explicit route still wins — the sidebar endpoints are unambiguous', () => {
    const req = { path: '/orchestrator/workflow-chat', body: { workspaceState: { id: 'ws_1' } } };
    expect(detectChatType(req)).toBe('workflow');
  });
});

describe('tool surface — a canvas turn is NOT narrowed to one specialty', () => {
  const canvasCtx = (extra) => ({
    latestUserMessage: 'update this',
    enabledTools: null,
    workspaceState: { id: 'ws_1', surfaces: [{ instanceId: 'w_1', widgetId: 'workflow-forge' }] },
    ...extra,
  });

  it('keeps shell and file tools while a Workflow Forge window is open', async () => {
    const tools = namesOf(await getToolSchemas(canvasCtx({ workflowState: { id: 'wf_9' } })));
    // The specialty list contains none of these; a narrowed turn loses them.
    expect(tools).toContain('execute_shell_command');
    expect(tools).toContain('read_file');
    expect(tools).toContain('web_search');
  });

  it('still carries the surface tools for EVERY open window, in one turn', async () => {
    const tools = namesOf(
      await getToolSchemas(
        canvasCtx({
          workflowState: { id: 'wf_9' },
          widgetState: { id: 'cw_1' },
          codeContext: { openFilePath: '/a.html' },
        }),
      ),
    );
    expect(tools).toContain('update_workflow');
    expect(tools).toContain('edit_widget_code');
    expect(tools).toContain('write_file');
  });

  it('records mode `auto`, not `specialty` — the ladder really did decline', async () => {
    const ctx = canvasCtx({ workflowState: { id: 'wf_9' } });
    await getToolSchemas(ctx);
    expect(ctx._toolSurfaceMeta.mode).toBe('auto');
  });

  it('ANTI-VACUITY: the identical context WITHOUT the canvas envelope IS narrowed', async () => {
    // Proves the assertions above are testing the guard rather than a surface
    // that was never narrowed in the first place.
    const sidebar = { latestUserMessage: 'update this', enabledTools: null, workflowState: { id: 'wf_9' } };
    const tools = namesOf(await getToolSchemas(sidebar));
    expect(sidebar._toolSurfaceMeta.mode).toBe('specialty');
    expect(tools).toContain('update_workflow');
    expect(tools).not.toContain('execute_shell_command');
  });

  it('a user tool selection still bounds a canvas turn — widgets cannot grant tools', async () => {
    const ctx = canvasCtx({ workflowState: { id: 'wf_9' }, enabledTools: new Set(['web_search']) });
    const tools = namesOf(await getToolSchemas(ctx));
    expect(tools).toContain('web_search');
    expect(tools).not.toContain('update_workflow');
    expect(ctx._toolCeiling.has('update_workflow')).toBe(false);
  });
});
