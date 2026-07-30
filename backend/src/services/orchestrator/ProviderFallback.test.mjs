import assert from 'node:assert';
import PF from './ProviderFallback.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '→', e.message); } };

console.log('parseFallbackList');
t('parses JSON string', () => assert.deepEqual(
  PF.parseFallbackList('[{"provider":"GrokAI","model":"grok-4.5"}]'),
  [{ provider: 'GrokAI', model: 'grok-4.5' }]));
t('empty/blank → []', () => { assert.deepEqual(PF.parseFallbackList(''), []); assert.deepEqual(PF.parseFallbackList(null), []); });
t('malformed JSON → []', () => assert.deepEqual(PF.parseFallbackList('{not json'), []));
t('drops entries with no provider', () => assert.deepEqual(
  PF.parseFallbackList([{ model: 'x' }, { provider: 'GrokAI' }]),
  [{ provider: 'GrokAI', model: null }]));

console.log('isKnownProvider');
t('unknown provider is false', () => assert.equal(PF.isKnownProvider('totally-fake-xyz'), false));
t('empty is false', () => assert.equal(PF.isKnownProvider(''), false));

console.log('buildProviderChain');
t('primary always present, no fallback when disabled', () => {
  const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: false, fallbackProviders: '[{"provider":"GrokAI","model":"grok-4.5"}]' });
  assert.equal(c.length, 1);
  assert.equal(c[0].primary, true);
  assert.equal(c[0].tier, 0);
});
t('caps at MAX_FALLBACKS (3) → chain length 4', () => {
  const many = JSON.stringify([1,2,3,4,5].map(i => ({ provider: `fakeprov${i}`, model: `m${i}` })));
  // fake providers are unknown so they get dropped — expect just the primary
  const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: true, fallbackProviders: many });
  assert.equal(c[0].primary, true);
  assert.ok(c.length <= 1 + PF.MAX_FALLBACKS);
});
t('dedupes primary from fallback list', () => {
  const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: true, fallbackProviders: '[{"provider":"Anthropic","model":"m"}]' });
  assert.equal(c.length, 1);
});

console.log('classifyFailure');
t('auth', () => assert.equal(PF.classifyFailure('401 Unauthorized'), 'auth'));
t('cap (Claude Max)', () => assert.equal(PF.classifyFailure('now draw from your extra usage'), 'cap'));
t('overloaded', () => assert.equal(PF.classifyFailure('Overloaded'), 'overloaded'));
t('network', () => assert.equal(PF.classifyFailure('Connection error.'), 'network'));
t('rate_limit', () => assert.equal(PF.classifyFailure('429 rate limit'), 'rate_limit'));
t('unknown', () => assert.equal(PF.classifyFailure('weird'), 'unknown'));

console.log('shouldFailover / isCancellation');
t('recoveredFromError true → failover', () => assert.equal(PF.shouldFailover({ recoveredFromError: true }), true));
t('success → no failover', () => assert.equal(PF.shouldFailover({ responseMessage: {} }), false));
t('abort is cancellation', () => assert.equal(PF.isCancellation({ name: 'AbortError' }), true));
t('normal error not cancellation', () => assert.equal(PF.isCancellation({ message: '500' }), false));

console.log('runWithFallback');
await (async () => {
  // primary fails, tier1 succeeds
  const chain = [
    { provider: 'A', model: 'a', tier: 0, primary: true },
    { provider: 'B', model: 'b', tier: 1, primary: false },
  ];
  const events = [];
  const { result, tier, attempts } = await PF.runWithFallback({
    chain,
    runOne: async (t) => t.provider === 'A'
      ? { recoveredFromError: true, recoveredError: 'Overloaded' }
      : { responseMessage: { role: 'assistant', content: 'OK' } },
    onFallback: (info) => events.push(info),
  });
  t('rolled to B and succeeded', () => { assert.equal(tier.provider, 'B'); assert.equal(result.responseMessage.content, 'OK'); });
  t('emitted one fallback event A→B', () => { assert.equal(events.length, 1); assert.equal(events[0].from.provider, 'A'); assert.equal(events[0].to.provider, 'B'); assert.equal(events[0].reason, 'overloaded'); });
  t('recorded 2 attempts', () => assert.equal(attempts.length, 2));
})();

await (async () => {
  // all fail → returns last failed result, no throw
  const chain = [ { provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 } ];
  const { result } = await PF.runWithFallback({
    chain,
    runOne: async () => ({ recoveredFromError: true, recoveredError: '500' }),
  });
  t('all-fail returns failed result (last resort card)', () => assert.equal(result.recoveredFromError, true));
})();

await (async () => {
  // cancellation must propagate, never roll over
  const chain = [ { provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 } ];
  let threw = false;
  try {
    await PF.runWithFallback({ chain, runOne: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } });
  } catch (e) { threw = true; }
  t('cancellation propagates (no failover)', () => assert.equal(threw, true));
})();

await (async () => {
  // a thrown non-cancellation error on primary → rolls to tier1
  const chain = [ { provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 } ];
  const { tier } = await PF.runWithFallback({
    chain,
    runOne: async (t) => { if (t.provider === 'A') throw new Error('ECONNRESET boom'); return { responseMessage: { content: 'ok' } }; },
  });
  t('thrown error on primary rolls to B', () => assert.equal(tier.provider, 'B'));
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
