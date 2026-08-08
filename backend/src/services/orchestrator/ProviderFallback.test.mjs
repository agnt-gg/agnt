import { describe, it, expect } from 'vitest';
import PF from './ProviderFallback.js';

describe('ProviderFallback.parseFallbackList', () => {
  it('parses a JSON string', () => {
    expect(PF.parseFallbackList('[{"provider":"GrokAI","model":"grok-4.5"}]'))
      .toEqual([{ provider: 'GrokAI', model: 'grok-4.5' }]);
  });
  it('returns [] for empty/blank/null', () => {
    expect(PF.parseFallbackList('')).toEqual([]);
    expect(PF.parseFallbackList(null)).toEqual([]);
  });
  it('returns [] for malformed JSON', () => {
    expect(PF.parseFallbackList('{not json')).toEqual([]);
  });
  it('drops entries with no provider', () => {
    expect(PF.parseFallbackList([{ model: 'x' }, { provider: 'GrokAI' }]))
      .toEqual([{ provider: 'GrokAI', model: null }]);
  });
});

describe('ProviderFallback.isKnownProvider', () => {
  it('unknown provider is false', () => {
    expect(PF.isKnownProvider('totally-fake-xyz')).toBe(false);
  });
  it('empty is false', () => {
    expect(PF.isKnownProvider('')).toBe(false);
  });
});

describe('ProviderFallback.buildProviderChain', () => {
  it('primary always present, no fallback when disabled', () => {
    const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: false, fallbackProviders: '[{"provider":"GrokAI","model":"grok-4.5"}]' });
    expect(c.length).toBe(1);
    expect(c[0].primary).toBe(true);
    expect(c[0].tier).toBe(0);
  });
  it('caps at MAX_FALLBACKS (chain length <= 4)', () => {
    const many = JSON.stringify([1, 2, 3, 4, 5].map((i) => ({ provider: `fakeprov${i}`, model: `m${i}` })));
    const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: true, fallbackProviders: many });
    expect(c[0].primary).toBe(true);
    expect(c.length).toBeLessThanOrEqual(1 + PF.MAX_FALLBACKS);
  });
  it('dedupes the primary from the fallback list', () => {
    const c = PF.buildProviderChain({ provider: 'Anthropic', model: 'm', fallbackEnabled: true, fallbackProviders: '[{"provider":"Anthropic","model":"m"}]' });
    expect(c.length).toBe(1);
  });
});

describe('ProviderFallback.classifyFailure', () => {
  it('auth', () => expect(PF.classifyFailure('401 Unauthorized')).toBe('auth'));
  it('cap (Claude Max)', () => expect(PF.classifyFailure('now draw from your extra usage')).toBe('cap'));
  it('overloaded', () => expect(PF.classifyFailure('Overloaded')).toBe('overloaded'));
  it('network', () => expect(PF.classifyFailure('Connection error.')).toBe('network'));
  it('rate_limit', () => expect(PF.classifyFailure('429 rate limit')).toBe('rate_limit'));
  it('unknown', () => expect(PF.classifyFailure('weird')).toBe('unknown'));
});

describe('ProviderFallback.shouldFailover / isCancellation', () => {
  it('recoveredFromError true → failover', () => expect(PF.shouldFailover({ recoveredFromError: true })).toBe(true));
  it('success → no failover', () => expect(PF.shouldFailover({ responseMessage: {} })).toBe(false));
  it('abort is cancellation', () => expect(PF.isCancellation({ name: 'AbortError' })).toBe(true));
  it('normal error is not cancellation', () => expect(PF.isCancellation({ message: '500' })).toBe(false));
});

describe('ProviderFallback.runWithFallback', () => {
  it('primary fails, rolls to tier 1 and succeeds', async () => {
    const chain = [
      { provider: 'A', model: 'a', tier: 0, primary: true },
      { provider: 'B', model: 'b', tier: 1, primary: false },
    ];
    const events = [];
    const { result, tier, attempts } = await PF.runWithFallback({
      chain,
      runOne: async (t) => (t.provider === 'A'
        ? { recoveredFromError: true, recoveredError: 'Overloaded' }
        : { responseMessage: { role: 'assistant', content: 'OK' } }),
      onFallback: (info) => events.push(info),
    });
    expect(tier.provider).toBe('B');
    expect(result.responseMessage.content).toBe('OK');
    expect(events.length).toBe(1);
    expect(events[0].from.provider).toBe('A');
    expect(events[0].to.provider).toBe('B');
    expect(events[0].reason).toBe('overloaded');
    expect(attempts.length).toBe(2);
  });

  it('all tiers fail → returns last failed result (no throw)', async () => {
    const chain = [{ provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 }];
    const { result } = await PF.runWithFallback({
      chain,
      runOne: async () => ({ recoveredFromError: true, recoveredError: '500' }),
    });
    expect(result.recoveredFromError).toBe(true);
  });

  it('cancellation propagates (never fails over)', async () => {
    const chain = [{ provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 }];
    await expect(PF.runWithFallback({
      chain,
      runOne: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
    })).rejects.toThrow();
  });

  it('a thrown non-cancellation error on primary rolls to tier 1', async () => {
    const chain = [{ provider: 'A', tier: 0, primary: true }, { provider: 'B', tier: 1 }];
    const { tier } = await PF.runWithFallback({
      chain,
      runOne: async (t) => { if (t.provider === 'A') throw new Error('ECONNRESET boom'); return { responseMessage: { content: 'ok' } }; },
    });
    expect(tier.provider).toBe('B');
  });
});

/**
 * Custom OpenAI-compatible providers as failover tiers.
 *
 * Custom providers are keyed by UUID and are NOT in ProviderRegistry, so
 * isKnownProvider() rejected them and buildProviderChain() silently dropped the
 * tier — a chain configured via the API appeared saved but never fired.
 *
 * The registry lookup cannot be made async (buildProviderChain is sync and
 * called on every turn), so callers pass the user's active custom-provider IDs
 * in explicitly. Omitting the argument keeps the old behavior exactly.
 */
const CUSTOM_ID = '2d6a62f5-b7e9-4cfe-92cc-d4bede6e9202';
const OTHER_CUSTOM_ID = '052c419d-1beb-42c9-81b8-f287685af155';

describe('ProviderFallback.isKnownProvider — custom providers', () => {
  it('accepts a custom provider id that is in the supplied list', () => {
    expect(PF.isKnownProvider(CUSTOM_ID, [CUSTOM_ID])).toBe(true);
  });
  it('rejects a custom provider id that is NOT in the supplied list', () => {
    expect(PF.isKnownProvider(CUSTOM_ID, [OTHER_CUSTOM_ID])).toBe(false);
  });
  it('rejects a custom provider id when no list is supplied (unchanged default)', () => {
    expect(PF.isKnownProvider(CUSTOM_ID)).toBe(false);
  });
  it('accepts a Set as well as an Array', () => {
    expect(PF.isKnownProvider(CUSTOM_ID, new Set([CUSTOM_ID]))).toBe(true);
  });
  it('matches custom ids case-insensitively', () => {
    expect(PF.isKnownProvider(CUSTOM_ID.toUpperCase(), [CUSTOM_ID])).toBe(true);
  });
  it('still accepts built-in providers when a custom list is supplied', () => {
    expect(PF.isKnownProvider('openai', [CUSTOM_ID])).toBe(true);
  });
});

describe('ProviderFallback.buildProviderChain — custom providers', () => {
  it('includes a custom provider tier when its id is supplied', () => {
    const c = PF.buildProviderChain({
      provider: 'Anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: 'ling-mini' }],
      customProviderIds: [CUSTOM_ID],
    });
    expect(c.length).toBe(2);
    expect(c[1].provider).toBe(CUSTOM_ID);
    expect(c[1].tier).toBe(1);
    expect(c[1].primary).toBe(false);
  });

  it('drops the custom tier when no ids are supplied (documents the old bug)', () => {
    const c = PF.buildProviderChain({
      provider: 'Anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: 'ling-mini' }],
    });
    expect(c.length).toBe(1);
  });

  it('keeps the configured model verbatim (custom providers have no static model list)', () => {
    const c = PF.buildProviderChain({
      provider: 'Anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: 'some-local-model:7b' }],
      customProviderIds: [CUSTOM_ID],
    });
    expect(c[1].model).toBe('some-local-model:7b');
  });

  it('drops a custom tier with no model — there is no list to pick a default from', () => {
    const c = PF.buildProviderChain({
      provider: 'Anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: null }],
      customProviderIds: [CUSTOM_ID],
    });
    expect(c.length).toBe(1);
  });

  it('never fails over from a custom primary to the same custom provider', () => {
    const c = PF.buildProviderChain({
      provider: CUSTOM_ID,
      model: 'ling-mini',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: 'ling-large' }],
      customProviderIds: [CUSTOM_ID],
    });
    expect(c.length).toBe(1);
  });

  it('supports a custom primary failing over to a built-in provider', () => {
    const c = PF.buildProviderChain({
      provider: CUSTOM_ID,
      model: 'ling-mini',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'openai', model: 'gpt-4o' }],
      customProviderIds: [CUSTOM_ID],
    });
    expect(c.length).toBe(2);
    expect(c[0].provider).toBe(CUSTOM_ID);
    expect(c[1].provider).toBe('openai');
  });

  it('preserves configured order across mixed custom and built-in tiers', () => {
    const c = PF.buildProviderChain({
      provider: 'Anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [
        { provider: CUSTOM_ID, model: 'ling-mini' },
        { provider: 'openai', model: 'gpt-4o' },
        { provider: OTHER_CUSTOM_ID, model: 'deepseek-chat' },
      ],
      customProviderIds: [CUSTOM_ID, OTHER_CUSTOM_ID],
    });
    expect(c.map((t) => t.provider)).toEqual(['Anthropic', CUSTOM_ID, 'openai', OTHER_CUSTOM_ID]);
    expect(c.map((t) => t.tier)).toEqual([0, 1, 2, 3]);
  });

  it('still drops a genuinely unknown provider even when custom ids are supplied', () => {
    const c = PF.buildProviderChain({
      provider: 'Anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'totally-fake-xyz', model: 'x' }],
      customProviderIds: [CUSTOM_ID],
    });
    expect(c.length).toBe(1);
  });
});

/**
 * Resolving the custom-provider ids without paying for them.
 *
 * The ids come from a SQLite query, and both turn paths need them at TWO call
 * sites (the agent chain and the user chain). Resolving eagerly costs a query
 * on EVERY turn -- including the overwhelmingly common case where failover is
 * switched off entirely and no chain is ever built. Resolving at each call site
 * instead would double the query when both paths are considered.
 *
 * So: lazy AND memoized. The fetch is injected rather than imported so this
 * module keeps its "no dependencies beyond ProviderRegistry" property and
 * stays trivially unit-testable.
 */
describe('ProviderFallback.createCustomProviderIdResolver', () => {
  it('does not touch the database until it is actually called', async () => {
    let calls = 0;
    PF.createCustomProviderIdResolver(async () => { calls += 1; return []; });
    // Merely creating the resolver must not query -- that is the entire point
    // when failover is disabled and no chain is built.
    expect(calls).toBe(0);
  });

  it('queries once when invoked', async () => {
    let calls = 0;
    const resolve = PF.createCustomProviderIdResolver(async () => {
      calls += 1;
      return [{ id: CUSTOM_ID }];
    });
    await expect(resolve()).resolves.toEqual([CUSTOM_ID]);
    expect(calls).toBe(1);
  });

  it('memoizes across call sites — two chains cost one query', async () => {
    let calls = 0;
    const resolve = PF.createCustomProviderIdResolver(async () => {
      calls += 1;
      return [{ id: CUSTOM_ID }, { id: OTHER_CUSTOM_ID }];
    });
    const first = await resolve();
    const second = await resolve();
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it('maps rows to bare ids', async () => {
    const resolve = PF.createCustomProviderIdResolver(async () => [
      { id: CUSTOM_ID, provider_name: 'spark-ling', base_url: 'http://x/v1' },
    ]);
    await expect(resolve()).resolves.toEqual([CUSTOM_ID]);
  });

  it('fails safe to [] when the lookup throws', async () => {
    // A custom-provider lookup failure must cost the custom tiers, never the
    // turn. buildProviderChain treats [] as "no custom providers", which is
    // exactly the pre-feature behaviour.
    const resolve = PF.createCustomProviderIdResolver(async () => {
      throw new Error('SQLITE_BUSY');
    });
    await expect(resolve()).resolves.toEqual([]);
  });

  it('does not retry a failed lookup on the second call site', async () => {
    let calls = 0;
    const resolve = PF.createCustomProviderIdResolver(async () => {
      calls += 1;
      throw new Error('SQLITE_BUSY');
    });
    await resolve();
    await resolve();
    expect(calls).toBe(1);
  });

  it('reports the failure to the caller-supplied handler', async () => {
    const seen = [];
    const resolve = PF.createCustomProviderIdResolver(
      async () => { throw new Error('SQLITE_BUSY'); },
      (err) => seen.push(err.message),
    );
    await resolve();
    expect(seen).toEqual(['SQLITE_BUSY']);
  });

  it('tolerates a null result from the fetcher', async () => {
    const resolve = PF.createCustomProviderIdResolver(async () => null);
    await expect(resolve()).resolves.toEqual([]);
  });

  it('caches an empty result too, so a user with no custom providers pays once', async () => {
    let calls = 0;
    const resolve = PF.createCustomProviderIdResolver(async () => { calls += 1; return []; });
    await resolve();
    await resolve();
    expect(calls).toBe(1);
  });
});
