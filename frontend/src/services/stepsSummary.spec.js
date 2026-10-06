import { describe, it, expect } from 'vitest';
import { summarizeSteps, humanizeToolName } from './stepsSummary.js';

const s = (status, name = 'web_search') => ({ status, name });

describe('summarizeSteps', () => {
  it('all completed is Done, pluralised correctly', () => {
    expect(summarizeSteps([s('completed')])).toEqual({ state: 'done', text: 'Done · 1 step' });
    expect(summarizeSteps([s('completed'), s('completed')])).toEqual({ state: 'done', text: 'Done · 2 steps' });
  });

  it('a running step wins over everything, and names what it is doing', () => {
    expect(summarizeSteps([s('completed'), s('error'), s('running', 'execute_shell_command')])).toEqual({
      state: 'running',
      text: 'Working · Execute shell command',
    });
  });

  it('pending counts as working (the args are still streaming)', () => {
    expect(summarizeSteps([s('completed'), s('pending', 'read_file')]).state).toBe('running');
  });

  // An errored step is routine, not a verdict on the group: no failure state
  // (that drew a red X on the whole group), just a neutral count.
  it('a finished group with errored steps is still done, with the errors counted', () => {
    expect(summarizeSteps([s('completed'), s('error'), s('error')])).toEqual({ state: 'done', text: 'Done · 3 steps · 2 errors' });
    expect(summarizeSteps([s('completed'), s('error')]).text).toBe('Done · 2 steps · 1 error');
    expect(summarizeSteps([s('error')]).state).toBe('done');
  });

  it('there is no error state at all', () => {
    for (const mix of [[s('error')], [s('error'), s('completed')], [s('error'), s('interrupted')]]) {
      expect(summarizeSteps(mix).state).not.toBe('error');
    }
  });

  it('an interrupted run is Stopped, not Done, even with an errored step', () => {
    expect(summarizeSteps([s('completed'), s('interrupted')])).toEqual({ state: 'stopped', text: 'Stopped · 2 steps' });
    expect(summarizeSteps([s('error'), s('interrupted')]).state).toBe('stopped');
  });

  it('survives junk', () => {
    expect(summarizeSteps(null)).toEqual({ state: 'done', text: 'No steps' });
    expect(summarizeSteps([null, s('completed')]).text).toBe('Done · 1 step');
  });
});

describe('humanizeToolName', () => {
  it.each([
    ['web_search', 'Web search'],
    ['webSearch', 'Web search'],
    ['agnt.web-search', 'Web search'],
    ['mcp:figma/get_file', 'Get file'],
    ['', 'Step'],
    [undefined, 'Step'],
  ])('%j -> %j', (raw, out) => expect(humanizeToolName(raw)).toBe(out));
});
