// The canvas window manifest in the page-context block. That block rides on
// the user message of the turn where it changes (turnContext.js), never in
// the system prompt, so these tests read the block itself.
//
// Federation puts several surface blocks in the prompt at once. Without a
// manifest in front of them the model sees a workflow graph and a file side by
// side and has no way to know they are two windows the user is looking at,
// which one is focused, or that a third window exists whose state was budgeted
// out. That last one matters most: silence would read as "there is only one".

import { describe, expect, it } from 'vitest';
import { buildPageContextBlock } from './buildUnifiedPrompt.js';

const pageContext = (ctx) => buildPageContextBlock(ctx);

const frozen = { skillsCatalogSection: '', memorySection: '', customInstructionsSection: '' };
const base = { userId: 'u1', latestUserMessage: 'hi', normalizedProvider: 'anthropic' };

const HEADER = 'OPEN CANVAS WINDOWS';

const canvas = (surfaces, extra = {}) => ({
  ...base,
  workspaceState: { id: 'ws_1', name: 'Build', surfaces },
  ...extra,
});

describe('OPEN CANVAS WINDOWS block', () => {
  it('is absent for every sidebar chat — nothing changes off the canvas', async () => {
    const prompt = await pageContext(
      { ...base, workflowId: 'wf_9', workflowState: { id: 'wf_9', nodes: [], edges: [] } });
    expect(prompt).not.toContain(HEADER);
  });

  it('is absent when the canvas holds nothing but the conversation', async () => {
    const prompt = await pageContext(canvas([]));
    expect(prompt).not.toContain(HEADER);
  });

  it('names each window with the instanceId the canvas tools take', async () => {
    const prompt = await pageContext(
      canvas(
        [
          { instanceId: 'w_1', widgetId: 'workflow-forge', name: 'Workflow Forge', bound: 'workflow wf_9', focused: true, stateIncluded: true },
          { instanceId: 'w_2', widgetId: 'artifacts', name: 'Artifacts', bound: 'file /a.html', focused: false, stateIncluded: true },
        ],
        { workflowId: 'wf_9', workflowState: { id: 'wf_9', nodes: [], edges: [] } },
      ));
    expect(prompt).toContain(HEADER);
    expect(prompt).toContain('instanceId `w_1`');
    expect(prompt).toContain('instanceId `w_2`');
    expect(prompt).toContain('Workflow Forge');
    expect(prompt).toContain('bound to `workflow wf_9`');
    expect(prompt).toContain('bound to `file /a.html`');
  });

  it('marks the focused window, because that is what "this" means', async () => {
    const prompt = await pageContext(
      canvas([
        { instanceId: 'w_1', widgetId: 'artifacts', name: 'Artifacts', focused: true, stateIncluded: true },
        { instanceId: 'w_2', widgetId: 'artifacts', name: 'Artifacts', focused: false, stateIncluded: false },
      ]));
    const focusedLine = prompt.split('\n').find((l) => l.includes('instanceId `w_1`'));
    const otherLine = prompt.split('\n').find((l) => l.includes('instanceId `w_2`'));
    expect(focusedLine).toContain('FOCUSED');
    expect(otherLine).not.toContain('FOCUSED');
  });

  it('tells the model how to read a window whose state was budgeted out', async () => {
    const prompt = await pageContext(
      canvas([
        { instanceId: 'w_1', widgetId: 'workflow-forge', name: 'Workflow Forge', focused: true, stateIncluded: true },
        { instanceId: 'w_2', widgetId: 'workflow-forge', name: 'Workflow Forge', focused: false, stateIncluded: false },
      ]));
    const line = prompt.split('\n').find((l) => l.includes('instanceId `w_2`'));
    expect(line).toContain('state NOT included');
    expect(line).toContain('inspect_canvas_widget');
  });

  it('sits INSIDE the page-context section, above the surface blocks it describes', async () => {
    const prompt = await pageContext(
      canvas(
        [{ instanceId: 'w_1', widgetId: 'workflow-forge', name: 'Workflow Forge', focused: true, stateIncluded: true }],
        { workflowId: 'wf_9', workflowState: { id: 'wf_9', nodes: [], edges: [] } },
      ));
    const header = prompt.indexOf('CURRENT PAGE CONTEXT');
    const manifest = prompt.indexOf(HEADER);
    const workflowBlock = prompt.indexOf('You are Annie, a workflow assistant');
    expect(header).toBeGreaterThan(-1);
    expect(manifest).toBeGreaterThan(header);
    expect(workflowBlock).toBeGreaterThan(manifest);
  });

  it('carries several surface blocks in ONE prompt — the point of federation', async () => {
    const prompt = await pageContext(
      canvas(
        [
          { instanceId: 'w_1', widgetId: 'workflow-forge', name: 'Workflow Forge', focused: true, stateIncluded: true },
          { instanceId: 'w_2', widgetId: 'widget-forge', name: 'Widget Forge', focused: false, stateIncluded: true },
        ],
        {
          workflowId: 'wf_9',
          workflowState: { id: 'wf_9', nodes: [], edges: [] },
          widgetId: 'widget-forge',
          widgetState: { id: 'widget-forge', source_code: '<div>hi</div>' },
        },
      ));
    expect(prompt).toContain('You are Annie, a workflow assistant');
    expect(prompt).toContain('creating, editing, and configuring AGNT dashboard widgets');
  });

  it('is deterministic — an unchanged page produces the same block, so it is not re-sent', async () => {
    const ctx = canvas(
      [{ instanceId: 'w_1', widgetId: 'artifacts', name: 'Artifacts', focused: true, stateIncluded: true }],
      { codeId: 'artifacts', codeContext: { openFilePath: '/a.html', openFileContent: 'x', consoleMessages: [] } },
    );
    expect(await pageContext(ctx)).toBe(await pageContext(ctx));
  });

  it('survives a malformed manifest instead of throwing mid-turn', async () => {
    const prompt = await pageContext(
      { ...base, workspaceState: { id: 'ws_1', surfaces: 'not-an-array' } });
    expect(prompt).not.toContain(HEADER);
  });
});
