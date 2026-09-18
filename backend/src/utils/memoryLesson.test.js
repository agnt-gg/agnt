import { describe, it, expect } from 'vitest';
import { canonicalLesson, lessonIdentity, prepareMemoryWrite, LESSON_LIMITS } from './memoryLesson.js';
const lesson = { when: 'Packaging native architecture', action: 'Inspect the binary headers', boundary: 'Not a launch test', evidence: 'Host architecture differed from target' };
const context = { userId: 'u1', agentId: 'orchestrator', executionId: 'run1', conversationId: 'c1', userText: 'I prefer dark mode.' };
describe('durable lesson gate', () => {
  it('normalizes whitespace without losing negation or identifiers', () => {
    expect(canonicalLesson({ ...lesson, action: ' Do  not\nuse gcc-12 ' }).action).toBe('Do not use gcc-12');
  });
  for (const value of [null, [], 'text', {}, { ...lesson, when: '' }, { ...lesson, extra: 'no' }, { ...lesson, action: 4 }]) {
    it(`rejects malformed lesson ${JSON.stringify(value)}`, () => expect(() => canonicalLesson(value)).toThrow());
  }
  for (const [field, limit] of Object.entries(LESSON_LIMITS)) {
    it(`enforces ${field} bound`, () => {
      expect(canonicalLesson({ ...lesson, [field]: 'a'.repeat(limit) })[field]).toHaveLength(limit);
      expect(() => canonicalLesson({ ...lesson, [field]: 'a'.repeat(limit + 1) })).toThrow();
    });
  }
  it('scopes exact identity and preserves opposing instructions', () => {
    const id = lessonIdentity(lesson, 'u1', 'a1');
    expect(lessonIdentity({ ...lesson }, 'u1', 'a1')).toBe(id);
    expect(lessonIdentity(lesson, 'u2', 'a1')).not.toBe(id);
    expect(lessonIdentity(lesson, 'u1', 'a2')).not.toBe(id);
    expect(lessonIdentity({ ...lesson, action: 'Do not inspect the binary headers' }, 'u1', 'a1')).not.toBe(id);
  });
  it('formats attributable readable lessons as pattern, not asserted facts', () => {
    const result = prepareMemoryWrite({ lesson, memory_type: 'fact' }, context);
    expect(result.memoryType).toBe('pattern');
    expect(result.content).toContain('Source execution: run1');
    expect(result.content).toContain('Boundary: Not a launch test');
  });
  it('requires user and source execution for lessons', () => {
    expect(() => prepareMemoryWrite({ lesson }, { ...context, executionId: null })).toThrow();
    expect(() => prepareMemoryWrite({ lesson }, { ...context, userId: null })).toThrow();
  });
  it('retains explicit user preferences with the supporting quote', () => {
    const result = prepareMemoryWrite({ memory_type: 'preference', content: 'User prefers dark mode', user_statement: 'I prefer dark mode.' }, context);
    expect(result.content).toContain('User statement: I prefer dark mode.');
  });
  for (const memory_type of ['context', 'pattern', 'tool_insight', 'workflow_insight', 'prompt_guidance']) {
    it(`rejects ungated ${memory_type}`, () => expect(() => prepareMemoryWrite({ memory_type, content: 'Something happened.' }, context)).toThrow());
  }
  it('rejects fabricated supporting quotes and oversize facts', () => {
    expect(() => prepareMemoryWrite({ memory_type: 'fact', content: 'A', user_statement: 'I like purple' }, context)).toThrow();
    expect(() => prepareMemoryWrite({ memory_type: 'fact', content: 'a'.repeat(1201), user_statement: 'I prefer dark mode.' }, context)).toThrow();
  });
});
