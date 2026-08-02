import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAiLikeAdapter } from './llmAdapters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal client — these tests never make a request. */
const stubClient = { chat: { completions: { create: async () => ({ choices: [] }) } } };

const makeAdapter = (model, provider = 'openrouter', extra = {}) =>
  new OpenAiLikeAdapter(stubClient, model, { provider, ...extra });

/** A realistic turn: big stable system block, then alternating history. */
const conversation = () => ([
  { role: 'system', content: 'SYSTEM PROMPT + TOOL DEFINITIONS' },
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'second question' },
]);

/** Every cache_control marker in a message array, with its position. */
const markers = (messages) => {
  const found = [];
  messages.forEach((msg, i) => {
    if (msg.cache_control) found.push({ i, role: msg.role, marker: msg.cache_control, level: 'message' });
    if (Array.isArray(msg.content)) {
      msg.content.forEach((b) => {
        if (b?.cache_control) found.push({ i, role: msg.role, marker: b.cache_control, level: 'block' });
      });
    }
  });
  return found;
};

describe('OpenAiLikeAdapter — OpenRouter cache breakpoints', () => {
  it('marks the stable system prefix and the rolling message pair', () => {
    const adapter = makeAdapter('anthropic/claude-sonnet-4.6');
    const shaped = adapter._shapeCacheBreakpoints(conversation());
    const found = markers(shaped);

    // 3 breakpoints, under Anthropic's cap of 4.
    expect(found).toHaveLength(3);
    expect(found.every((f) => f.marker.ttl === '1h')).toBe(true);

    // The system block is the whole point: it is the largest stable region and
    // the one that produced the measured 94.8% saving.
    expect(found.some((f) => f.role === 'system')).toBe(true);

    // The rolling pair sits on the last two non-system messages.
    const nonSystem = found.filter((f) => f.role !== 'system').map((f) => f.i).sort();
    expect(nonSystem).toEqual([2, 3]);
  });

  it('NEGATIVE CONTROL: an automatic family gets no markers at all', () => {
    // If this ever produces markers, we are shaping requests for upstreams
    // that never asked for them.
    for (const model of ['openai/gpt-5.2', 'x-ai/grok-4.5', 'google/gemini-2.5-flash']) {
      const shaped = makeAdapter(model)._shapeCacheBreakpoints(conversation());
      expect(markers(shaped), model).toHaveLength(0);
    }
  });

  it('NEGATIVE CONTROL: non-OpenRouter providers are untouched', () => {
    // The same OpenAI-compatible adapter serves Groq, DeepSeek, Kimi, Chutes,
    // Together and more. None of them speak cache_control.
    for (const provider of ['groq', 'deepseek', 'kimi', 'togetherai', 'chutes']) {
      const adapter = makeAdapter('anthropic/claude-sonnet-4.6', provider);
      expect(adapter.cacheContract, provider).toBeNull();
      const input = conversation();
      expect(adapter._shapeCacheBreakpoints(input), provider).toBe(input); // same reference
      expect(markers(input), provider).toHaveLength(0);
    }
  });

  it('sends a bare marker for Alibaba, whose window is not selectable', () => {
    const shaped = makeAdapter('qwen/qwen3-coder-plus')._shapeCacheBreakpoints(conversation());
    const found = markers(shaped);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.marker.ttl === undefined)).toBe(true);
  });

  it('does NOT mutate the caller’s messages', () => {
    // The array handed to an adapter is the orchestrator's live ledger.
    // _applyCacheMarker rewrites string content into content blocks in place,
    // so mutating here would leak OpenRouter request shape into conversation
    // state that the estimator, the transcript, and other providers all read.
    const original = conversation();
    const snapshot = JSON.parse(JSON.stringify(original));
    makeAdapter('anthropic/claude-sonnet-4.6')._shapeCacheBreakpoints(original);
    expect(original).toEqual(snapshot);
  });

  it('never exceeds 4 breakpoints across repeated tool rounds', () => {
    // Anthropic hard-caps at 4. Within one turn the adapter re-shapes on every
    // tool round; without the strip-before-apply step the markers accumulate
    // and the request 400s partway through a long agentic turn.
    const adapter = makeAdapter('anthropic/claude-sonnet-4.6');
    let msgs = conversation();
    for (let round = 0; round < 12; round++) {
      msgs = adapter._shapeCacheBreakpoints(msgs);
      expect(markers(msgs).length, `round ${round}`).toBeLessThanOrEqual(4);
      msgs.push({ role: 'assistant', content: `tool round ${round}` });
      msgs.push({ role: 'tool', content: `result ${round}`, tool_call_id: `t${round}` });
    }
  });

  it('re-shaping is idempotent — a second pass yields the same markers', () => {
    const adapter = makeAdapter('anthropic/claude-sonnet-4.6');
    const once = adapter._shapeCacheBreakpoints(conversation());
    const twice = adapter._shapeCacheBreakpoints(once);
    expect(markers(twice)).toEqual(markers(once));
  });

  it('handles a conversation with no system message', () => {
    const shaped = makeAdapter('anthropic/claude-sonnet-4.6')._shapeCacheBreakpoints([
      { role: 'user', content: 'only message' },
    ]);
    const found = markers(shaped);
    expect(found).toHaveLength(1);
    expect(found[0].marker.ttl).toBe('1h');
  });

  it('handles empty and malformed input without throwing', () => {
    const adapter = makeAdapter('anthropic/claude-sonnet-4.6');
    expect(() => adapter._shapeCacheBreakpoints([])).not.toThrow();
    expect(adapter._shapeCacheBreakpoints([])).toEqual([]);
    expect(() => adapter._shapeCacheBreakpoints(null)).not.toThrow();
    expect(() => adapter._shapeCacheBreakpoints([{ role: 'user', content: null }])).not.toThrow();
  });
});

describe('OpenAiLikeAdapter — OpenRouter sticky routing', () => {
  it('sends session_id derived from the conversation', () => {
    const adapter = makeAdapter('anthropic/claude-sonnet-4.6', 'openrouter', {
      conversationId: 'abc-123',
    });
    expect(adapter._cacheRoutingParams()).toEqual({ session_id: 'agnt-abc-123' });
  });

  it('NEGATIVE CONTROL: sends nothing for other providers, or with no conversation', () => {
    expect(makeAdapter('x', 'groq', { conversationId: 'abc' })._cacheRoutingParams()).toBeNull();
    expect(makeAdapter('x', 'openrouter')._cacheRoutingParams()).toBeNull();
  });

  it('respects the documented 256-character ceiling', () => {
    const adapter = makeAdapter('x', 'openrouter', { conversationId: 'z'.repeat(400) });
    expect(adapter._cacheRoutingParams().session_id.length).toBe(256);
  });
});

describe('the wiring is reachable, not merely present', () => {
  // A source-contract test that asserts PRESENCE and ORDER does not assert
  // REACHABILITY — a dead `if (false && ...)` branch satisfies every
  // positional check. These pin the call shape so an unreachable version fails.
  const SRC = fs.readFileSync(path.join(__dirname, 'llmAdapters.js'), 'utf8');

  it('shapes messages at BOTH request sites, not just the streaming one', () => {
    // callStream carries chat traffic; call() carries suggestions, titles and
    // workflow nodes. Fixing only the first leaves half the spend uncached.
    const shaped = SRC.match(/messages:\s*this\._shapeCacheBreakpoints\(currentMessages\)/g) || [];
    expect(shaped).toHaveLength(2);
    // And no request site still passes the raw array.
    expect(SRC).not.toMatch(/messages:\s*currentMessages,\n\s*tools:/);
  });

  it('merges routing params unconditionally, not behind another feature flag', () => {
    const merges = SRC.match(
      /const routingParams = this\._cacheRoutingParams\(\);\s*\n\s*if \(routingParams\) Object\.assign\(requestParams, routingParams\);/g
    ) || [];
    expect(merges).toHaveLength(2);
  });

  it('gates the contract on the provider, and that gate is live', () => {
    expect(SRC).toMatch(
      /this\.cacheContract\s*=\s*this\.provider === 'openrouter'\s*\n?\s*\?\s*resolveOpenRouterCacheContract\(model\)/
    );
    // The orchestrator must actually supply the id, or session_id is dead code.
    const orch = fs.readFileSync(
      path.join(__dirname, '../OrchestratorService.js'),
      'utf8'
    );
    const passes = orch.match(/createLlmAdapter\([^)]*conversationId[^)]*\)/g) || [];
    expect(passes.length).toBeGreaterThanOrEqual(2);
  });
});
