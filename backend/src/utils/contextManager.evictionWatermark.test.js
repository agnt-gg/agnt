import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { manageContext, estimateMessagesTokens, updateEstimateCalibration } from './contextManager.js';

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

/**
 * When the watermark is released, and when it holds.
 *
 * The budget is the window divided by a calibration the caller re-measures
 * from every reply, so it moves between requests. A watermark released just
 * because the full history fits this request's budget is cut again, at a
 * different unit, as soon as the budget tightens. These tests drive that loop
 * the way the caller does and pin the two conditions that do release it.
 */
describe('contextManager eviction watermark: release rule', () => {
  const WINDOW = { contextWindow: 200_000 };
  const manage = (messages, options) => manageContext(messages, MODEL, [], PROVIDER, { ...WINDOW, ...options });
  const budgetAt = (calibration) => manage([SYSTEM, ...exchange(0)], { calibration }).tokenLimit;
  const LOW_WATER = 0.7;
  const systemTokens = estimateMessagesTokens([SYSTEM]);
  /** What a cut leaves for history: the low-water mark less the system message. */
  const cutHistoryTokens = (budget) => Math.floor(budget * LOW_WATER) - systemTokens;

  /** Append-only history whose estimate is at least `share` of `budget`. */
  function historyOfShare(share, budget) {
    const messages = [SYSTEM];
    for (let t = 1; estimateMessagesTokens(messages) < budget * share; t++) messages.push(...exchange(t));
    return messages;
  }

  /** Grow a fresh history until the first cut at this calibration. */
  function growToFirstCut(calibration) {
    const messages = [SYSTEM];
    for (let t = 1; t < 500; t++) {
      messages.push(...exchange(t));
      const result = manage(messages, { calibration });
      if (result.evictedUnits > 0) return { messages, result };
    }
    throw new Error('history never reached the budget');
  }

  /**
   * The watermark that leaves the newest units worth at most `tokens`.
   * Every message in these histories is its own unit.
   */
  function watermarkLeaving(messages, tokens) {
    const history = messages.slice(1);
    let kept = 0;
    let from = history.length;
    while (from > 1 && kept + estimateMessagesTokens([history[from - 1]]) <= tokens) {
      from -= 1;
      kept += estimateMessagesTokens([history[from]]);
    }
    return from;
  }

  it('holds the cut when the next request measures a looser budget', () => {
    const { messages, result: first } = growToFirstCut(1.07);
    messages.push(...exchange(999));
    const second = manage(messages, { calibration: 1.0, evictedUnits: first.evictedUnits });
    // The scenario: at the looser calibration the whole history fits again.
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(second.tokenLimit);
    expect(second.tokenLimit).toBeGreaterThan(first.tokenLimit);
    expect(second.evictedUnits).toBe(first.evictedUnits);
    expect(second.messages.length).toBe(first.messages.length + 2);
    expect(hash(second.messages[1])).toBe(hash(first.messages[1]));
    expect(prefixFingerprint(second.messages).startsWith(prefixFingerprint(first.messages))).toBe(true);
  });

  /**
   * The caller's loop: manage, send, fold the size the provider reports into
   * the calibration used for the next request.
   */
  function drive(rounds, measuredRatio) {
    const messages = [SYSTEM];
    let watermark = 0;
    let calibration = measuredRatio({ evicted: false, round: 0 });
    let prevFingerprint = null;
    const seen = { cuts: 0, prefixBreaks: 0, movedBack: 0, overBudget: 0 };
    for (let round = 1; round <= rounds; round++) {
      messages.push(...exchange(round));
      const result = manage(messages, { calibration: Math.max(1, calibration), evictedUnits: watermark });
      if (result.evictedUnits < watermark) seen.movedBack += 1;
      if (result.evictedUnits > watermark) seen.cuts += 1;
      if (estimateMessagesTokens(result.messages) > result.tokenLimit) seen.overBudget += 1;
      const fingerprint = prefixFingerprint(result.messages);
      if (prevFingerprint !== null && !fingerprint.startsWith(prevFingerprint)) seen.prefixBreaks += 1;
      prevFingerprint = fingerprint;
      watermark = result.evictedUnits;
      const reported = Math.round(result.totalRequestTokens * measuredRatio({ evicted: watermark > 0, round }));
      calibration = updateEstimateCalibration(calibration, { input_tokens: reported }, result.totalRequestTokens);
    }
    return seen;
  }

  it.each([
    ['the evicted view measures lower than the full history', 1.07, 0.97],
    ['the evicted view measures higher than the full history', 1.0, 1.1],
    ['both measure the same', 1.07, 1.07],
  ])('never moves the cut back when %s', (_name, fullRatio, evictedRatio) => {
    const seen = drive(160, ({ evicted }) => (evicted ? evictedRatio : fullRatio));
    expect(seen.cuts).toBeGreaterThan(2); // the history crosses the budget again and again
    expect(seen.movedBack).toBe(0);
    expect(seen.prefixBreaks).toBe(seen.cuts); // the prefix changes at a cut and nowhere else
    expect(seen.overBudget).toBe(0);
  });

  it('never moves the cut back when the measured calibration differs on every request', () => {
    let state = 0x9e3779b9;
    const random = () => { // mulberry32: the sequence is the same on every run
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const seen = drive(240, () => 1 + random() * 0.2);
    expect(seen.cuts).toBeGreaterThan(2);
    expect(seen.movedBack).toBe(0);
    expect(seen.prefixBreaks).toBe(seen.cuts);
    expect(seen.overBudget).toBe(0);
  });

  it('releases when the window really grows', () => {
    const { messages, result: small } = growToFirstCut(1);
    const large = manageContext(messages, MODEL, [], PROVIDER, { contextWindow: 1_000_000, evictedUnits: small.evictedUnits });
    expect(large.evictedUnits).toBe(0);
    expect(large.messages.length).toBe(messages.length);
  });

  it('releases under the low-water mark and holds above it', () => {
    const budget = budgetAt(1);
    const under = historyOfShare(0.6, budget);
    const over = historyOfShare(0.8, budget);
    expect(estimateMessagesTokens(under)).toBeLessThanOrEqual(Math.floor(budget * LOW_WATER));
    expect(estimateMessagesTokens(over)).toBeGreaterThan(Math.floor(budget * LOW_WATER));
    expect(estimateMessagesTokens(over)).toBeLessThanOrEqual(budget);
    // A watermark that leaves most of a cut's worth of history in both.
    const healthy = (messages) => watermarkLeaving(messages, cutHistoryTokens(budget) * 0.8);

    const released = manage(under, { evictedUnits: healthy(under) });
    expect(released.evictedUnits).toBe(0);
    expect(released.messages.length).toBe(under.length);

    const held = manage(over, { evictedUnits: healthy(over) });
    expect(held.evictedUnits).toBe(healthy(over));
    expect(held.messages.length).toBe(over.length - healthy(over));
  });

  it('sends a history that was cut back to before the watermark whole when it fits', () => {
    const budget = budgetAt(1);
    const messages = historyOfShare(0.9, budget);
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(budget);
    // Carried from a longer history: more units than this one has.
    const result = manage(messages, { evictedUnits: messages.length + 300 });
    expect(result.evictedUnits).toBe(0);
    expect(result.messages.length).toBe(messages.length);
  });

  it('sends a history that was cut back to just past the watermark whole when it fits', () => {
    const budget = budgetAt(1);
    const messages = historyOfShare(0.9, budget);
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(budget);
    // Only the last four messages are past it.
    const result = manage(messages, { evictedUnits: messages.length - 1 - 4 });
    expect(result.evictedUnits).toBe(0);
    expect(result.messages.length).toBe(messages.length);
  });

  it('holds a watermark that leaves at least half of a cut, releases one that leaves less', () => {
    const budget = budgetAt(1);
    const messages = historyOfShare(0.9, budget);
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(budget);
    const cut = cutHistoryTokens(budget);

    const leavesMore = watermarkLeaving(messages, cut * 0.6);
    const held = manage(messages, { evictedUnits: leavesMore });
    expect(held.evictedUnits).toBe(leavesMore);
    expect(held.messages.length).toBe(messages.length - leavesMore);
    expect(estimateMessagesTokens(held.messages.slice(1))).toBeGreaterThanOrEqual(cut * 0.5);

    const leavesLess = watermarkLeaving(messages, cut * 0.4);
    const released = manage(messages, { evictedUnits: leavesLess });
    expect(released.evictedUnits).toBe(0);
    expect(released.messages.length).toBe(messages.length);
  });

  // The same three cases when the history is over the budget: a watermark
  // that no longer matches is forgotten and the history is cut as if it had
  // never been cut before.
  it('cuts an over-budget history afresh when the watermark is beyond its end', () => {
    const budget = budgetAt(1);
    const messages = historyOfShare(1.4, budget);
    const fresh = manage(messages, {});
    expect(fresh.evictedUnits).toBeGreaterThan(0);
    // Carried from a longer history: more units than this one has.
    const result = manage(messages, { evictedUnits: messages.length + 300 });
    expect(result.evictedUnits).toBe(fresh.evictedUnits);
    expect(result.messages.length).toBe(fresh.messages.length);
    expect(estimateMessagesTokens(result.messages)).toBeLessThanOrEqual(result.tokenLimit);
    expect(estimateMessagesTokens(result.messages.slice(1))).toBeGreaterThanOrEqual(cutHistoryTokens(budget) * 0.9);
  });

  it('cuts an over-budget history afresh when the watermark leaves only its last few messages', () => {
    const budget = budgetAt(1);
    const messages = historyOfShare(1.4, budget);
    const fresh = manage(messages, {});
    const result = manage(messages, { evictedUnits: messages.length - 1 - 4 });
    expect(result.evictedUnits).toBe(fresh.evictedUnits);
    expect(result.messages.length).toBe(fresh.messages.length);
  });

  it('holds a watermark that leaves most of a cut on an over-budget history', () => {
    const budget = budgetAt(1);
    const messages = historyOfShare(1.4, budget);
    const healthy = watermarkLeaving(messages, cutHistoryTokens(budget) * 0.8);
    const result = manage(messages, { evictedUnits: healthy });
    expect(result.evictedUnits).toBe(healthy);
    expect(result.messages.length).toBe(messages.length - healthy);
  });

  it('cuts afresh when the watermark was counted on a history that grouped into more units', () => {
    // One conversation in two groupings: tool rounds of two messages each,
    // and the same messages with every one its own unit. A count taken on
    // the second points past the end of the first.
    const budget = budgetAt(1);
    const rounds = [SYSTEM];
    for (let t = 1; estimateMessagesTokens(rounds) < budget * 1.4; t++) {
      seq += 1;
      rounds.push(
        {
          role: 'assistant',
          content: `[t${t} a${seq}] ` + 'reply '.repeat(900),
          tool_calls: [{ id: `call_${seq}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: `call_${seq}`, content: `[t${t} r${seq}] ` + 'word '.repeat(900) },
      );
    }
    const ungrouped = rounds.map((m) => (m.role === 'system' ? m : { role: m.role === 'tool' ? 'user' : 'assistant', content: m.content }));
    const countedUngrouped = manage(ungrouped, {}).evictedUnits;
    const fresh = manage(rounds, {});
    expect(fresh.evictedUnits).toBeGreaterThan(0);
    expect(countedUngrouped).toBeGreaterThan(fresh.evictedUnits * 1.5);

    const result = manage(rounds, { evictedUnits: countedUngrouped });
    expect(result.evictedUnits).toBe(fresh.evictedUnits);
    expect(result.messages.length).toBe(fresh.messages.length);
  });
});
