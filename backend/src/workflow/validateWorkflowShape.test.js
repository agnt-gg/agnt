import { describe, expect, it } from 'vitest';
import { validateWorkflowShape, assertWorkflowShape } from './validateWorkflowShape.js';

/**
 * The engine reads one workflow shape. Everything else that writes a workflow
 * invents its own, and nothing checked — so the mismatch surfaced at
 * activation as `TypeError: Cannot read properties of undefined (reading
 * 'toLowerCase')` and reached the caller as an unqualified 'error'.
 *
 * The fixtures under "shapes found in a real database" are not invented. They
 * are the exact key sets of the 22 workflows on one developer machine, none of
 * which the engine could execute. Each one must be rejected, and the rejection
 * must name the field that is wrong.
 */

/** A node in the shape WorkflowDesigner.vue actually produces. */
const validNode = (over = {}) => ({
  id: 'node-1',
  text: 'Timer Trigger',
  type: 'trigger-timer',
  category: 'trigger',
  x: 100,
  y: 100,
  icon: 'clock',
  description: 'Fires on start',
  parameters: {},
  error: null,
  isEditing: false,
  isSelected: false,
  ...over,
});

/** An edge in the shape WorkflowDesigner.vue actually produces. */
const validEdge = (over = {}) => ({
  id: 'edge-1',
  start: { id: 'node-1', type: 'output' },
  end: { id: 'node-2', type: 'input' },
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
  isActive: false,
  ...over,
});

const twoNodeWorkflow = () => ({
  name: 'ok',
  nodes: [validNode(), validNode({ id: 'node-2', text: 'Grok Bot Status', type: 'grok-bot-status' })],
  edges: [validEdge()],
});

describe('validateWorkflowShape — what the designer produces is accepted', () => {
  it('accepts a well-formed two-node workflow', () => {
    expect(validateWorkflowShape(twoNodeWorkflow())).toEqual({ valid: true, errors: [] });
  });

  it('accepts a blank draft with empty collections', () => {
    expect(validateWorkflowShape({ name: 'draft', nodes: [], edges: [] }).valid).toBe(true);
  });

  it('accepts a draft that omits nodes and edges entirely', () => {
    // WorkflowImportService already coerces both to [] the same way; a blank
    // draft must stay savable.
    expect(validateWorkflowShape({ name: 'draft' }).valid).toBe(true);
  });

  it('accepts nodes with no edges between them', () => {
    expect(validateWorkflowShape({ nodes: [validNode()], edges: [] }).valid).toBe(true);
  });

  it('ignores fields the engine never dereferences', () => {
    const wf = twoNodeWorkflow();
    delete wf.nodes[0].icon;
    delete wf.nodes[0].description;
    delete wf.nodes[0].category;
    delete wf.nodes[0].parameters;
    delete wf.edges[0].startX;
    // Only text/id/type and edge endpoints are read, so this still runs.
    expect(validateWorkflowShape(wf).valid).toBe(true);
  });
});

describe('validateWorkflowShape — the field that actually crashed', () => {
  it('rejects a node without text, and says why', () => {
    const wf = twoNodeWorkflow();
    delete wf.nodes[0].text;

    const { valid, errors } = validateWorkflowShape(wf);
    expect(valid).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('node "node-1"');
    expect(errors[0]).toContain('"text"');
    expect(errors[0]).toContain('missing');
  });

  it('rejects an empty-string text — .toLowerCase() would succeed but the name is unusable', () => {
    const wf = twoNodeWorkflow();
    wf.nodes[0].text = '   ';
    expect(validateWorkflowShape(wf).valid).toBe(false);
  });

  it('names the index when the node has no id to name it by', () => {
    const { errors } = validateWorkflowShape({ nodes: [{ type: 'x' }], edges: [] });
    expect(errors.some((e) => e.includes('index 0'))).toBe(true);
  });

  it('reports every problem at once rather than only the first', () => {
    const { errors } = validateWorkflowShape({ nodes: [{}], edges: [] });
    // missing id, missing text, missing type
    expect(errors).toHaveLength(3);
  });
});

describe('validateWorkflowShape — ids and edge endpoints', () => {
  it('rejects a missing node id', () => {
    const wf = twoNodeWorkflow();
    delete wf.nodes[0].id;
    expect(validateWorkflowShape(wf).errors.some((e) => e.includes('"id"'))).toBe(true);
  });

  it('rejects a missing node type', () => {
    const wf = twoNodeWorkflow();
    delete wf.nodes[1].type;
    expect(validateWorkflowShape(wf).errors.some((e) => e.includes('"type"'))).toBe(true);
  });

  it('rejects duplicate node ids — the second silently shadows the first in the id map', () => {
    const wf = twoNodeWorkflow();
    wf.nodes[1].id = 'node-1';
    wf.edges = [];

    const { valid, errors } = validateWorkflowShape(wf);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('Duplicate node id "node-1"'))).toBe(true);
  });

  it('rejects an edge with no start', () => {
    const wf = twoNodeWorkflow();
    delete wf.edges[0].start;
    expect(validateWorkflowShape(wf).errors.some((e) => e.includes('"start"'))).toBe(true);
  });

  it('rejects an edge endpoint without an id', () => {
    const wf = twoNodeWorkflow();
    wf.edges[0].end = { type: 'input' };
    expect(validateWorkflowShape(wf).errors.some((e) => e.includes('without an "id"'))).toBe(true);
  });

  it('rejects an edge pointing at a node that does not exist', () => {
    const wf = twoNodeWorkflow();
    wf.edges[0].end = { id: 'ghost-node', type: 'input' };

    const { valid, errors } = validateWorkflowShape(wf);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('unknown node id "ghost-node"'))).toBe(true);
  });

  it('names the edge by id when it has one', () => {
    const wf = twoNodeWorkflow();
    wf.edges[0].end = { id: 'ghost', type: 'input' };
    expect(validateWorkflowShape(wf).errors[0]).toContain('edge "edge-1"');
  });
});

describe('validateWorkflowShape — malformed containers', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'workflow'],
    ['a number', 7],
  ])('rejects a workflow that is %s', (_label, value) => {
    expect(validateWorkflowShape(value).valid).toBe(false);
  });

  it('rejects nodes that is an object rather than an array', () => {
    const { valid, errors } = validateWorkflowShape({ nodes: { a: 1 }, edges: [] });
    expect(valid).toBe(false);
    expect(errors[0]).toContain('"nodes" must be an array');
  });

  it('rejects edges that is a string', () => {
    const { errors } = validateWorkflowShape({ nodes: [], edges: 'none' });
    expect(errors[0]).toContain('"edges" must be an array');
  });

  it('rejects a null entry in the nodes array', () => {
    const { errors } = validateWorkflowShape({ nodes: [null], edges: [] });
    expect(errors[0]).toContain('must be an object');
  });

  it('does not also report per-node errors when nodes is not an array', () => {
    // Short-circuits: a container error makes element errors meaningless noise.
    expect(validateWorkflowShape({ nodes: 'x', edges: 'y' }).errors).toHaveLength(2);
  });
});

describe('shapes found in a real database — every one must be rejected', () => {
  /**
   * Key sets taken verbatim from the 22 workflows stored on one machine.
   * Zero were executable. Each entry is [label, nodes, edges].
   */
  const realShapes = [
    [
      'marketplace / plugin style: fields,id,nodeType,position,type',
      [
        {
          fields: { agentId: 'abc', botToken: '' },
          id: 'agent-chat',
          nodeType: 'agnt-agent',
          position: { x: 250, y: 100 },
          type: 'action',
        },
      ],
      [{ source: 'telegram-trigger', sourceHandle: 'text', target: 'agent-chat', targetHandle: 'message' }],
    ],
    [
      'script style: code,id,name,type',
      [{ code: 'return 1;', id: 'js-1', name: 'Run JS', type: 'execute-javascript' }],
      [],
    ],
    [
      'config style: config,id,name,type',
      [{ config: { url: 'https://example.com' }, id: 'http-1', name: 'Fetch', type: 'http-request' }],
      [],
    ],
    [
      'react-flow style: data,id,type',
      [{ data: { label: 'Timer', properties: {} }, id: 'trigger-1', type: 'trigger-timer' }],
      [{ id: 'e1', source: 'trigger-1', target: 'js-1', sourceHandle: 'output', targetHandle: 'input' }],
    ],
    [
      'react-flow style: data,id,position,type',
      [
        {
          data: { label: 'Timer', properties: { fireOnStart: 'Yes' } },
          id: 'trigger-1',
          position: { x: 100, y: 100 },
          type: 'trigger-timer',
        },
      ],
      [{ id: 'e1', source: 'trigger-1', target: 'status-1' }],
    ],
  ];

  it.each(realShapes)('rejects %s', (_label, nodes, edges) => {
    const { valid, errors } = validateWorkflowShape({ name: 'real', nodes, edges });
    expect(valid).toBe(false);
    // The whole point is a message that names the missing field, not just "invalid".
    expect(errors.some((e) => e.includes('"text"'))).toBe(true);
  });

  it('tells a react-flow caller that edges need start/end, not source/target', () => {
    const { errors } = validateWorkflowShape({
      nodes: [validNode()],
      edges: [{ id: 'e1', source: 'node-1', target: 'node-1' }],
    });
    expect(errors.some((e) => e.includes('{ start: { id, type } }'))).toBe(true);
    expect(errors.some((e) => e.includes('{ end: { id, type } }'))).toBe(true);
  });
});

describe('assertWorkflowShape', () => {
  it('does not throw on a valid workflow', () => {
    expect(() => assertWorkflowShape(twoNodeWorkflow())).not.toThrow();
  });

  it('throws an Error naming the context and every problem', () => {
    let thrown;
    try {
      assertWorkflowShape({ nodes: [{ id: 'n1' }], edges: [] }, 'Workflow wf-123');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    // Not a TypeError from dereferencing undefined — the old failure mode.
    expect(thrown.constructor.name).toBe('Error');
    expect(thrown.message).toContain('Workflow wf-123');
    expect(thrown.message).toContain('"text"');
    expect(thrown.message).toContain('"type"');
  });

  it('defaults the context so the message is still readable', () => {
    expect(() => assertWorkflowShape({ nodes: [{}], edges: [] })).toThrow(/^Workflow cannot be executed:/);
  });
});
