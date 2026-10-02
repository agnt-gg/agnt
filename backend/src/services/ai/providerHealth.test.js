import { describe, it, expect } from 'vitest';
import { createProviderHealth, COOLDOWN_POLICY } from './providerHealth.js';
import { PROVIDER_WIDE_FAILURES } from '../orchestrator/ProviderFallback.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('providerHealth — circuit per (user, provider)', () => {
  it('starts healthy', () => {
    const h = createProviderHealth();
    expect(h.status('u', 'groq')).toEqual({ state: 'healthy' });
    expect(h.isAvailable('u', 'groq')).toBe(true);
  });

  it('a provider-wide failure opens the circuit for the policy cooldown', () => {
    const c = clock();
    const h = createProviderHealth({ now: c.now });
    h.recordFailure('u', 'groq', 'overloaded');
    expect(h.isAvailable('u', 'groq')).toBe(false);
    c.advance(COOLDOWN_POLICY.overloaded.baseMs - 1);
    expect(h.status('u', 'groq').state).toBe('cooling');
    c.advance(1);
    expect(h.status('u', 'groq').state).toBe('trial');
    expect(h.isAvailable('u', 'groq')).toBe(true);
  });

  it('a failed trial backs off exponentially, capped at the policy max', () => {
    const c = clock();
    const h = createProviderHealth({ now: c.now });
    const { baseMs, maxMs } = COOLDOWN_POLICY.rate_limit;
    const cooldowns = [];
    for (let i = 0; i < 8; i++) {
      const entry = h.recordFailure('u', 'groq', 'rate_limit');
      cooldowns.push(entry.openUntil - c.now());
    }
    expect(cooldowns[0]).toBe(baseMs);
    expect(cooldowns[1]).toBe(baseMs * 2);
    expect(Math.max(...cooldowns)).toBe(maxMs);
  });

  it('one success closes the circuit and resets the backoff', () => {
    const c = clock();
    const h = createProviderHealth({ now: c.now });
    h.recordFailure('u', 'groq', 'network');
    h.recordFailure('u', 'groq', 'network');
    h.recordSuccess('u', 'groq');
    expect(h.status('u', 'groq')).toEqual({ state: 'healthy' });
    expect(h.recordFailure('u', 'groq', 'network').openUntil - c.now()).toBe(COOLDOWN_POLICY.network.baseMs);
  });

  it('model-specific and validation failures say nothing about the provider', () => {
    const h = createProviderHealth();
    expect(h.recordFailure('u', 'groq', 'unknown')).toBeNull();
    expect(h.recordFailure('u', 'groq', 'invalid_output')).toBeNull();
    expect(h.isAvailable('u', 'groq')).toBe(true);
  });

  it('is scoped per user — one account\'s dead key does not cool another\'s', () => {
    const h = createProviderHealth();
    h.recordFailure('alice', 'anthropic', 'auth');
    expect(h.isAvailable('alice', 'anthropic')).toBe(false);
    expect(h.isAvailable('bob', 'anthropic')).toBe(true);
  });

  it('provider keys are case-insensitive', () => {
    const h = createProviderHealth();
    h.recordFailure('u', 'Anthropic', 'cap');
    expect(h.isAvailable('u', 'anthropic')).toBe(false);
  });

  it('is bounded — the oldest entry is evicted past maxTracked', () => {
    const h = createProviderHealth({ maxTracked: 3 });
    for (const p of ['a', 'b', 'c', 'd']) h.recordFailure('u', p, 'auth');
    expect(h.snapshot()).toHaveLength(3);
    expect(h.isAvailable('u', 'a')).toBe(true);
    expect(h.isAvailable('u', 'd')).toBe(false);
  });

  it('forUser binds the user for runWithFallback', () => {
    const h = createProviderHealth();
    const view = h.forUser('u');
    view.recordFailure('groq', 'auth');
    expect(h.isAvailable('u', 'groq')).toBe(false);
    view.recordSuccess('groq');
    expect(view.isAvailable('groq')).toBe(true);
  });
});

describe('the two lists of provider-wide failures cannot drift', () => {
  it('every reason that skips a provider at run time also cools it', () => {
    expect([...PROVIDER_WIDE_FAILURES].sort()).toEqual(Object.keys(COOLDOWN_POLICY).sort());
  });
});
