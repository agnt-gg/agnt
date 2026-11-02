import { it, expect } from 'vitest';
import { triggerProblems, workflowTriggerProblems } from './validateTriggers.js';

// bravo, Nov 2026: a hand-written timer trigger armed "successfully" and never fired, with no error.
const timer = (parameters) => ({ nodes: [{ id: 't', text: 'Start', type: 'trigger-timer', category: 'trigger', parameters }] });

it('accepts a timer set up the way the editor sets it up', async () => {
  expect(await workflowTriggerProblems(timer({ scheduleType: 'Interval', schedule: 'Daily', fireOnStart: 'Yes' }))).toEqual([]);
  expect(await workflowTriggerProblems(timer({}))).toEqual([]); // defaults fill in
});

it('names the field and the allowed values for a value the schema does not allow', async () => {
  const [problem] = await workflowTriggerProblems(timer({ scheduleType: 'Interval', schedule: 'Every 2 Hours' }));
  expect(problem).toMatch(/"schedule" is "Every 2 Hours", but must be one of .*"Daily"/);
  expect((await workflowTriggerProblems(timer({ scheduleType: 'Intervall' })))[0]).toMatch(/"scheduleType"/);
});

it('checks only parameters that apply, every value of a multi-select, and required ones', () => {
  const schema = { parameters: {
    mode: { options: ['A', 'B'] },
    onlyForB: { options: ['x'], conditional: { field: 'mode', value: 'B' } },
    days: { options: ['Mon', 'Tue'] },
    url: { required: true },
  } };
  expect(triggerProblems({ id: 'n', parameters: { mode: 'A', onlyForB: 'nope', days: ['Mon'], url: 'u' } }, schema)).toEqual([]);
  const problems = triggerProblems({ id: 'n', parameters: { mode: 'B', onlyForB: 'nope', days: ['Mon', 'Sun'] } }, schema);
  expect(problems.join('\n')).toMatch(/onlyForB/);
  expect(problems.join('\n')).toMatch(/days/);
  expect(problems.join('\n')).toMatch(/"url" is required/);
});

it('does not check a trigger with no schema (plugin triggers report their own errors)', async () => {
  expect(await workflowTriggerProblems({ nodes: [{ id: 'p', type: 'some-plugin-trigger', category: 'trigger', parameters: { x: 1 } }] })).toEqual([]);
});
