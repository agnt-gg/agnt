/**
 * Cache-freshness signal: `accumulateUsage` must report cache activity on
 * EVERY round, not only at turn end.
 *
 * The bug this pins: the panel's "last confirmed cache activity" clock was fed
 * exclusively by `agent_execution_completed`, which fires once, at the end of a
 * turn. An agentic turn routinely runs for 30-50 minutes making cached requests
 * the whole way through, so the panel told the user "prompt cache has probably
 * gone cold, the next turn would rewrite the whole prefix at full price" during
 * the very turn that was reading the cache on every round. Measured on live
 * data: conversation 523e7fa5 had a turn in flight and reported its cache as
 * 348 minutes stale against a 60-minute window.
 *
 * `accumulateUsage` is a closure inside a ~1500-line method that cannot be
 * imported without booting the entire application, so this suite extracts the
 * REAL function source and executes it against stub collaborators. That is
 * strictly stronger than a source-contract grep: these tests run the actual
 * shipped bytes, so they cannot pass against a version of the function that
 * only *mentions* the right identifiers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readOpenAiShapedCacheUsage } from '../utils/usageCacheFields.js';
import { promptCacheTtlMs } from '../utils/promptCacheTtl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(__dirname, 'OrchestratorService.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

/** Slice out `function accumulateUsage(...) { ... }` by brace matching. */
function extractAccumulateUsage(source) {
  const start = source.indexOf('function accumulateUsage(usage) {');
  if (start === -1) throw new Error('accumulateUsage not found in OrchestratorService.js');
  let depth = 0;
  let i = source.indexOf('{', start);
  const bodyStart = i;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error('unbalanced braces while extracting accumulateUsage');
}

const BODY = extractAccumulateUsage(SRC);

/**
 * @param {object} [opts]
 * @param {string} [opts.provider] Drives cache-write TTL bucketing. The write
 *   duration is a property of the REQUEST, so the function needs to know which
 *   provider/model the round was sent to.
 * @param {string} [opts.model]
 */
function makeHarness({ provider = 'openai', model = 'gpt-4o' } = {}) {
  const events = [];
  const tokenAccumulator = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  };
  const conversationContext = { _turnRound: 1 };
  const sendEvent = (name, data) => events.push({ name, data });

  // Collaborators are injected as the REAL implementations, not stubs, so the
  // extracted bytes are exercised against the same helpers that ship. A stub
  // here would let a broken usage-parser or TTL table pass unnoticed.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'tokenAccumulator',
    'conversationContext',
    'sendEvent',
    'readOpenAiShapedCacheUsage',
    'promptCacheTtlMs',
    'normalizedProvider',
    'model',
    `return function accumulateUsage(usage) ${BODY};`
  );
  return {
    accumulateUsage: factory(
      tokenAccumulator,
      conversationContext,
      sendEvent,
      readOpenAiShapedCacheUsage,
      promptCacheTtlMs,
      provider,
      model
    ),
    events,
    tokenAccumulator,
    conversationContext,
    cacheEvents: () => events.filter((e) => e.name === 'cache_activity'),
  };
}

describe('accumulateUsage -> cache_activity (per-round freshness signal)', () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it('reports a cache READ the round it is observed (Anthropic shape)', () => {
    h.accumulateUsage({
      input_tokens: 1200,
      output_tokens: 500,
      cache_read_input_tokens: 158539,
      cache_creation_input_tokens: 0,
    });

    const [ev] = h.cacheEvents();
    expect(ev).toBeDefined();
    expect(ev.data.cacheReadTokens).toBe(158539);
    expect(ev.data.cacheCreationTokens).toBe(0);
    expect(Number.isFinite(Date.parse(ev.data.at))).toBe(true);
  });

  it('reports a cache WRITE too, because rewriting the prefix makes it warm again', () => {
    h.accumulateUsage({
      input_tokens: 900,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 67516,
    });

    const [ev] = h.cacheEvents();
    expect(ev).toBeDefined();
    expect(ev.data.cacheReadTokens).toBe(0);
    expect(ev.data.cacheCreationTokens).toBe(67516);
  });

  it('reports OpenAI Chat Completions cache hits (prompt_tokens_details)', () => {
    h.accumulateUsage({
      prompt_tokens: 90000,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 64000 },
    });

    const [ev] = h.cacheEvents();
    expect(ev).toBeDefined();
    expect(ev.data.cacheReadTokens).toBe(64000);
    expect(ev.data.cacheCreationTokens).toBe(0);
  });

  it('reports Responses/Codex cache hits (input_tokens_details)', () => {
    h.accumulateUsage({
      input_tokens: 90000,
      output_tokens: 300,
      input_tokens_details: { cached_tokens: 51200 },
    });

    const [ev] = h.cacheEvents();
    expect(ev).toBeDefined();
    expect(ev.data.cacheReadTokens).toBe(51200);
  });

  it('carries the round number so the panel can attribute the observation', () => {
    h.conversationContext._turnRound = 7;
    h.accumulateUsage({ input_tokens: 10, cache_read_input_tokens: 5 });
    expect(h.cacheEvents()[0].data.round).toBe(7);
  });

  it('fires once per round, so a 24-round turn keeps the clock alive throughout', () => {
    for (let i = 0; i < 24; i += 1) {
      h.conversationContext._turnRound = i + 1;
      h.accumulateUsage({ input_tokens: 100, cache_read_input_tokens: 140000 });
    }
    expect(h.cacheEvents()).toHaveLength(24);
    expect(h.cacheEvents().map((e) => e.data.round)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1)
    );
  });

  it('stays silent when a round reported no cache at all', () => {
    h.accumulateUsage({ prompt_tokens: 5000, completion_tokens: 120 });
    expect(h.cacheEvents()).toHaveLength(0);
  });

  it('stays silent — and does not throw — on missing usage', () => {
    expect(() => h.accumulateUsage(undefined)).not.toThrow();
    expect(() => h.accumulateUsage(null)).not.toThrow();
    expect(h.cacheEvents()).toHaveLength(0);
  });

  it('never claims activity from a zeroed cache field', () => {
    h.accumulateUsage({
      input_tokens: 5000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      prompt_tokens_details: { cached_tokens: 0 },
    });
    expect(h.cacheEvents()).toHaveLength(0);
  });
});

describe('accumulateUsage token accounting (regression guard)', () => {
  // The two provider shapes count input tokens differently: Anthropic's
  // input_tokens EXCLUDES cached tokens, OpenAI's prompt_tokens INCLUDES them.
  // Adding the cache signal must not collapse that distinction.
  it('Anthropic: total input = uncached + read + write', () => {
    const h = makeHarness();
    h.accumulateUsage({
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 500,
    });
    expect(h.tokenAccumulator.inputTokens).toBe(6500);
    expect(h.tokenAccumulator.outputTokens).toBe(200);
    expect(h.tokenAccumulator.totalTokens).toBe(6700);
    expect(h.tokenAccumulator.cacheReadTokens).toBe(5000);
    expect(h.tokenAccumulator.cacheCreationTokens).toBe(500);
  });

  it('OpenAI: prompt_tokens is already the total and is NOT re-added', () => {
    const h = makeHarness();
    h.accumulateUsage({
      prompt_tokens: 90000,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 64000 },
    });
    expect(h.tokenAccumulator.inputTokens).toBe(90000);
    expect(h.tokenAccumulator.cacheReadTokens).toBe(64000);
    expect(h.tokenAccumulator.cacheCreationTokens).toBe(0);
  });

  it('preserves the hybrid 5m/1h cache-write split', () => {
    const h = makeHarness();
    h.accumulateUsage({
      input_tokens: 100,
      cache_creation_input_tokens: 3000,
      cache_creation_5m_input_tokens: 1000,
      cache_creation_1h_input_tokens: 2000,
    });
    expect(h.tokenAccumulator.cacheCreation5mTokens).toBe(1000);
    expect(h.tokenAccumulator.cacheCreation1hTokens).toBe(2000);
  });
});

describe('accumulateUsage: OpenRouter cache writes', () => {
  // REGRESSION: `prompt_tokens_details.cache_write_tokens` was never read, so
  // every OpenRouter cache write accumulated as zero. 816 executions in the
  // live ledger recorded cache_creation_tokens = 0 while paying a 2x write
  // premium — caching looked switched off exactly when it was working.
  const openRouterWrite = {
    prompt_tokens: 8522,
    completion_tokens: 5,
    prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 8519 },
  };

  it('records the write', () => {
    const h = makeHarness({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' });
    h.accumulateUsage(openRouterWrite);
    expect(h.tokenAccumulator.cacheCreationTokens).toBe(8519);
  });

  it('buckets it as 1h when that is the TTL the request asked for', () => {
    // Priced at 2.0x, not 1.25x. Getting this wrong understates the write.
    const h = makeHarness({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' });
    h.accumulateUsage(openRouterWrite);
    expect(h.tokenAccumulator.cacheCreation1hTokens).toBe(8519);
    expect(h.tokenAccumulator.cacheCreation5mTokens).toBe(0);
  });

  it('buckets it as 5m where no hour was requested', () => {
    const h = makeHarness({ provider: 'openrouter', model: 'qwen/qwen3-coder-plus' });
    h.accumulateUsage(openRouterWrite);
    expect(h.tokenAccumulator.cacheCreation5mTokens).toBe(8519);
    expect(h.tokenAccumulator.cacheCreation1hTokens).toBe(0);
  });

  it('does NOT re-add the write to input — prompt_tokens already includes it', () => {
    // Verified live: prompt_tokens 8522 alongside cache_write_tokens 8519.
    // Adding them would double-bill every write turn.
    const h = makeHarness({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' });
    h.accumulateUsage(openRouterWrite);
    expect(h.tokenAccumulator.inputTokens).toBe(8522);
  });

  it('emits cache_activity for a write-only round', () => {
    // The freshness clock must start ticking on the turn that WRITES the
    // prefix, not only once something reads it back.
    const h = makeHarness({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' });
    h.accumulateUsage(openRouterWrite);
    expect(h.cacheEvents()).toHaveLength(1);
    expect(h.cacheEvents()[0].data.cacheCreationTokens).toBe(8519);
  });

  it('records the read on the following turn', () => {
    const h = makeHarness({ provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' });
    h.accumulateUsage({
      prompt_tokens: 8525,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 8513, cache_write_tokens: 0 },
    });
    expect(h.tokenAccumulator.cacheReadTokens).toBe(8513);
    expect(h.tokenAccumulator.cacheCreationTokens).toBe(0);
    expect(h.tokenAccumulator.inputTokens).toBe(8525);
  });
});
