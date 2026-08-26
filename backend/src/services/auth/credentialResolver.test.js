import { describe, it, expect, vi } from 'vitest';
import { TIER, resolveFirst, readEnvToken, describeSource } from './credentialResolver.js';

const candidate = (tier, token, extra = {}) => ({
  tier,
  source: `${tier}-src`,
  read: () => (token === null ? null : { token, ...extra }),
});

describe('cascade order', () => {
  it('returns the first tier that yields a token', () => {
    const resolved = resolveFirst([
      candidate(TIER.AGNT_STORE, 'from-store'),
      candidate(TIER.VENDOR_FILE, 'from-file'),
    ]);
    expect(resolved.token).toBe('from-store');
    expect(resolved.tier).toBe(TIER.AGNT_STORE);
  });

  it('falls through empty tiers', () => {
    const resolved = resolveFirst([
      candidate(TIER.AGNT_STORE, null),
      candidate(TIER.VENDOR_FILE, null),
      candidate(TIER.SECRET_STORE, 'from-keychain'),
    ]);
    expect(resolved.token).toBe('from-keychain');
  });

  it('does not evaluate lower tiers once one wins — discovery must not cost spawns it does not need', () => {
    const never = vi.fn(() => ({ token: 'unused' }));
    resolveFirst([
      candidate(TIER.AGNT_STORE, 'winner'),
      { tier: TIER.SECRET_STORE, source: 's', read: never },
    ]);
    expect(never).not.toHaveBeenCalled();
  });

  it('returns null when every tier is empty', () => {
    expect(resolveFirst([candidate(TIER.AGNT_STORE, null)])).toBeNull();
    expect(resolveFirst([])).toBeNull();
    expect(resolveFirst(null)).toBeNull();
  });
});

describe('a flaky tier must not take down the cascade', () => {
  it('skips a throwing tier and keeps going', () => {
    const resolved = resolveFirst([
      { tier: TIER.AGNT_STORE, source: 'a', read: () => { throw new Error('EACCES'); } },
      candidate(TIER.VENDOR_FILE, 'survived'),
    ]);
    expect(resolved.token).toBe('survived');
  });

  it('skips malformed candidates', () => {
    const resolved = resolveFirst([null, {}, { tier: 'x' }, candidate(TIER.VENDOR_FILE, 'ok')]);
    expect(resolved.token).toBe('ok');
  });

  it('treats a whitespace-only token as absent', () => {
    const resolved = resolveFirst([candidate(TIER.AGNT_STORE, '   '), candidate(TIER.VENDOR_FILE, 'real')]);
    expect(resolved.token).toBe('real');
  });

  it('trims the winning token', () => {
    expect(resolveFirst([candidate(TIER.AGNT_STORE, '  padded  ')]).token).toBe('padded');
  });

  it('accepts a bare string from read()', () => {
    const resolved = resolveFirst([{ tier: TIER.ENV, source: 'env', read: () => 'plain' }]);
    expect(resolved.token).toBe('plain');
  });
});

describe('ownership defaults — the property that gates refresh and delete', () => {
  it('agnt-store and env are owned', () => {
    expect(resolveFirst([candidate(TIER.AGNT_STORE, 't')]).ownedByAgnt).toBe(true);
    expect(resolveFirst([candidate(TIER.ENV, 't')]).ownedByAgnt).toBe(true);
  });

  it('vendor-file, secret-store and cli-probe are NOT owned by default', () => {
    expect(resolveFirst([candidate(TIER.VENDOR_FILE, 't')]).ownedByAgnt).toBe(false);
    expect(resolveFirst([candidate(TIER.SECRET_STORE, 't')]).ownedByAgnt).toBe(false);
    expect(resolveFirst([candidate(TIER.CLI_PROBE, 't')]).ownedByAgnt).toBe(false);
  });

  it('a read() result may override ownership — Claude needs this for its legacy file', () => {
    const resolved = resolveFirst([
      { tier: TIER.VENDOR_FILE, source: 'f', read: () => ({ token: 't', ownedByAgnt: true }) },
    ]);
    expect(resolved.ownedByAgnt).toBe(true);
  });

  it('a candidate-level override also wins', () => {
    const resolved = resolveFirst([
      { tier: TIER.AGNT_STORE, source: 'a', ownedByAgnt: false, read: () => ({ token: 't' }) },
    ]);
    expect(resolved.ownedByAgnt).toBe(false);
  });

  it('carries extra metadata through untouched', () => {
    const resolved = resolveFirst([candidate(TIER.VENDOR_FILE, 't', { credPath: '/x', oauth: { a: 1 } })]);
    expect(resolved.credPath).toBe('/x');
    expect(resolved.oauth).toEqual({ a: 1 });
  });
});

describe('readEnvToken', () => {
  it('returns the first non-empty variable and names it', () => {
    const found = readEnvToken(['A', 'B'], { A: '', B: 'value-b' });
    expect(found).toEqual({ token: 'value-b', envKey: 'B' });
  });

  it('ignores whitespace-only values', () => {
    expect(readEnvToken(['A'], { A: '   ' })).toBeNull();
  });

  it('returns null for no match or bad input', () => {
    expect(readEnvToken(['A'], {})).toBeNull();
    expect(readEnvToken(null, {})).toBeNull();
  });
});

describe('describeSource — what the UI shows', () => {
  it('distinguishes an in-app connect from a discovered CLI session', () => {
    expect(describeSource({ tier: TIER.AGNT_STORE })).toBe('connected in AGNT');
    expect(describeSource({ tier: TIER.SECRET_STORE })).toBe('CLI session in OS keychain');
    expect(describeSource({ tier: TIER.VENDOR_FILE, ownedByAgnt: false })).toBe('CLI credentials file');
    expect(describeSource({ tier: TIER.VENDOR_FILE, ownedByAgnt: true })).toBe('AGNT credentials file');
    expect(describeSource({ tier: TIER.CLI_PROBE })).toBe('CLI reports signed in');
  });

  it('names the winning environment variable', () => {
    expect(describeSource({ tier: TIER.ENV, envKey: 'XAI_API_KEY' })).toBe('environment (XAI_API_KEY)');
  });

  it('handles null and unknown tiers', () => {
    expect(describeSource(null)).toBe('not connected');
    expect(describeSource({ tier: 'weird', source: 'custom' })).toBe('custom');
  });
});
