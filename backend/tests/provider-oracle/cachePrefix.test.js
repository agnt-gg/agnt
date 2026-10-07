import { describe, it, expect } from 'vitest';

import { getAllProviderKeys } from '../../src/services/ai/providerConfigs.js';
import { createLlmAdapter } from '../../src/services/orchestrator/llmAdapters.js';
import { toOpenAIHistory } from '../../src/services/orchestrator/nativeHistory.js';
import { makeCaptureClient } from './capture.js';
import { oracleModelFor } from './record.mjs';

/**
 * PROMPT-CACHE PREFIX ORACLE.
 *
 * Every provider's prompt cache is a byte-prefix match. So the one property a
 * history transform must never break is: the conversation this turn sends is a
 * byte-for-byte prefix of the conversation the NEXT turn sends.
 *
 * Driven through each provider's REAL adapter (callStream and call), for every
 * provider in the registry, on two ledgers:
 *   openai-shaped  the ordinary history every non-Claude turn carries;
 *   claude-native  a history with Anthropic blocks in it — what a Claude Code
 *                  turn leaves behind and a failover hands to the next tier.
 *
 * Two documented equivalences are applied before comparing, and nothing else:
 *   1. `cache_control` is stripped. The rolling breakpoints are designed to
 *      move to the newest message every turn; Anthropic: the cache entry is
 *      "a hash of the prefix ending at that block" and with automatic caching
 *      "the cache point moves forward automatically as conversations grow".
 *      The marker selects WHERE to cache; it is not part of the prefix.
 *   2. `content: "x"` equals `content: [{type:'text', text:'x'}]`. The string is
 *      the API's shorthand for exactly that one block, and a marked message
 *      has to be written in block form to carry its marker. Only that exact
 *      shape is folded: any other key, or a second block, still compares raw.
 */

const SYSTEM = { role: 'system', content: 'You are AGNT. Stable system prompt for the cache oracle.' };
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function openAIShapedTurns() {
  const turnN = [
    SYSTEM,
    { role: 'user', content: 'find the bug' },
    { role: 'assistant', content: 'Reading the file.', tool_calls: [call('call_A', 'read_file', { path: 'a.js' })] },
    { role: 'tool', tool_call_id: 'call_A', content: 'const a = 1;' },
    { role: 'assistant', content: 'Line 1 is fine.' },
    { role: 'user', content: 'check b.js too' },
  ];
  return [turnN, [...turnN, { role: 'assistant', content: 'b.js is fine as well.' }, { role: 'user', content: 'thanks, ship it' }]];
}

function claudeNativeTurns() {
  const turnN = [
    SYSTEM,
    { role: 'user', content: 'find the bug' },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'SIG-1' },
      { type: 'text', text: 'Reading the file.' },
      { type: 'tool_use', id: 'toolu_A', name: 'read_file', input: { path: 'a.js' } },
    ] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'const a = 1;' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'SIG-2' }, { type: 'text', text: 'Line 1 is fine.' }] },
    { role: 'user', content: 'check b.js too' },
  ];
  return [turnN, [...turnN, { role: 'assistant', content: 'b.js is fine as well.' }, { role: 'user', content: 'thanks, ship it' }]];
}

const withoutCacheMarkers = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'cache_control' ? undefined : v)));

/** Equivalence 2: a lone, plain text block is the string it abbreviates. */
function foldTextShorthand(message) {
  const content = message?.content;
  const lone = Array.isArray(content) && content.length === 1 ? content[0] : null;
  const isPlainText = lone && lone.type === 'text' && typeof lone.text === 'string' && Object.keys(lone).length === 2;
  return isPlainText ? { ...message, content: lone.text } : message;
}

/** The conversation array of a captured request, whichever SDK surface it used. */
function conversationOf(params) {
  const list = params?.input ?? params?.messages ?? params?.contents;
  return Array.isArray(list) ? withoutCacheMarkers(list).map(foldTextShorthand) : null;
}

async function wireFor(key, model, messages, method) {
  const { client, captured } = makeCaptureClient();
  const adapter = await createLlmAdapter(key, client, model, { conversationId: 'cache-oracle-conversation' });
  const copy = structuredClone(messages);
  try {
    if (method === 'callStream') await adapter.callStream(copy, [], () => {}, {});
    else await adapter.call(copy, [], {});
  } catch (err) {
    if (!err?.__oracleSentinel && !String(err?.message || '').includes('__ORACLE_CAPTURE__')) throw err;
  }
  return captured.length ? { params: captured[0].params, options: captured[0].options, ledgerAfter: copy } : null;
}

const providers = getAllProviderKeys();
const ledgers = { 'openai-shaped': openAIShapedTurns, 'claude-native': claudeNativeTurns };

describe.each(providers)('%s keeps its prompt-cache prefix', (key) => {
  const model = oracleModelFor(key);

  describe.each(Object.keys(ledgers))('%s history', (ledgerName) => {
    it.each(['callStream', 'call'])('%s: turn N is a byte prefix of turn N+1', async (method) => {
      const [turnN, turnNext] = ledgers[ledgerName]();
      const first = await wireFor(key, model, turnN, method);
      const second = await wireFor(key, model, turnNext, method);
      if (!first || !second) return; // this entry point does not reach an SDK surface for this provider

      const before = conversationOf(first.params);
      const after = conversationOf(second.params);
      expect(before, 'captured request carries a conversation').not.toBeNull();
      expect(after.length).toBeGreaterThan(before.length);
      expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before));

      // Everything outside the conversation that a cache keys on is unchanged too.
      const { input: _a, messages: _b, contents: _c, ...restBefore } = first.params;
      const { input: _d, messages: _e, contents: _f, ...restAfter } = second.params;
      expect(JSON.stringify(withoutCacheMarkers(restAfter))).toBe(JSON.stringify(withoutCacheMarkers(restBefore)));
      expect(JSON.stringify(second.options ?? null)).toBe(JSON.stringify(first.options ?? null));
    }, 60000);
  });

  it('never mutates the ledger it is handed (the next turn is built from it)', async () => {
    const [turnN] = claudeNativeTurns();
    const captured = await wireFor(key, model, turnN, 'callStream');
    if (!captured) return;
    expect(captured.ledgerAfter).toEqual(claudeNativeTurns()[0]);
  }, 60000);
});

describe('translation is a pure per-message function', () => {
  it('translating a longer history never changes how an earlier message translates', () => {
    const [turnN, turnNext] = claudeNativeTurns();
    const a = toOpenAIHistory(turnN);
    const b = toOpenAIHistory(turnNext);
    expect(JSON.stringify(b.slice(0, a.length))).toBe(JSON.stringify(a));
  });

  it('an ordinary history goes through untouched — same array, same bytes', () => {
    const [turnN] = openAIShapedTurns();
    expect(toOpenAIHistory(turnN)).toBe(turnN);
  });
});
