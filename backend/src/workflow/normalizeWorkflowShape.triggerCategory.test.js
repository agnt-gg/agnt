import { it, expect } from 'vitest';
import { normalizeWorkflowShape } from './normalizeWorkflowShape.js';
import { workflowTriggerProblems } from './validateTriggers.js';

// bravo retest, Nov 2026: a hand-written trigger without "category" saved and started, then never fired
// (the engine arms only category 'trigger'), and generic-trigger ran as "Tool not found: generic-trigger".
it('infers category "trigger" for every trigger type, and leaves other nodes alone', () => {
  const { workflow, changed } = normalizeWorkflowShape({ nodes: [
    { id: 'a', type: 'trigger-timer', text: 'A', x: 0, y: 0, parameters: {} },
    { id: 'b', type: 'generic-trigger', text: 'B', x: 0, y: 0, parameters: {} },
    { id: 'c', type: 'webhook-listener', text: 'C', x: 0, y: 0, parameters: {} },
    { id: 'd', type: 'receive-email', text: 'D', x: 0, y: 0, parameters: {} },
    { id: 'e', type: 'execute-javascript', text: 'E', x: 0, y: 0, parameters: {} },
    { id: 'f', type: 'trigger-timer', category: 'custom', text: 'F', x: 0, y: 0, parameters: {} },
  ], edges: [] });
  expect(changed).toBe(true);
  expect(workflow.nodes.map((node) => node.category)).toEqual(['trigger', 'trigger', 'trigger', 'trigger', undefined, 'custom']);
});

it("the retest's exact timer is now caught by the start check, naming the field", async () => {
  const { workflow } = normalizeWorkflowShape({ nodes: [{ id: 't', type: 'trigger-timer', text: 'Start', parameters: { fireOnStart: 'Yes', scheduleType: 'Interval', schedule: 'Hour', interval: 24 } }], edges: [] });
  const [problem] = await workflowTriggerProblems(workflow);
  expect(problem).toMatch(/"schedule" is "Hour", but must be one of/);
});
