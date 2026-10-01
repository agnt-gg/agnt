import { describe, it, expect } from 'vitest';
import {
  agentValues,
  agentPayload,
  cleanIcon,
  workflowValues,
  workflowStepOrder,
  workflowPayload,
  toolValues,
  toolPayload,
  validateToolInputs,
  cleanInputKey,
  renameInPrompt,
  isReadOnlySkill,
  skillPayload,
  widgetUpdates,
  humanKey,
  paramKind,
  ago,
} from './focusedEditors.js';

describe('agents', () => {
  const stored = { id: 'a1', name: 'Scout', status: 'ACTIVE', avatar: '🦊', systemPrompt: 'old', assignedSkills: ['s'], creditLimit: 50, fallbackProviders: ['x'] };

  it('round-trips, keeping every field the editor does not show', () => {
    const v = agentValues(stored);
    expect(v).toMatchObject({ name: 'Scout', icon: '🦊', active: true, systemPrompt: 'old' });
    const p = agentPayload(stored, { ...v, name: ' Scout 2 ', systemPrompt: 'new', active: false });
    expect(p).toMatchObject({ id: 'a1', name: 'Scout 2', systemPrompt: 'new', status: 'INACTIVE', avatar: '🦊', assignedSkills: ['s'], creditLimit: 50, fallbackProviders: ['x'] });
  });

  it('keeps the status spelling the record uses', () => {
    expect(agentPayload({ status: 'active' }, { ...agentValues({}), active: false }).status).toBe('inactive');
  });

  it('cleanIcon keeps one emoji (two code points max)', () => {
    expect(cleanIcon(' 🤖x ')).toBe('🤖x');
    expect(cleanIcon('abc')).toBe('ab');
    expect(cleanIcon('')).toBe('');
  });
});

describe('workflows', () => {
  const raw = {
    id: 'w',
    name: 'Daily',
    status: 'listening',
    created_at: 'c',
    edges: [
      { start: { id: 't' }, end: { id: 'b' } },
      { source: 'b', target: 'c' },
    ],
    nodes: [
      { id: 'c', text: 'Send', parameters: { to: 'me' }, x: 3 },
      { id: 'lonely', text: 'Orphan', parameters: {} },
      { id: 'b', text: 'Fetch', parameters: { url: 'u' } },
      { id: 't', text: 'Every day', category: 'trigger', parameters: {} },
    ],
  };

  it('orders steps as they run: trigger, then along the edges, orphans last', () => {
    expect(workflowStepOrder(raw)).toEqual(['t', 'b', 'c', 'lonely']);
  });

  it('survives a graph with no trigger, cycles and dangling edges', () => {
    expect(workflowStepOrder({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }, { source: 'a', target: 'ghost' }] })).toEqual(['a', 'b']);
    expect(workflowStepOrder({})).toEqual([]);
  });

  it('saves names and settings onto the fresh graph, never the editor copy', () => {
    const v = workflowValues(raw);
    v.name = ' Daily 2 ';
    v.nodes.find((n) => n.id === 'b').parameters.url = 'u2';
    expect(raw.nodes[2].parameters.url).toBe('u'); // the editor's copy is a clone
    const fresh = { ...raw, nodes: [...raw.nodes, { id: 'added-elsewhere', text: 'New' }] };
    const p = workflowPayload(fresh, v);
    expect(p.name).toBe('Daily 2');
    expect(p.nodes.find((n) => n.id === 'b').parameters.url).toBe('u2');
    expect(p.nodes.find((n) => n.id === 'c').x).toBe(3); // positions kept
    expect(p.nodes.some((n) => n.id === 'added-elsewhere')).toBe(true); // concurrent addition kept
    expect(p.edges).toBe(raw.edges);
    expect('status' in p || 'created_at' in p).toBe(false);
  });
});

describe('tools', () => {
  const ai = {
    id: 't',
    title: 'Summarizer',
    base: 'AI',
    code: 'unused',
    is_shareable: 1,
    parameters: JSON.stringify({ text: { type: 'textarea', label: 'Text', required: true, extra: 'kept' }, instructions: 'Sum {{text}}', provider: 'Anthropic', model: 'm' }),
  };

  it('reads AI tools: prompt, provider, inputs without the meta keys', () => {
    const v = toolValues(ai);
    expect(v).toMatchObject({ isAI: true, instructions: 'Sum {{text}}', provider: 'Anthropic', model: 'm' });
    expect(v.inputs.map((i) => i.key)).toEqual(['text']);
  });

  it('renaming an input renames its placeholder and keeps its other settings', () => {
    const v = toolValues(ai);
    v.inputs[0].key = 'body';
    v.instructions = renameInPrompt(v.instructions, 'text', 'body');
    const p = toolPayload(ai, v);
    expect(p.parameters.body).toMatchObject({ type: 'textarea', required: true, extra: 'kept' });
    expect(p.parameters.instructions).toBe('Sum {{body}}');
    expect(p.code).toBe('unused'); // AI tools keep their stored code
    expect(p.isShareable).toBe(true);
  });

  it('code tools save their code', () => {
    const v = toolValues({ id: 'c', title: 'Fetch', base: 'JS', code: 'old', parameters: {} });
    v.code = 'new';
    expect(toolPayload({ id: 'c', code: 'old', parameters: {} }, v).code).toBe('new');
  });

  it('refuses inputs that would break the tool', () => {
    expect(() => validateToolInputs([{ key: '' }])).toThrow('needs a name');
    expect(() => validateToolInputs([{ key: 'a' }, { key: 'a' }])).toThrow('same name');
    expect(() => validateToolInputs([{ key: 'model' }])).toThrow('can’t be used');
    expect(validateToolInputs([{ key: 'a' }, { key: 'b' }])).toBeNull();
  });

  it('input names cannot hold braces or spaces', () => {
    expect(cleanInputKey('my {{name}} x')).toBe('mynamex');
  });

  it('survives junk parameters', () => {
    expect(toolValues({ parameters: '{not json' }).inputs).toEqual([]);
    expect(toolValues({ parameters: ['x'] }).inputs).toEqual([]);
  });
});

describe('skills and widgets', () => {
  it('skills on disk or built in are read-only', () => {
    expect(isReadOnlySkill({ id: 'fs-abc' })).toBe(true);
    expect(isReadOnlySkill({ id: 's', is_builtin: 1 })).toBe(true);
    expect(isReadOnlySkill({ id: 's' })).toBe(false);
  });

  it('skill payload trims and defaults the category', () => {
    expect(skillPayload({ name: ' a ', description: ' b ', instructions: ' c ', category: ' ' })).toEqual({ name: 'a', description: 'b', instructions: ' c ', category: 'general' });
  });

  it('widgets send only what changed, and never trim code', () => {
    const base = { name: 'W', description: 'd', source_code: '<b> </b>' };
    expect(widgetUpdates(base, { ...base })).toEqual({});
    expect(widgetUpdates(base, { ...base, name: ' W2 ', source_code: ' x ' })).toEqual({ name: 'W2', source_code: ' x ' });
  });
});

describe('helpers', () => {
  it('humanKey', () => {
    expect(humanKey('maxRetries')).toBe('Max retries');
    expect(humanKey('api_base-url')).toBe('Api base url');
  });

  it('paramKind picks the control from the value', () => {
    expect(paramKind(true)).toBe('switch');
    expect(paramKind(3)).toBe('number');
    expect(paramKind({ a: 1 })).toBe('json');
    expect(paramKind('x'.repeat(61))).toBe('textarea');
    expect(paramKind('a\nb')).toBe('textarea');
    expect(paramKind(null)).toBe('text');
  });

  it('ago', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(ago('2026-10-01T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-10-01T11:30:00Z', now)).toBe('30 min ago');
    expect(ago('2026-09-30T12:00:00Z', now)).toBe('1 day ago');
    expect(ago(null, now)).toBe('');
  });
});
