import { describe, expect, it, vi } from 'vitest';

/**
 * The engine must refuse a workflow it cannot read, and say which node is wrong.
 *
 * Save-time validation only protects rows written from now on. Rows that
 * predate it are already in every database, and `/workflows/import` plus direct
 * DB writes never passed through it — on one developer machine 22 of 22 stored
 * workflows were unexecutable. So the engine is the backstop, and it has to
 * fail with a diagnosis rather than:
 *
 *     TypeError: Cannot read properties of undefined (reading 'toLowerCase')
 *         at WorkflowEngine._initializeNodeNameMapping (WorkflowEngine.js:518)
 *
 * validateWorkflowShape.js is deliberately NOT mocked — the point is that the
 * engine really calls it.
 */

vi.mock('../models/WorkflowModel.js', () => ({ default: { updateStatus: vi.fn() } }));
vi.mock('../models/database/index.js', () => ({
  default: { run: vi.fn() },
  dbRunWithRetry: vi.fn(async (fn) => fn()),
}));
vi.mock('../models/ExecutionModel.js', () => ({ default: {} }));
vi.mock('../tools/ToolConfig.js', () => ({ default: { triggers: {}, actions: {} } }));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('../tools/library/utilities/counter.js', () => ({ default: {} }));
vi.mock('../tools/library/controls/run-workflow.js', () => ({ default: vi.fn() }));
vi.mock('./NodeExecutor.js', () => ({ default: class NodeExecutor {} }));
vi.mock('./EdgeEvaluator.js', () => ({ default: class EdgeEvaluator {} }));
vi.mock('./ParameterResolver.js', () => ({ default: class ParameterResolver {} }));

const { default: WorkflowEngine } = await import('./WorkflowEngine.js');

const validWorkflow = () => ({
  id: 'wf-1',
  nodes: [
    { id: 'n1', text: 'Timer Trigger', type: 'trigger-timer', category: 'trigger', parameters: {} },
    { id: 'n2', text: 'Run JS', type: 'execute-javascript', category: 'action', parameters: {} },
  ],
  edges: [{ id: 'e1', start: { id: 'n1', type: 'output' }, end: { id: 'n2', type: 'input' } }],
});

describe('WorkflowEngine constructor — shape guard', () => {
  it('constructs normally for a workflow the designer produced', () => {
    const engine = new WorkflowEngine(validWorkflow(), 'wf-1', 'user-1');

    expect(engine.workflow.nodes).toHaveLength(2);
    // The name→id map is what used to crash; prove it was built.
    expect(engine.nodeNameToId.get('timertrigger')).toBe('n1');
    expect(engine.nodeNameToId.get('runjs')).toBe('n2');
  });

  it('throws a diagnosis, not a TypeError, when a node has no text', () => {
    const wf = validWorkflow();
    delete wf.nodes[0].text;

    let thrown;
    try {
      new WorkflowEngine(wf, 'wf-42', 'user-1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    // The regression: a bare TypeError naming neither node nor field.
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown.message).not.toMatch(/toLowerCase/);
    expect(thrown.message).toContain('Workflow wf-42');
    expect(thrown.message).toContain('node "n1"');
    expect(thrown.message).toContain('"text"');
  });

  it('rejects the react-flow shape stored by earlier API callers', () => {
    const stored = {
      nodes: [{ id: 'trigger-1', type: 'trigger-timer', data: { label: 'Timer', properties: {} } }],
      edges: [{ id: 'e1', source: 'trigger-1', target: 'status-1' }],
    };

    expect(() => new WorkflowEngine(stored, 'wf-legacy', 'user-1')).toThrow(/"text"/);
  });

  it('rejects an edge whose endpoint names a node that is not there', () => {
    const wf = validWorkflow();
    wf.edges[0].end = { id: 'ghost', type: 'input' };

    expect(() => new WorkflowEngine(wf, 'wf-1', 'user-1')).toThrow(/unknown node id "ghost"/);
  });

  it('normalises a blank draft instead of crashing on missing collections', () => {
    // `nodes` is iterated at :516 and `edges` at :527, both unconditionally.
    const engine = new WorkflowEngine({ id: 'wf-blank', name: 'draft' }, 'wf-blank', 'user-1');

    expect(engine.workflow.nodes).toEqual([]);
    expect(engine.workflow.edges).toEqual([]);
    expect(engine.nodeNameToId.size).toBe(0);
  });

  it('preserves every other workflow field when normalising', () => {
    const engine = new WorkflowEngine(
      { id: 'wf-1', name: 'keep me', description: 'and me', ...validWorkflow() },
      'wf-1',
      'user-1'
    );

    expect(engine.workflow.name).toBe('keep me');
    expect(engine.workflow.description).toBe('and me');
  });

  it('does not mutate the caller\'s workflow object', () => {
    const stored = { id: 'wf-blank' };
    new WorkflowEngine(stored, 'wf-blank', 'user-1');

    // The worker parses this straight out of the DB row; leave it alone.
    expect(stored.nodes).toBeUndefined();
    expect(stored.edges).toBeUndefined();
  });
});
