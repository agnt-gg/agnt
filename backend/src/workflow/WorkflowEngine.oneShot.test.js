import { it, expect, vi, beforeEach } from 'vitest';

// "Run now": a workflow whose trigger is a timer/webhook runs once from its trigger node, without an event
// that matches and without changing whether the workflow is switched on.
const state = vi.hoisted(() => ({ statusWrites: [], ran: [] }));
vi.mock('../models/database/index.js', () => ({ default: { run: vi.fn() }, dbRunWithRetry: (fn) => fn() }));
vi.mock('../models/WorkflowModel.js', () => ({ default: { updateStatus: async (id, status) => { state.statusWrites.push(status); } } }));
vi.mock('../models/ExecutionModel.js', () => ({ default: { create: async () => 'exec-1', update: async () => 1, getTotalCreditsUsed: async () => 0, createNodeExecution: vi.fn(), updateNodeExecution: vi.fn() } }));
vi.mock('./NodeExecutor.js', () => ({ default: class { constructor() {} async executeNode(node) { state.ran.push(node.id); return { ok: node.id }; } } }));
const { default: WorkflowEngine } = await import('./WorkflowEngine.js');
beforeEach(() => { state.statusWrites.length = 0; state.ran.length = 0; });

const workflow = { name: 'w', nodes: [
  { id: 't', type: 'trigger-timer', category: 'trigger', text: 'Start', parameters: { scheduleType: 'Interval', schedule: 'Daily' } },
  { id: 'a', type: 'counter', category: 'utility', text: 'Step', parameters: {} },
], edges: [{ id: 'e', start: { id: 't' }, end: { id: 'a' } }] };

it('runs from the trigger node through the workflow, and leaves the switched-on state alone', async () => {
  const engine = new WorkflowEngine(workflow, 'wf-1', 'user-1');
  engine.oneShot = true;
  const result = await engine.processWorkflowTrigger({ manual: true }, { waitForCompletion: true });
  expect(result.success).toBe(true);
  expect(state.ran).toEqual(['t', 'a']);
  expect(state.statusWrites).toEqual([]);
  expect(engine.currentExecutionId).toBe('exec-1');
});
