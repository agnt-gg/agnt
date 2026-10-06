import { describe, it, expect } from 'vitest';
import {
  ageToolResults, agedStub, agedDataId, KEEP_RECENT, HIGH_WATER_TOKENS, MIN_AGE_CHARS,
} from './toolResultAging.js';
import { USER_AFTER_TOOL_RESULT_LABEL } from './turnContinuity.js';
import { TOOL_LOAD_FIELD } from './deferredTools.js';
import { AnthropicAdapter } from './llmAdapters.js';

const big = (n) => `r${n}:` + 'x'.repeat(20_000); // ~5k tokens each
const call = (id, name = 'web_scrape') => ({ id, type: 'function', function: { name, arguments: JSON.stringify({ n: id }) } });

/** An OpenAI-shaped ledger of `count` single-call rounds, each with a big result. */
function ledger(count, { name = 'web_scrape', size = big } = {}) {
  const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'go' }];
  for (let i = 0; i < count; i += 1) {
    messages.push({ role: 'assistant', content: '', tool_calls: [call(`c${i}`, name)] });
    messages.push({ role: 'tool', tool_call_id: `c${i}`, content: size(i) });
  }
  return messages;
}
const tokensOf = (messages) => JSON.stringify(messages).length / 4;

describe('ageToolResults', () => {
  it('does nothing below the high-water mark', () => {
    const messages = ledger(KEEP_RECENT + 2); // 2 old results ~ 10k tokens
    const context = {};
    expect(ageToolResults(messages, context)).toBe(messages);
    expect(context._agedToolCallIds).toBeUndefined();
  });

  it('ages every old result in ONE batch once they pass the mark, keeping the recent ones whole', () => {
    const old = Math.ceil(HIGH_WATER_TOKENS / 5000) + 1;
    const messages = ledger(KEEP_RECENT + old);
    const context = {};
    const out = ageToolResults(messages, context);
    expect(context._agedToolCallIds).toHaveLength(old);
    const results = out.filter((m) => m.role === 'tool');
    expect(results.slice(0, old).every((m) => m.content === agedStub(m.tool_call_id, 'web_scrape'))).toBe(true);
    expect(results.slice(old).every((m) => m.content.startsWith('r'))).toBe(true);
    // Every aged result shrank from ~5k tokens to a ~60-token stub.
    expect(tokensOf(messages) - tokensOf(out)).toBeGreaterThan(old * 4_900);
  });

  it('never loses a result: the full text is stored where query_data reads it', () => {
    const messages = ledger(KEEP_RECENT + 10);
    const context = {};
    ageToolResults(messages, context);
    expect(context.preservedContent[agedDataId('c0')]).toBe(big(0));
    expect(context.dataRefSummaries[agedDataId('c0')].size).toBe(big(0).length);
  });

  it('does not touch the ledger it was given', () => {
    const messages = ledger(KEEP_RECENT + 10);
    const before = JSON.stringify(messages);
    ageToolResults(messages, {});
    expect(JSON.stringify(messages)).toBe(before);
  });

  it('is cache-stable: between batches every request is a byte prefix of the next', () => {
    const context = {};
    let previous = null;
    let boundaries = 0;
    for (let rounds = 1; rounds <= 60; rounds += 1) {
      const request = JSON.stringify(ageToolResults(ledger(rounds), context).slice(0, -2)); // all but the newest round
      const agedBefore = (context._agedBefore ?? 0);
      if (previous !== null && !request.startsWith(previous.slice(0, -1))) {
        boundaries += 1;
        expect((context._agedToolCallIds || []).length).toBeGreaterThan(agedBefore); // a break happens only on a batch
      }
      context._agedBefore = (context._agedToolCallIds || []).length;
      previous = JSON.stringify(ageToolResults(ledger(rounds), context));
    }
    expect(boundaries).toBeGreaterThan(0);
    expect(boundaries).toBeLessThanOrEqual(8); // 60 rounds x 5k tokens: a handful of batches, not one per round
  });

  it('replays the same stubs from a fresh context restored with the watermark (restart, next turn)', () => {
    const messages = ledger(KEEP_RECENT + 10);
    const live = {};
    const first = ageToolResults(messages, live);
    const restored = { _agedToolCallIds: [...live._agedToolCallIds] };
    expect(ageToolResults(messages, restored)).toEqual(first);
    expect(restored.preservedContent[agedDataId('c0')]).toBe(big(0)); // repopulated from the ledger
  });

  it('stubs an aged id the same way whatever copy of the result this request carries', () => {
    const context = {};
    ageToolResults(ledger(KEEP_RECENT + 10), context);
    const shortCopy = ledger(KEEP_RECENT + 10, { size: (i) => `r${i}: cut by the client` });
    const out = ageToolResults(shortCopy, context);
    expect(out.find((m) => m.tool_call_id === 'c0').content).toBe(agedStub('c0', 'web_scrape'));
  });

  it('never ages skill playbooks, small results, tool loads, or user text folded into a result', () => {
    // 14 old results: 4 exempt ones, and 10 ordinary ones (~50k tokens) to cross the mark.
    const messages = ledger(KEEP_RECENT + 14);
    messages[3] = { ...messages[3], content: 'tiny' };                                                    // c0: small
    messages[4] = { ...messages[4], tool_calls: [call('c1', 'activate_skill')] };                         // c1: skill
    messages[7] = { ...messages[7], content: `${big(2)}\n${USER_AFTER_TOOL_RESULT_LABEL}\nstop` };        // c2: steer
    messages[9] = { ...messages[9], [TOOL_LOAD_FIELD]: { names: ['x'], schemas: [] } };                   // c3: load
    const context = {};
    const out = ageToolResults(messages, context);
    expect(context._agedToolCallIds).toContain('c4');
    for (const id of ['c0', 'c1', 'c2', 'c3']) {
      expect(context._agedToolCallIds).not.toContain(id);
      expect(out.find((m) => m.tool_call_id === id).content).toBe(messages.find((m) => m.tool_call_id === id).content);
    }
    expect(MIN_AGE_CHARS).toBeGreaterThan('tiny'.length);
  });

  it('ages Anthropic-native tool_result blocks and the wire stays well-formed', () => {
    const messages = [{ role: 'user', content: 'go' }];
    for (let i = 0; i < KEEP_RECENT + 10; i += 1) {
      messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'web_scrape', input: { i } }] });
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: big(i) }] });
    }
    const out = ageToolResults(messages, {});
    expect(out[2].content[0].content).toBe(agedStub('t0', 'web_scrape'));
    const wire = new AnthropicAdapter({ messages: { create: async () => ({}) } }, 'claude-opus-5-5')._normalizeHistoryMessages(structuredClone(out));
    expect(wire.filter((m) => m.role === 'assistant')).toHaveLength(KEEP_RECENT + 10); // every pair survives
  });
});
