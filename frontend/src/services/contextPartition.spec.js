import { describe, expect, it } from 'vitest';
import { partitionContext } from './contextPartition.js';

const breakdown = { systemTokens: 10_000, toolTokens: 4_000, messagesTokens: 20_000 };

describe('partitionContext', () => {
  it('carves skills out of System and Messages and the four buckets still add up', () => {
    const p = partitionContext(breakdown, { skills: { resident: 3_000, loadedTokens: 5_000 } });
    expect(p).toMatchObject({ system: 7_000, tools: 4_000, skills: 8_000, messages: 15_000 });
    expect(p.system + p.tools + p.skills + p.messages).toBe(34_000);
  });

  it('an older backend with no skills group shows the three buckets unchanged', () => {
    expect(partitionContext(breakdown, {})).toMatchObject({ system: 10_000, skills: 0, messages: 20_000 });
    expect(partitionContext(breakdown, null)).toMatchObject({ system: 10_000, skills: 0, messages: 20_000 });
  });

  it('never produces a negative bucket when the two events disagree', () => {
    const p = partitionContext({ systemTokens: 100, toolTokens: 0, messagesTokens: 50 }, { skills: { resident: 900, loadedTokens: 900 } });
    expect(p).toMatchObject({ system: 0, skills: 150, messages: 0 });
  });

  it('falls back to manifest totals before the first status event', () => {
    const manifest = { system: { total: 500 }, tools: { total: 200 }, messages: { total: 300 }, skills: { resident: 100, loadedTokens: 0 } };
    expect(partitionContext(null, manifest)).toMatchObject({ system: 400, tools: 200, skills: 100, messages: 300 });
  });
});
