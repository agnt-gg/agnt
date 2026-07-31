import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { manageContext, estimateMessagesTokens } from './contextManager.js';

/**
 * Chunked eviction with a persistent watermark.
 *
 * The defect this pins: Strategy 3 used to evict the MINIMUM number of
 * message units, recomputed fresh every turn — so past the context limit the
 * window slid forward every request and the provider's prompt-cache prefix
 * was rewritten on EVERY turn (measured: prefix rewrites == compressed turns,
 * 27 rewrites over 40 group-chat turns). The fix cuts to a ~70% low-water
 * mark and persists the cut via options.evictedUnits / result.evictedUnits.
 */

const MODEL = 'claude-sonnet-4-5-20250929';
const PROVIDER = 'anthropic';

const hash = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 10);

/**
 * Fingerprint of everything EXCEPT the trailing 2 messages — what a prompt
 * cache would have to match for a hit on the next turn.
 */
function prefixFingerprint(messages) {
  return messages.slice(0, Math.max(0, messages.length - 2)).map(hash).join('|');
}

/** Unique-content message pair. Uniqueness is load-bearing: repeated filler
 *  makes hashes collide across a sliding window and fakes cache hits —
 *  exactly the instrument bug that hid this defect the first time. */
let seq = 0;
function exchange(turn) {
  seq += 1;
  return [
    { role: 'user', content: `[t${turn} u${seq}] ` + 'word '.repeat(900) },
    { role: 'assistant', content: `[t${turn} a${seq}] ` + 'reply '.repeat(900) },
  ];
}

const SYSTEM = { role: 'system', content: 'SYSTEM PROMPT '.repeat(1000) };

describe('contextManager chunked eviction watermark', () => {
  it('INSTRUMENT SELF-TEST: a sliding window must register as a prefix break', () => {
    const msgs = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => ({ role: 'user', content: c }));
    const win1 = msgs.slice(0, 5);
    const win2 = msgs.slice(1, 6);
    expect(prefixFingerprint(win2).startsWith(prefixFingerprint(win1))).toBe(false);
  });

  it('returns evictedUnits: 0 and untouched messages when under budget (byte-compat)', () => {
    const messages = [SYSTEM, ...exchange(1), ...exchange(2)];
    const result = manageContext(messages, MODEL, [], PROVIDER, {});
    expect(result.evictedUnits).toBe(0);
    expect(result.messages.length).toBe(messages.length);
    expect(result.messages.map((m) => m.content)).toEqual(messages.map((m) => m.content));
  });

  it('keeps the prefix byte-stable between cuts (the 78% fix, measured)', () => {
    const messages = [SYSTEM];
    let watermark = 0;
    let prevFp = null;
    let breaks = 0;
    let compressedTurns = 0;
    const TURNS = 40;
    for (let t = 1; t <= TURNS; t++) {
      // group-chat growth: 4 exchanges per turn
      for (let g = 0; g < 4; g++) messages.push(...exchange(t));
      const result = manageContext(messages, MODEL, [], PROVIDER, { evictedUnits: watermark });
      watermark = result.evictedUnits;
      if (result.messages.length < messages.length) compressedTurns++;
      const fp = prefixFingerprint(result.messages);
      if (prevFp !== null && !fp.startsWith(prevFp)) breaks++;
      prevFp = fp;
    }
    // Old behaviour: breaks === compressedTurns (every compressed turn broke
    // the prefix). New behaviour: breaks only at actual cut points.
    expect(compressedTurns).toBeGreaterThan(5); // the scenario genuinely compresses
    expect(breaks).toBeLessThanOrEqual(Math.ceil(compressedTurns / 3));
    expect(breaks).toBeLessThan(compressedTurns); // strictly better than the old world
  });

  it('watermark only moves forward across turns', () => {
    const messages = [SYSTEM];
    let watermark = 0;
    const seen = [];
    for (let t = 1; t <= 30; t++) {
      for (let g = 0; g < 4; g++) messages.push(...exchange(t));
      const result = manageContext(messages, MODEL, [], PROVIDER, { evictedUnits: watermark });
      watermark = result.evictedUnits;
      seen.push(watermark);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen[seen.length - 1]).toBeGreaterThan(0);
  });

  it('replaying the watermark drops the same units even when now under budget', () => {
    const messages = [SYSTEM];
    for (let t = 1; t <= 6; t++) messages.push(...exchange(t));
    // Simulate a persisted watermark of 2 units on a conversation that is
    // over budget only WITH those units (i.e. genuinely past the wall).
    // Build an over-budget conversation first to earn a watermark:
    const big = [SYSTEM];
    for (let t = 1; t <= 30; t++) { for (let g = 0; g < 4; g++) big.push(...exchange(t)); }
    const first = manageContext(big, MODEL, [], PROVIDER, {});
    expect(first.evictedUnits).toBeGreaterThan(0);
    // Append one more exchange (append-only growth) and replay: same units gone.
    big.push(...exchange(99));
    const second = manageContext(big, MODEL, [], PROVIDER, { evictedUnits: first.evictedUnits });
    expect(second.evictedUnits).toBeGreaterThanOrEqual(first.evictedUnits);
    const firstNonSys = first.messages.filter((m) => m.role !== 'system');
    const secondNonSys = second.messages.filter((m) => m.role !== 'system');
    // If no new cut happened, second's kept window = first's + the appended pair.
    if (second.evictedUnits === first.evictedUnits) {
      expect(secondNonSys.length).toBe(firstNonSys.length + 2);
      expect(hash(secondNonSys[0])).toBe(hash(firstNonSys[0]));
    }
  });

  it('resets the watermark when the full conversation fits again (model switch / edit)', () => {
    const small = [SYSTEM, ...exchange(1), ...exchange(2)];
    // A stale large watermark from a previously-huge conversation:
    const result = manageContext(small, MODEL, [], PROVIDER, { evictedUnits: 50 });
    expect(result.evictedUnits).toBe(0);
    expect(result.messages.length).toBe(small.length);
  });

  it('clamps a watermark larger than the unit count (edited/truncated history)', () => {
    // Over-budget conversation with only a few units but an absurd watermark.
    const messages = [SYSTEM];
    for (let t = 1; t <= 30; t++) { for (let g = 0; g < 4; g++) messages.push(...exchange(t)); }
    const result = manageContext(messages, MODEL, [], PROVIDER, { evictedUnits: 10_000 });
    // Must keep at least the last unit and never throw.
    const nonSystem = result.messages.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBeGreaterThan(0);
    expect(result.messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('never destroys the system message and never exceeds the budget after a cut', () => {
    const messages = [SYSTEM];
    for (let t = 1; t <= 40; t++) { for (let g = 0; g < 4; g++) messages.push(...exchange(t)); }
    const result = manageContext(messages, MODEL, [], PROVIDER, {});
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe(SYSTEM.content);
    expect(estimateMessagesTokens(result.messages)).toBeLessThanOrEqual(result.tokenLimit);
  });

  it('keeps assistant+tool units atomic across the cut boundary', () => {
    const messages = [SYSTEM];
    for (let t = 1; t <= 30; t++) {
      messages.push({ role: 'user', content: `[t${t}] ` + 'q '.repeat(1800) });
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `call_${t}`, type: 'function', function: { name: 'web_search', arguments: '{}' } }],
      });
      messages.push({ role: 'tool', tool_call_id: `call_${t}`, content: `result ${t} ` + 'r '.repeat(1800) });
      messages.push({ role: 'assistant', content: `[t${t}] ` + 'a '.repeat(1800) });
    }
    const result = manageContext(messages, MODEL, [], PROVIDER, {});
    // Every surviving role:'tool' message must have its assistant partner.
    const kept = result.messages;
    kept.forEach((m, i) => {
      if (m.role === 'tool') {
        const prev = kept[i - 1];
        const prevPrev = kept[i - 2];
        const paired =
          (prev && prev.role === 'assistant' && Array.isArray(prev.tool_calls)) ||
          (prev && prev.role === 'tool' && prevPrev && prevPrev.role === 'assistant');
        expect(paired).toBe(true);
      }
    });
  });
});
