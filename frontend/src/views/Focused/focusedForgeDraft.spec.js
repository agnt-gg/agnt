// Reported 2026-10-23: the forge chats generated but never filled the page.
// Event shapes are the backend's own (toolForgeTools, widgetTools,
// workflowTools via realtime, agentTools).
import { describe, it, expect } from 'vitest';
import { applyFieldDraft, workflowDraftValues, isDraftForWorkflow, agentDraftValues, agentDraftTools } from './focusedForgeDraft.js';
import { workflowPayload, toolValues } from './focusedEditors.js';

describe('tool drafts', () => {
  it('a generated tool fills name, type, prompt and inputs, in the order the backend sends them', () => {
    let v = toolValues({ title: 'Old', parameters: { topic: { type: 'text' }, instructions: 'x' } });
    for (const [type, data] of [
      ['tool-fields-cleared', {}],
      ['tool-field-updated', { field: 'title', value: 'Blog Writer' }],
      ['tool-field-updated', { field: 'description', value: 'Writes posts' }],
      ['tool-field-updated', { field: 'toolType', value: 'AI' }],
      ['tool-field-updated', { field: 'instructions', value: 'Write about {{topic}}' }],
      ['tool-custom-field-added', { fieldName: 'topic', fieldType: 'text', label: 'Topic' }],
      ['tool-custom-field-added', { fieldName: 'tone', fieldType: 'select', label: 'Tone', value: 'casual' }],
    ]) v = applyFieldDraft('tools', v, type, data) || v;
    expect([v.name, v.description, v.base, v.instructions]).toEqual(['Blog Writer', 'Writes posts', 'AI', 'Write about {{topic}}']);
    expect(v.inputs.map((i) => [i.key, i.type, i.label, i.value])).toEqual([['topic', 'text', 'Topic', undefined], ['tone', 'select', 'Tone', 'casual']]);
    expect(applyFieldDraft('tools', v, 'tool-field-updated', { field: 'toolType', value: 'CODE_JS' }).base).toBe('CODE_JS');
    expect(applyFieldDraft('tools', v, 'tool-custom-field-removed', { fieldName: 'tone' }).inputs.map((i) => i.key)).toEqual(['topic']);
    expect(applyFieldDraft('tools', v, 'tool-field-updated', { field: 'nonsense', value: 1 })).toBeNull();
  });
});

describe('widget drafts', () => {
  it('fills name, description and code; other fields and kinds are not touched', () => {
    const v = { name: '', description: '', source_code: '' };
    expect(applyFieldDraft('widgets', v, 'widget-field-updated', { field: 'source_code', value: '<div>Hi</div>' }).source_code).toBe('<div>Hi</div>');
    expect(applyFieldDraft('widgets', v, 'widget-field-updated', { field: 'icon', value: 'x' })).toBeNull();
    expect(applyFieldDraft('skills', v, 'widget-field-updated', { field: 'name', value: 'x' })).toBeNull();
  });
});

describe('workflow drafts', () => {
  const stored = {
    id: 'w1', name: 'Daily', description: '',
    nodes: [{ id: 'a', text: 'Timer', type: 'trigger-timer', parameters: {} }, { id: 'b', text: 'Old step', type: 'x', parameters: {} }],
    edges: [{ id: 'e1', start: { id: 'a' }, end: { id: 'b' } }],
  };
  const draft = {
    id: 'w1', name: 'Daily news',
    nodes: [{ id: 'a', text: 'Every morning', type: 'trigger-timer', parameters: { schedule: 'Daily' } }, { id: 'c', text: 'Search news', type: 'web-search', parameters: { q: 'AI' } }],
    edges: [{ id: 'e2', start: { id: 'a' }, end: { id: 'c' } }],
  };
  it('saves as exactly Annie\u2019s graph: steps added and removed, settings and wiring', () => {
    const v = workflowDraftValues(stored, draft, { name: 'Daily', description: '' });
    const saved = workflowPayload(stored, v);
    expect(saved.name).toBe('Daily news');
    expect(saved.nodes.map((n) => [n.id, n.text, n.parameters])).toEqual([['a', 'Every morning', { schedule: 'Daily' }], ['c', 'Search news', { q: 'AI' }]]);
    expect(saved.edges.map((e) => e.id)).toEqual(['e2']);
  });
  it('only takes the broadcast for the workflow on screen (or a new one)', () => {
    expect(isDraftForWorkflow({ id: 'w1' }, 'w1')).toBe(true);
    expect(isDraftForWorkflow({ id: 'w2' }, 'w1')).toBe(false);
    expect(isDraftForWorkflow({ id: 'default' }, null)).toBe(true);
    expect(isDraftForWorkflow({ id: 'w2' }, null)).toBe(false);
  });
});

describe('agent drafts', () => {
  it('her instructions become the agent\u2019s system prompt; blanks keep what is there', () => {
    const current = { name: 'Kai', description: 'd', systemPrompt: 'old', provider: 'openai', model: 'm', icon: '', active: true };
    expect(agentDraftValues({ name: 'Kai 2', instructions: 'You code.', description: '' }, current)).toEqual({ ...current, name: 'Kai 2', systemPrompt: 'You code.' });
    expect(agentDraftTools({ tools: ['web_search', { name: 'file_operations' }] })).toEqual(['web_search', 'file_operations']);
    expect(agentDraftTools({ tools: [] })).toBeNull();
  });
});
