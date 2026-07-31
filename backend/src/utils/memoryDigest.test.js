import { describe, it, expect } from 'vitest';
import { buildMemoryDigest, MEMORY_SECTION_BUDGET_TOKENS } from './memoryDigest.js';
import { estimateTokens } from './contextManager.js';

const mem = (content, extra = {}) => ({ memory_type: 'context', content, ...extra });
const long = (n) => 'Root-caused the defect by measuring the real path end to end. '.repeat(n);

describe('buildMemoryDigest', () => {
  it('emits everything in full when the whole set fits', () => {
    const rows = [mem('short one'), mem('short two')];
    const d = buildMemoryDigest(rows, { estimate: estimateTokens });
    expect(d.fullCount).toBe(2);
    expect(d.gistCount).toBe(0);
    expect(d.text).toContain('short one');
    expect(d.text).toContain('short two');
    // No gists => no "some of these are gists" warning to pay for.
    expect(d.text).toContain('Relevant learnings from previous activity:');
  });

  it('keeps the section under budget when the set is enormous', () => {
    const rows = Array.from({ length: 15 }, (_, i) => mem(`memory ${i} ` + long(120)));
    const raw = rows.map((m) => `- [context] ${m.content}`).join('\n');
    // Premise: without a budget this set really is multiples of it.
    expect(estimateTokens(raw)).toBeGreaterThan(MEMORY_SECTION_BUDGET_TOKENS * 3);

    const d = buildMemoryDigest(rows, { estimate: estimateTokens });
    // Overshoot allowance covers the gist tail + header, not another entry.
    expect(estimateTokens(d.text)).toBeLessThan(MEMORY_SECTION_BUDGET_TOKENS * 1.35);
    expect(d.gistCount).toBeGreaterThan(0);
  });

  it('NEVER drops a memory — every entry is represented', () => {
    const rows = Array.from({ length: 15 }, (_, i) => mem(`UNIQUEMARKER${i} ` + long(60)));
    const d = buildMemoryDigest(rows, { estimate: estimateTokens });
    expect(d.totalCount).toBe(15);
    for (let i = 0; i < 15; i++) expect(d.text).toContain(`UNIQUEMARKER${i}`);
  });

  it('respects the caller ranking: the first entries are the ones kept in full', () => {
    const first = 'FIRST ' + long(6);
    const tiny = 'tiny third';
    // Budget deliberately leaves room for `tiny` AFTER `first`. A "pack
    // whatever still fits" policy would skip the oversized SECOND and promote
    // the tiny third entry into the full set, silently reordering relevance by
    // length. Without that leftover room both policies produce identical
    // output and this test cannot tell them apart — which is exactly how the
    // first version of it passed against the broken implementation.
    const budgetTokens = estimateTokens(`- [context] ${first}`)
      + estimateTokens(`- [context] ${tiny}`) + 4;
    const rows = [mem(first), mem('SECOND ' + long(40)), mem(tiny)];

    const d = buildMemoryDigest(rows, { estimate: estimateTokens, budgetTokens });
    expect(d.fullCount).toBe(1); // 2 would mean `tiny` jumped the queue
    expect(d.gistCount).toBe(2);
    expect(d.text).toContain('FIRST');
    expect(d.text.split('\n').at(-1)).toContain(tiny);
  });

  // Discovered while fixing the fixture above: when even the top-ranked entry
  // exceeds the budget, nothing is kept in full. That is the correct outcome
  // (a budget that cannot fit one entry must still produce a bounded section)
  // and it must not throw or return empty.
  it('gists everything when even the first entry exceeds the budget', () => {
    const rows = [mem('ALPHA ' + long(40)), mem('BETA ' + long(40))];
    const d = buildMemoryDigest(rows, { estimate: estimateTokens, budgetTokens: 10 });
    expect(d.fullCount).toBe(0);
    expect(d.gistCount).toBe(2);
    expect(d.text).toContain('ALPHA');
    expect(d.text).toContain('BETA');
  });

  it('tells the model the gists are partial and how to read the full text', () => {
    const rows = Array.from({ length: 15 }, () => mem(long(60)));
    const d = buildMemoryDigest(rows, { estimate: estimateTokens });
    expect(d.text).toContain('get_agent_memories');
    expect(d.text).toMatch(/gist/i);
  });

  it('preserves the memory type label and the agent attribution suffix', () => {
    const rows = [mem('a fact', { memory_type: 'preference', agent_id: 'agent-7' })];
    const d = buildMemoryDigest(rows, { estimate: estimateTokens });
    expect(d.text).toContain('- [preference] a fact (from agent)');
  });

  it('does not attribute orchestrator memories to an agent', () => {
    const rows = [mem('a fact', { agent_id: 'orchestrator' })];
    expect(buildMemoryDigest(rows, { estimate: estimateTokens }).text).not.toContain('(from agent)');
  });

  it('returns empty for no memories and for blank content', () => {
    expect(buildMemoryDigest([], { estimate: estimateTokens }).text).toBe('');
    expect(buildMemoryDigest(null, { estimate: estimateTokens }).text).toBe('');
    expect(buildMemoryDigest([mem('   ')], { estimate: estimateTokens }).text).toBe('');
  });

  it('gists are materially shorter than the source they stand in for', () => {
    const source = long(60);
    const rows = [mem('filler ' + long(60)), mem(source)];
    const d = buildMemoryDigest(rows, { estimate: estimateTokens, budgetTokens: 300 });
    const lastLine = d.text.split('\n').at(-1);
    expect(source.length).toBeGreaterThan(2000); // premise
    expect(lastLine.length).toBeLessThan(source.length / 4);
  });
});
