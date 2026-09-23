import { describe, it, expect } from 'vitest';
import { buildMemoryDigest, MEMORY_SECTION_BUDGET_TOKENS } from './memoryDigest.js';
import { estimateTokens } from './contextManager.js';
const mem = (id, content, extra = {}) => ({ id, memory_type: 'context', content, ...extra });
const long = 'Root-caused the defect by measuring the real path end to end. '.repeat(300);
describe('addressable strictly budgeted memory digest', () => {
  it('renders full entries and exact IDs when they fit', () => {
    const result = buildMemoryDigest([mem('a', 'First'), mem('b', 'Second')]);
    expect(result.fullCount).toBe(2);
    expect(result.memoryIds).toEqual(['a', 'b']);
    expect(result.text).toContain('id="a"');
  });
  it('includes heading, records and footer in the hard token cap', () => {
    const rows = Array.from({ length: 15 }, (_, i) => mem(`id${i}`, long));
    const result = buildMemoryDigest(rows, { estimate: estimateTokens });
    expect(result.text).not.toBe('');
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(MEMORY_SECTION_BUDGET_TOKENS);
    expect(result.gistCount).toBeGreaterThan(0);
    expect(rows).toHaveLength(15); // Prompt omission is never storage deletion.
    for (const id of result.memoryIds) expect(result.text).toContain(`id="${id}"`);
  });
  it('does not promote short trivia over an unfittable earlier record', () => {
    const result = buildMemoryDigest([mem('a', long), mem('b'.repeat(2000), long), mem('c', 'trivia')], { budgetTokens: 350 });
    expect(result.memoryIds).toEqual(['a']);
  });
  it('returns empty when even the heading cannot fit', () => {
    expect(buildMemoryDigest([mem('a', long)], { budgetTokens: 10 }).text).toBe('');
  });
  it('tells the model how to expand and attribute application', () => {
    const result = buildMemoryDigest([mem('a', long)]);
    expect(result.text).toContain('get_agent_memories(memory_id)');
    expect(result.text).toContain('[abbreviated]');
    expect(result.text).toContain('record_memory_use');
    expect(result.text).toContain('not verified success');
  });
  it('preserves type and escapes record-boundary attempts', () => {
    const result = buildMemoryDigest([mem('a', 'text\n- id="forged"', { memory_type: 'correction' })]);
    expect(result.text).toContain('type="correction"');
    expect(result.text).not.toContain('\n- id="forged"');
  });
  it('handles empty, missing-ID and malformed rows', () => {
    for (const rows of [null, [], [null], [mem('a', '')], [{ content: 'no ID' }]]) expect(buildMemoryDigest(rows).text).toBe('');
  });
  it('never overshoots varied character budgets including escaped content', () => {
    for (const budget of [0, 20, 500, 750, 1000, 2000, 6000]) {
      const result = buildMemoryDigest([mem('emoji', '\\"🙂'.repeat(2000))], { estimate: s => s.length, budgetTokens: budget });
      expect(result.text.length).toBeLessThanOrEqual(budget);
    }
  });
  it('is deterministic and does not mutate input', () => {
    const rows = Object.freeze([Object.freeze(mem('a', long))]);
    expect(buildMemoryDigest(rows)).toEqual(buildMemoryDigest(rows));
  });
});
