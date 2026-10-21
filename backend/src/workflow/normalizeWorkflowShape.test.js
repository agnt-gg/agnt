/**
 * Reported 2026-10-21 (AGNT One): a workflow the main chat built opened in the
 * full editor with every node stacked in one corner and a canvas that would
 * not pan, zoom or select. Its nodes were React-Flow shaped
 * ({ position, data: { label, parameters } }); the Forge reads x, y, text and
 * parameters. The fixture below is that workflow's exact shape (values
 * shortened).
 */
import { describe, it, expect } from 'vitest';
import { normalizeWorkflowShape, normalizeWorkflowJson } from './normalizeWorkflowShape.js';
import { validateWorkflowShape } from './validateWorkflowShape.js';

const reactFlowNode = (id, type, label, x, y, parameters) => ({ id, type, position: { x, y }, data: { label, type, parameters } });
const DAILY_BRIEFING = {
  name: 'Daily AI Briefing',
  nodes: [
    { ...reactFlowNode('trigger-1', 'trigger-timer', 'Daily', 80, 220, { schedule: 'Daily' }), text: 'Daily' },
    { ...reactFlowNode('search-1', 'web-search', 'Search AI News', 380, 220, { query: 'AI news' }), text: 'Search AI News' },
  ],
  edges: [{ id: 'e1', start: { id: 'trigger-1', type: 'trigger-timer' }, end: { id: 'search-1', type: 'web-search' } }],
};
const canonicalNode = (over = {}) => ({ id: 'n1', type: 'delay', text: 'Delay', x: 96, y: 240, parameters: { ms: 5 }, category: 'utility', ...over });

describe('normalizeWorkflowShape', () => {
  it('THE REPORTED WORKFLOW: positions, parameters and edge ends land where the Forge reads them', () => {
    const { workflow, changed } = normalizeWorkflowShape(DAILY_BRIEFING);
    expect(changed).toBe(true);
    expect(workflow.nodes[0]).toEqual({ id: 'trigger-1', type: 'trigger-timer', text: 'Daily', x: 80, y: 220, parameters: { schedule: 'Daily' } });
    expect(workflow.nodes[1]).toMatchObject({ x: 380, y: 220, parameters: { query: 'AI news' } });
    expect(workflow.edges[0]).toEqual({ id: 'e1', start: { id: 'trigger-1', type: 'output' }, end: { id: 'search-1', type: 'input' } });
  });

  it('takes text from data.label, so the save check no longer rejects it', () => {
    const raw = { nodes: [reactFlowNode('a', 'delay', 'Wait', 0, 0, {})], edges: [] };
    expect(validateWorkflowShape(raw).valid).toBe(false);
    const { workflow } = normalizeWorkflowShape(raw);
    expect(workflow.nodes[0].text).toBe('Wait');
    expect(validateWorkflowShape(workflow).valid).toBe(true);
  });

  it('a field already at the top level wins over its copy in data/position', () => {
    const node = { ...canonicalNode(), position: { x: 1, y: 2 }, data: { label: 'Other', parameters: { ms: 9 }, extra: 'kept' } };
    const { workflow } = normalizeWorkflowShape({ nodes: [node], edges: [] });
    expect(workflow.nodes[0]).toMatchObject({ text: 'Delay', x: 96, y: 240, parameters: { ms: 5 } });
    // Unknown data keys survive; only the lifted ones go.
    expect(workflow.nodes[0].data).toEqual({ extra: 'kept' });
    expect(workflow.nodes[0].position).toBeUndefined();
  });

  it('lays out nodes that have no position at all, left to right in edge order, on the 16px grid', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'delay', text: id, parameters: {} }));
    const edges = [
      { id: '1', start: { id: 'a', type: 'output' }, end: { id: 'b', type: 'input' } },
      { id: '2', start: { id: 'a', type: 'output' }, end: { id: 'c', type: 'input' } },
      { id: '3', start: { id: 'b', type: 'output' }, end: { id: 'd', type: 'input' } },
    ];
    const { workflow } = normalizeWorkflowShape({ nodes, edges });
    const at = Object.fromEntries(workflow.nodes.map((n) => [n.id, [n.x, n.y]]));
    expect(at).toEqual({ a: [96, 240], b: [448, 240], c: [448, 400], d: [800, 240] });
    for (const [x, y] of Object.values(at)) expect([x % 16, y % 16]).toEqual([0, 0]);
  });

  it('a cycle cannot loop the layout', () => {
    const nodes = ['a', 'b'].map((id) => ({ id, type: 'delay', text: id }));
    const edges = [
      { id: '1', start: { id: 'a' }, end: { id: 'b' } },
      { id: '2', start: { id: 'b' }, end: { id: 'a' } },
    ];
    const { workflow } = normalizeWorkflowShape({ nodes, edges });
    for (const n of workflow.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it('keeps branch connectors (success/error/true) as they are', () => {
    const nodes = [canonicalNode({ id: 'if', type: 'if-condition' }), canonicalNode({ id: 'b' })];
    const edges = [{ id: 'e', start: { id: 'if', type: 'true' }, end: { id: 'b', type: 'input' } }];
    expect(normalizeWorkflowShape({ nodes, edges }).changed).toBe(false);
  });

  it('a canonical workflow comes back as the same object, unchanged (idempotent)', () => {
    const wf = { nodes: [canonicalNode()], edges: [] };
    const out = normalizeWorkflowShape(wf);
    expect(out).toEqual({ workflow: wf, changed: false });
    expect(out.workflow).toBe(wf);
    const once = normalizeWorkflowShape(DAILY_BRIEFING).workflow;
    expect(normalizeWorkflowShape(once).changed).toBe(false);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(DAILY_BRIEFING);
    normalizeWorkflowShape(DAILY_BRIEFING);
    expect(JSON.stringify(DAILY_BRIEFING)).toBe(before);
  });

  it('leaves non-workflows and blank drafts alone', () => {
    for (const value of [null, 'x', [], {}, { nodes: 'no' }]) expect(normalizeWorkflowShape(value).changed).toBe(false);
  });
});

describe('normalizeWorkflowJson', () => {
  it('rewrites a stored React-Flow workflow, and returns other strings untouched', () => {
    const fixed = JSON.parse(normalizeWorkflowJson(JSON.stringify(DAILY_BRIEFING)));
    expect(fixed.nodes[0].x).toBe(80);
    const canonical = JSON.stringify({ nodes: [canonicalNode()], edges: [] });
    expect(normalizeWorkflowJson(canonical)).toBe(canonical);
    expect(normalizeWorkflowJson('not json')).toBe('not json');
  });
});
