import { describe, it, expect } from 'vitest';
import {
  memoryShape,
  isAutoExtractedMemoryType,
  AUTO_EXTRACTED_MEMORY_TYPES,
} from './memoryShape.js';

// Real rows from the live store, which had 97,502 memories and exactly TWO
// byte-identical duplicates — every "duplicate" differs by an id or a number.
const A = '[bottleneck] Duplicate timer trigger execution: The timer trigger appears to have executed twice within 43ms (node a3f1c8e2-4b5d-4e6f-8a9b-0c1d2e3f4a5b)';
const B = '[bottleneck] Duplicate timer trigger execution: The timer trigger appears to have executed twice within 1902ms (node 7d8e9f0a-1b2c-3d4e-5f6a-7b8c9d0e1f2a)';

describe('memoryShape', () => {
  it('collapses rows that differ only by ids and numbers', () => {
    expect(memoryShape(A)).toBe(memoryShape(B));
  });

  it('does NOT collapse genuinely different findings', () => {
    const other = '[bottleneck] Slow HTTP request: the fetch node took 4300ms against api.example.com';
    expect(memoryShape(A)).not.toBe(memoryShape(other));
  });

  it('normalises UUIDs before digits, so they do not shred into a weaker pattern', () => {
    const shaped = memoryShape('run 550e8400-e29b-41d4-a716-446655440000 finished');
    expect(shaped).toContain('#id');
    expect(shaped).not.toMatch(/#-#|#{4,}/);
  });

  it('normalises long hex blobs that are not UUID-shaped', () => {
    expect(memoryShape('sha 0123456789abcdef0123 ok')).toBe(memoryShape('sha fedcba98765432100fed ok'));
  });

  it('is whitespace- and case-insensitive', () => {
    expect(memoryShape('Hello   World')).toBe(memoryShape('hello world'));
    expect(memoryShape('  padded  ')).toBe(memoryShape('padded'));
  });

  it('is bounded, so a long memory cannot produce an unbounded key', () => {
    expect(memoryShape('x'.repeat(10_000)).length).toBeLessThanOrEqual(120);
  });

  it('distinguishes records that diverge only after the prefix... by design it does not', () => {
    // Documented limitation, asserted so it is a decision rather than a
    // surprise: two records identical for 120 normalised characters ARE
    // treated as the same shape. This is why only auto-extracted types are
    // deduped — see below.
    const long = 'a'.repeat(130);
    expect(memoryShape(long + 'TAIL-ONE')).toBe(memoryShape(long + 'TAIL-TWO'));
  });

  it('handles null/undefined without throwing', () => {
    expect(memoryShape(null)).toBe('');
    expect(memoryShape(undefined)).toBe('');
  });
});

describe('only auto-extracted types are eligible for dedupe', () => {
  it('classifies the insight-pipeline types as auto', () => {
    for (const t of ['pattern', 'tool_insight', 'workflow_insight']) {
      expect(isAutoExtractedMemoryType(t)).toBe(true);
    }
  });

  it('NEVER classifies user-set types as auto', () => {
    // Dedupe discards a row. That is fine for the 1,092nd copy of a generated
    // bottleneck report and never fine for something the user asked to be
    // remembered.
    for (const t of ['fact', 'preference', 'correction', 'context', 'prompt_guidance']) {
      expect(isAutoExtractedMemoryType(t), `${t} must never be deduped`).toBe(false);
    }
  });

  it('treats unknown/missing types as user-set (fail safe)', () => {
    expect(isAutoExtractedMemoryType(undefined)).toBe(false);
    expect(isAutoExtractedMemoryType('something_new')).toBe(false);
  });

  it('the auto set is exactly the three insight types', () => {
    expect([...AUTO_EXTRACTED_MEMORY_TYPES].sort()).toEqual(['pattern', 'tool_insight', 'workflow_insight']);
  });
});
