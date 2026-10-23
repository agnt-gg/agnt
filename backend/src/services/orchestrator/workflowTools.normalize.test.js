// A new workflow built in chat failed "All nodes must have an id" and was
// never shown (2026-10-23). update_workflow now fills in what is mechanical.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: { WORKFLOW_UPDATED: 'workflow:updated' } }));
const { normalizeWorkflowDraft, TOOLS } = await import('./workflowTools.js');
const { broadcastToUser } = await import('../../utils/realtimeSync.js');

const draft = {
  name: 'Morning AI news',
  nodes: [
    { type: 'trigger-timer', text: 'Every morning', parameters: { schedule: '0 8 * * *' } },
    { type: 'web-search', label: 'Search AI news' },
    { type: 'send-email', name: 'Email summary' },
  ],
  edges: [
    { source: 'Every morning', target: 'Search AI news' },
    { start: { id: '1' }, end: '2' },
  ],
};

describe('normalizeWorkflowDraft', () => {
  it('gives steps ids, labels and positions, and wires edges written by name or index', () => {
    const wf = normalizeWorkflowDraft(draft);
    const [a, b, c] = wf.nodes;
    expect(wf.nodes.every((n) => /^node_/.test(n.id) && Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect([a.text, b.text, c.text]).toEqual(['Every morning', 'Search AI news', 'Email summary']);
    expect(wf.edges.map((e) => [e.start.id, e.start.type, e.end.id, e.end.type, !!e.id])).toEqual([[a.id, 'output', b.id, 'input', true], [b.id, 'output', c.id, 'input', true]]);
  });
  it('keeps given ids and leaves an unresolvable end for validation to refuse', async () => {
    const bad = { nodes: [{ id: 'n1', type: 't', text: 'A', x: 0, y: 0 }], edges: [{ start: 'n1', end: 'nowhere' }] };
    const wf = normalizeWorkflowDraft(bad);
    expect(wf.nodes[0].id).toBe('n1');
    expect(wf.edges[0].end).toBe('nowhere'); // untouched
    const result = JSON.parse(await TOOLS.update_workflow.execute({ workflow: bad }, '', { workflowId: 'w', workflowState: { id: 'w', nodes: [], edges: [] } }));
    expect(result.success).toBe(false);
  });
});

describe('steps sent as JSON strings (seen from a real model)', () => {
  it('parses each string step and edge, and the schema now asks for objects', () => {
    const wf = normalizeWorkflowDraft({ nodes: draft.nodes.map((n) => JSON.stringify(n)), edges: JSON.stringify(draft.edges) });
    expect(wf.nodes.map((n) => n.type)).toEqual(['trigger-timer', 'web-search', 'send-email']);
    expect(wf.edges).toHaveLength(2);
    const props = TOOLS.update_workflow.schema.function.parameters.properties.workflow.properties;
    expect([props.nodes.items, props.edges.items]).toEqual([{ type: 'object' }, { type: 'object' }]);
  });
});

describe('update_workflow with a model-shaped draft', () => {
  it('succeeds and sends the graph to the open editor', async () => {
    const token = 'Bearer x.' + Buffer.from(JSON.stringify({ id: 'u1' })).toString('base64') + '.y';
    const result = JSON.parse(await TOOLS.update_workflow.execute({ workflow: draft }, token, { workflowId: 'default', workflowState: { id: 'default', nodes: [], edges: [] } }));
    expect(result).toMatchObject({ success: true, nodeCount: 3, edgeCount: 2 });
    const [, , payload] = broadcastToUser.mock.calls.at(-1);
    expect(payload.id).toBe('default');
    expect(payload.workflowState.nodes.map((n) => n.text)).toEqual(['Every morning', 'Search AI news', 'Email summary']);
  });
});
