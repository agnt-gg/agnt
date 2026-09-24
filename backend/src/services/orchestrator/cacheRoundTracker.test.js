import { describe, it, expect } from 'vitest';
import {
  createCacheRoundTracker,
  classifyCacheRound,
  fingerprintRequest,
  findHistoryDivergence,
  buildCacheTelemetry,
  CACHE_CAUSES,
  MAX_CACHE_ROUNDS,
} from './cacheRoundTracker.js';
import { normalizeExecutionTelemetry } from '../ai/executionTelemetry.js';

const HOUR = 60 * 60 * 1000;
const SECRET = 'PRIVATE_USER_TEXT_7f3a';
const system = { role: 'system', content: 'You are Annie.' };
const tools = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }];
const user = (text) => ({ role: 'user', content: text });
const assistant = (text) => ({ role: 'assistant', content: text });

/** A tracker with a controllable clock. */
function harness(carried = null) {
  let clock = 1_000_000;
  const tracker = createCacheRoundTracker({ carried, now: () => clock });
  const send = (messages, usage, { toolList = tools, provider = 'claude-code', model = 'claude-opus-5', advanceMs = 1000, ttlMs = HOUR } = {}) => {
    clock += advanceMs;
    tracker.stamp({ provider, model, messages, tools: toolList });
    return tracker.observe(usage, ttlMs);
  };
  return { tracker, send };
}

// Anthropic-shaped: promptTokens = uncached + read + write.
const warmTurn = [system, user('hi'), assistant('hello')];

describe('classifyCacheRound — one case per cause', () => {
  it('cold: nothing to compare against', () => {
    const { send } = harness();
    expect(send([system, user('hi')], { promptTokens: 20000, write1h: 19000 }).cause).toBe('cold');
  });

  it('ok: read the whole previous prompt back, write is tail growth', () => {
    const { send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000 });
    const r = send(warmTurn, { promptTokens: 20500, read: 20000, write1h: 500 });
    expect(r.cause).toBe('ok');
    expect(r.lostTokens).toBe(0);
  });

  it('ok tolerates block-granularity shortfall below the threshold', () => {
    const { send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000 });
    expect(send(warmTurn, { promptTokens: 20500, read: 19100, write1h: 1400 }).cause).toBe('ok');
  });

  it('model_changed beats every other cause (caches are per model)', () => {
    const { send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000 });
    const r = send(warmTurn, { promptTokens: 20500, write1h: 20500 }, { model: 'claude-fable-5-1', toolList: [] });
    expect(r.cause).toBe('model_changed');
  });

  it('ttl_expired: idle longer than the TTL we asked for', () => {
    const { send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000 });
    const r = send(warmTurn, { promptTokens: 20500, write1h: 20500 }, { advanceMs: HOUR + 1 });
    expect(r.cause).toBe('ttl_expired');
    expect(r.lostTokens).toBe(20000);
  });

  it('tools_changed', () => {
    const { send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000 });
    const grown = [...tools, { type: 'function', function: { name: 'web_search' } }];
    expect(send(warmTurn, { promptTokens: 21000, write1h: 21000 }, { toolList: grown }).cause).toBe('tools_changed');
  });

  it('system_changed', () => {
    const { send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000 });
    const r = send([{ role: 'system', content: 'You are Annie. Now 12:01.' }, user('hi'), assistant('hello')], { promptTokens: 20500, write1h: 20500 });
    expect(r.cause).toBe('system_changed');
  });

  it('history_rewritten reports where and which role diverged', () => {
    const { send } = harness();
    send([system, user('hi'), assistant('a'), user('b')], { promptTokens: 20000, write1h: 20000 });
    const r = send([system, user('hi'), assistant('a — edited'), user('b'), assistant('c')], { promptTokens: 20500, read: 3000, write1h: 17500 });
    expect(r.cause).toBe('history_rewritten');
    expect(r.divergeAt).toBe(1);
    expect(r.divergeRole).toBe('assistant');
  });

  it('history_rewritten when an old message is evicted', () => {
    const { send } = harness();
    send([system, user('old'), assistant('x'), user('new')], { promptTokens: 20000, write1h: 20000 });
    expect(send([system, assistant('x'), user('new')], { promptTokens: 19000, write1h: 19000 }).divergeAt).toBe(0);
  });

  it('unexplained_miss: everything we control matched, the provider still under-read', () => {
    const { send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000 });
    const r = send(warmTurn, { promptTokens: 20500, read: 4000, write1h: 16500 });
    expect(r.cause).toBe('unexplained_miss');
    expect(r.lostTokens).toBe(16000);
  });

  it('every cause the classifier can emit is a declared cause', () => {
    for (const c of ['cold', 'ok', 'model_changed', 'ttl_expired', 'tools_changed', 'system_changed', 'history_rewritten', 'unexplained_miss']) {
      expect(CACHE_CAUSES).toContain(c);
    }
  });

  it('a null TTL (unknown lifetime) never claims expiry', () => {
    const prev = { provider: 'p', model: 'm', toolsFp: 'a', systemFp: 'b', messageHashes: [], promptTokens: 100 };
    const cur = { ...prev, msSincePrev: 10 * HOUR, read: 100, messageHashes: [] };
    expect(classifyCacheRound({ previous: prev, current: cur, ttlMs: null }).cause).toBe('ok');
  });
});

describe('fingerprints', () => {
  it('ignore cache_control markers the transports add in place', () => {
    const plain = [system, { role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const marked = [system, { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '1h' } }] }];
    const a = fingerprintRequest({ provider: 'x', model: 'y', messages: plain, tools });
    const b = fingerprintRequest({ provider: 'x', model: 'y', messages: marked, tools });
    expect(b.messageHashes).toEqual(a.messageHashes);
    expect(b.systemFp).toBe(a.systemFp);
  });

  it('separate the system block from history', () => {
    const f = fingerprintRequest({ messages: [system, user('a'), assistant('b')], tools });
    expect(f.messageHashes).toHaveLength(2);
    expect(f.messageRoles).toEqual(['user', 'assistant']);
  });

  it('count content blocks and tool calls', () => {
    const f = fingerprintRequest({ messages: [user('a'), { role: 'assistant', content: [{ type: 'text' }, { type: 'text' }], tool_calls: [{}, {}] }] });
    expect(f.blocks).toBe(1 + 4);
  });

  it('findHistoryDivergence returns -1 for a pure extension', () => {
    expect(findHistoryDivergence(['a', 'b'], ['a', 'b', 'c'])).toBe(-1);
    expect(findHistoryDivergence(['a', 'b'], ['a'])).toBe(1);
  });
});

describe('content-free by construction', () => {
  it('no round or carried state contains message, system or tool text', () => {
    const { tracker, send } = harness();
    send([{ role: 'system', content: SECRET }, user(SECRET)], { promptTokens: 100, write1h: 100 }, { toolList: [{ function: { name: SECRET } }] });
    send([{ role: 'system', content: SECRET }, user(SECRET), assistant(SECRET)], { promptTokens: 150, read: 100, write1h: 50 }, { toolList: [{ function: { name: SECRET } }] });
    expect(JSON.stringify(tracker.rounds())).not.toContain(SECRET);
    expect(JSON.stringify(tracker.carryState())).not.toContain(SECRET);
  });
});

describe('turn lifecycle', () => {
  it('the first request of a turn is judged against the previous turn', () => {
    const t1 = harness();
    t1.send(warmTurn, { promptTokens: 20000, write1h: 20000 });
    const t2 = harness(t1.tracker.carryState());
    // Previous turn's last assistant message was rewritten between turns.
    const r = t2.send([system, user('hi'), assistant('hello (edited)'), user('next')], { promptTokens: 20600, read: 2000, write1h: 18600 });
    expect(r.firstOfTurn).toBe(true);
    expect(r.cause).toBe('history_rewritten');
    expect(r.msSincePrev).not.toBeNull();
  });

  it('a stamp with no usage (failed tier) is superseded by the next stamp', () => {
    const { tracker } = harness();
    tracker.stamp({ provider: 'claude-code', model: 'm', messages: warmTurn, tools });
    tracker.stamp({ provider: 'openai-codex', model: 'gpt', messages: warmTurn, tools });
    const r = tracker.observe({ promptTokens: 100 }, HOUR);
    expect(tracker.requestsStamped()).toBe(2);
    expect(tracker.observedCount()).toBe(1);
    expect(r.round).toBe(1);
  });

  it('observe without a stamp records nothing', () => {
    const { tracker } = harness();
    expect(tracker.observe({ promptTokens: 1 }, HOUR)).toBeNull();
    expect(tracker.rounds()).toEqual([]);
  });

  it('rounds are capped so a runaway turn cannot grow the row without bound', () => {
    const { tracker, send } = harness();
    for (let i = 0; i < MAX_CACHE_ROUNDS + 5; i += 1) send([system, user('x')], { promptTokens: 10, read: 10 });
    expect(tracker.rounds()).toHaveLength(MAX_CACHE_ROUNDS);
    expect(tracker.observedCount()).toBe(MAX_CACHE_ROUNDS + 5);
  });
});

describe('buildCacheTelemetry', () => {
  const acc = { inputTokens: 20500, outputTokens: 50, totalTokens: 20550 };

  it('produces a valid v2 envelope that round-trips through normalization', () => {
    const { tracker, send } = harness();
    send([system, user('hi')], { promptTokens: 20000, write1h: 20000, output: 25 });
    send(warmTurn, { promptTokens: 20500, read: 20000, write1h: 500, output: 25 });
    const t = buildCacheTelemetry('completed', acc, tracker);
    expect(t.version).toBe(2);
    expect(t.usageCoverage).toBe('complete');
    expect(t.toolCalls).toBeNull();
    expect(t.cacheRounds.map((r) => r.cause)).toEqual(['cold', 'ok']);
    expect(normalizeExecutionTelemetry(t)).toEqual(t);
  });

  it('reports partial coverage when a stamped request returned no usage', () => {
    const { tracker, send } = harness();
    tracker.stamp({ provider: 'p', model: 'm', messages: warmTurn, tools });
    send(warmTurn, { promptTokens: 100 });
    expect(buildCacheTelemetry('failed', acc, tracker)).toMatchObject({ outcome: 'failed', usageCoverage: 'partial' });
  });

  it('returns null instead of throwing, so a measurement bug cannot strand a run in `running`', () => {
    const broken = { observedCount: () => 1, requestsStamped: () => 1, rounds: () => [{ round: 1, cause: 'not-a-cause' }] };
    expect(buildCacheTelemetry('completed', acc, broken)).toBeNull();
  });
});
