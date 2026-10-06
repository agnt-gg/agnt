import { describe, it, expect } from 'vitest';
import {
  agentValues,
  agentPayload,
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
  widgetValues,
  skillValues,
  blankRecord,
  humanKey,
  paramKind,
  ago,
  toolBase,
  workflowNodeFromTool,
  addWorkflowStep,
  removeWorkflowStep,
  stepLibraryGroups,
  visibleStepParams,
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

  it('carries an image avatar through untouched', () => {
    const image = 'data:image/png;base64,iVBORw0KGgo=';
    expect(agentPayload({ avatar: image }, agentValues({ avatar: image })).avatar).toBe(image);
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
    expect(v).toMatchObject({ base: 'AI', instructions: 'Sum {{text}}', provider: 'Anthropic', model: 'm' });
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

describe('new items (blankRecord)', () => {
  // A new item is edited by the same values/payload pair as a stored one, so
  // what Save creates is exactly what the editor showed.
  it('a new workflow is named, empty, and valid for the engine', () => {
    const v = workflowValues(blankRecord('workflows'));
    v.name = ' Morning digest ';
    expect(workflowPayload(blankRecord('workflows'), v)).toEqual({ name: 'Morning digest', description: '', nodes: [], edges: [] });
  });
  it('a new tool is a prompt (AI) tool with its model fields', () => {
    const v = toolValues(blankRecord('tools'));
    expect(v).toMatchObject({ name: '', base: 'AI', instructions: '', inputs: [], category: 'custom' });
    Object.assign(v, { name: 'Summarize', instructions: 'Summarize {{text}}' });
    v.inputs.push({ key: 'text', label: 'Text', type: 'textarea', required: true });
    const p = toolPayload(blankRecord('tools'), v);
    expect(p).toMatchObject({ title: 'Summarize', base: 'AI', isShareable: false, parameters: { text: { type: 'textarea', required: true }, instructions: 'Summarize {{text}}' } });
    expect(p.id).toBeUndefined();
  });
  it('a new skill and widget start blank', () => {
    expect(skillValues(blankRecord('skills'))).toEqual({ name: '', description: '', instructions: '', category: 'general' });
    expect(widgetValues(blankRecord('widgets'))).toEqual({ name: '', description: '', source_code: '' });
    expect(blankRecord('widgets').widget_type).toBe('html');
  });
});

describe('tool type: Prompt, JavaScript or Python', () => {
  it('reads every stored spelling as a type the executor runs', () => {
    expect(toolBase({})).toBe('AI');
    expect(toolBase({ base: 'AI' })).toBe('AI');
    expect(toolBase({ base: 'CODE_JS' })).toBe('CODE_JS');
    expect(toolBase({ base: 'JS' })).toBe('CODE_JS');
    expect(toolBase({ base: 'CODE_PYTHON' })).toBe('CODE_PYTHON');
    expect(toolBase({ base: 'python' })).toBe('CODE_PYTHON');
  });

  it('regression: a new tool can be made a JavaScript tool — code saved, no prompt fields', () => {
    const v = toolValues(blankRecord('tools'));
    Object.assign(v, { name: 'Word Count', base: 'CODE_JS', code: 'console.log(params.text.split(" ").length)' });
    v.inputs.push({ key: 'text', label: 'Text', type: 'textarea', required: true });
    const p = toolPayload(blankRecord('tools'), v);
    expect(p).toMatchObject({ base: 'CODE_JS', code: 'console.log(params.text.split(" ").length)', parameters: { text: { type: 'textarea' } } });
    expect(Object.keys(p.parameters)).toEqual(['text']); // no instructions/provider/model on a code tool
  });

  it('a new Python tool saves as CODE_PYTHON', () => {
    const v = { ...toolValues(blankRecord('tools')), name: 'Py', base: 'CODE_PYTHON', code: 'print(1)' };
    expect(toolPayload(blankRecord('tools'), v)).toMatchObject({ base: 'CODE_PYTHON', code: 'print(1)' });
  });

  it('switching a code tool to Prompt drops its code (an AI tool with code is run as code)', () => {
    const stored = { id: 'c', title: 'T', base: 'CODE_JS', code: 'x()', parameters: {} };
    const v = { ...toolValues(stored), base: 'AI', instructions: 'Do it' };
    const p = toolPayload(stored, v);
    expect(p).toMatchObject({ base: 'AI', code: null, parameters: { instructions: 'Do it' } });
  });

  it('regression: a tool made here gets the type, icon and outputs workflows need to use it', () => {
    const v = { ...toolValues(blankRecord('tools')), name: 'Summarize Notes' };
    const p = toolPayload(blankRecord('tools'), v);
    expect(p).toMatchObject({ type: 'summarize-notes', icon: 'custom' });
    expect(Object.keys(p.outputs)).toEqual(['success', 'result', 'error']);
    // A stored tool keeps its own; renaming never re-keys it (workflows reference the type).
    const stored = { id: 't', title: 'Old', type: 'old-name', icon: 'fas fa-x', outputs: { a: {} }, base: 'AI', parameters: {} };
    expect(toolPayload(stored, { ...toolValues(stored), name: 'New name' })).toMatchObject({ type: 'old-name', icon: 'fas fa-x', outputs: { a: {} } });
  });
});

describe('workflow steps added in Focused', () => {
  const library = {
    triggers: [{ type: 'trigger-timer', title: 'Timer Trigger', category: 'trigger', icon: 'clock', parameters: { schedule: { type: 'string', inputType: 'select', options: ['Hourly', 'Daily'], default: 'Hourly' }, tz: { type: 'string', defaultFrom: 'browserTimeZone' } }, outputs: { firedAt: {} } }],
    actions: [
      { type: 'send-email', title: 'Send Email', category: 'action', parameters: { to: { type: 'string' } }, requiresPro: true },
      { type: 'generate-with-ai-llm', title: 'AI LLM Call', category: 'action', parameters: { prompt: { type: 'string', default: '' } }, outputs: { generatedText: {} } },
    ],
    custom: [{ type: 'summarize', title: 'Summarize', category: 'custom', parameters: { instructions: 'Sum', text: { type: 'text', value: '', label: 'text' } } }],
  };
  const [timer] = library.triggers;
  const llm = library.actions[1];
  let n = 0;
  const ids = () => ({ nodeId: `n${++n}`, edgeId: `e${n}`, timeZone: 'Europe/Paris' });
  const ends = (e) => `${e.start.id}>${e.end.id}`;

  it('builds a node exactly as Workflow Forge does', () => {
    const node = workflowNodeFromTool(timer, { id: 'x', timeZone: 'Europe/Paris' });
    expect(node).toMatchObject({ id: 'x', text: 'Timer Trigger', type: 'trigger-timer', category: 'trigger', outputs: { firedAt: {} } });
    expect(node.parameters).toEqual({ schedule: 'Hourly', schedule_options: ['Hourly', 'Daily'], tz: 'Europe/Paris' });
    const custom = workflowNodeFromTool(library.custom[0], { id: 'c' });
    expect(custom.parameters).toEqual({ instructions: 'Sum', text: { type: 'text', value: '', label: 'text' } });
    expect(Object.keys(custom.outputs)).toEqual(['generatedText', 'tokenCount', 'error']);
  });

  it('regression: a new workflow gets a trigger and a step, wired, in a shape the engine runs', () => {
    const blank = blankRecord('workflows');
    const v = workflowValues(blank);
    v.name = 'Daily brief';
    addWorkflowStep(v, blank, timer, ids());
    addWorkflowStep(v, blank, llm, ids());
    const p = workflowPayload(blank, v);
    expect(p.nodes.map((x) => x.type)).toEqual(['trigger-timer', 'generate-with-ai-llm']);
    // What validateWorkflowShape checks: id, text and type on every node; edges between real nodes.
    for (const node of p.nodes) expect(node.id && node.text && node.type).toBeTruthy();
    expect(p.edges.map(ends)).toEqual([`${p.nodes[0].id}>${p.nodes[1].id}`]);
    expect(workflowStepOrder(p)).toEqual(p.nodes.map((x) => x.id));
  });

  it('a step name or setting edited before saving is what gets saved', () => {
    const blank = blankRecord('workflows');
    const v = workflowValues(blank);
    const node = addWorkflowStep(v, blank, llm, ids());
    const card = v.nodes.find((x) => x.id === node.id);
    card.text = 'Write the brief';
    card.parameters.prompt = 'Summarize the news';
    expect(workflowPayload(blank, v).nodes[0]).toMatchObject({ text: 'Write the brief', parameters: { prompt: 'Summarize the news' }, type: 'generate-with-ai-llm' });
  });

  it('a trigger added to an existing chain goes first', () => {
    const stored = { nodes: [{ id: 'a', text: 'A', type: 'x', category: 'action', parameters: {} }], edges: [] };
    const v = workflowValues(stored);
    const t = addWorkflowStep(v, stored, timer, ids());
    expect(workflowPayload(stored, v).edges.map(ends)).toEqual([`${t.id}>a`]);
  });

  it('removing a middle step bridges the chain; removing everything leaves no dangling edge', () => {
    const stored = {
      nodes: ['a', 'b', 'c'].map((id) => ({ id, text: id, type: 'x', parameters: {} })),
      edges: [
        { id: 'ab', start: { id: 'a' }, end: { id: 'b' } },
        { id: 'bc', start: { id: 'b' }, end: { id: 'c' } },
      ],
    };
    const v = workflowValues(stored);
    removeWorkflowStep(v, stored, 'b', { edgeId: 'ac' });
    let p = workflowPayload(stored, v);
    expect(p.nodes.map((x) => x.id)).toEqual(['a', 'c']);
    expect(p.edges.map(ends)).toEqual(['a>c']);
    removeWorkflowStep(v, stored, 'a', { edgeId: 'z1' });
    removeWorkflowStep(v, stored, 'c', { edgeId: 'z2' });
    p = workflowPayload(stored, v);
    expect(p.nodes).toEqual([]);
    expect(p.edges).toEqual([]);
  });

  it('removing a step added here leaves nothing of it behind', () => {
    const blank = blankRecord('workflows');
    const v = workflowValues(blank);
    const t = addWorkflowStep(v, blank, timer, ids());
    const s = addWorkflowStep(v, blank, llm, ids());
    removeWorkflowStep(v, blank, s.id, ids());
    expect(v.added.map((x) => x.id)).toEqual([t.id]);
    expect(v.nodes.map((x) => x.id)).toEqual([t.id]);
    expect(workflowPayload(blank, v).edges).toEqual([]);
  });

  it('the picker lists triggers first, filters by search, and locks Pro steps on a free plan', () => {
    expect(stepLibraryGroups(library).map((g) => g.id)).toEqual(['triggers', 'actions', 'custom']);
    expect(stepLibraryGroups(library, 'llm').flatMap((g) => g.items.map((i) => i.entry.type))).toEqual(['generate-with-ai-llm']);
    const locked = (opts) => stepLibraryGroups(library, 'email', opts)[0].items[0].locked;
    expect(locked({ isPro: false })).toBe(true);
    expect(locked({ isPro: true })).toBe(false);
    expect(stepLibraryGroups(null)).toEqual([]);
  });

  it("a select's choices list is not shown as a setting of its own", () => {
    expect(visibleStepParams({ schedule: 'Hourly', schedule_options: ['Hourly'], extra_options: 'kept' })).toEqual(['schedule', 'extra_options']);
  });
});
