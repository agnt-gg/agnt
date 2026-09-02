import { describe, it, expect, vi } from 'vitest';

/**
 * `resolveProviderKey` gates its result on PROVIDER_CAPABILITIES membership
 * rather than returning whatever `getProviderConfig` resolved.
 *
 * Today that gate is invisible: PROVIDER_CONFIGS and PROVIDER_CAPABILITIES hold
 * exactly the same 20 keys, so anything the config table resolves is already in
 * the capability table. Deleting the gate changes no observable behaviour and
 * every other test still passes — which is precisely why it needs a test of its
 * own rather than a claim in a comment.
 *
 * The gate exists for the day those two tables diverge. A provider present in
 * the config table but absent from the capability table would otherwise be
 * admitted to the chain and then die in the executor: a tier that is silently
 * DEAD instead of silently DROPPED, which is worse, because the chain reports a
 * depth it cannot actually deliver.
 *
 * This file mocks the config table to force that divergence. It lives apart
 * from the main suite because the mock is module-wide.
 */

vi.mock('../ai/providerConfigs.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProviderConfig: (key) => {
      // A provider the CONFIG table knows about but the CAPABILITY table does
      // not — the exact divergence the gate is there to catch.
      if (String(key).toLowerCase() === 'ghost-provider') return { key: 'ghost-provider', name: 'Ghost' };
      return actual.getProviderConfig(key);
    },
  };
});

const PF = (await import('./ProviderFallback.js')).default;
const ProviderRegistry = await import('../ai/ProviderRegistry.js');

describe('resolveProviderKey — capability gate', () => {
  it('the premise holds: the mocked provider is in the config table only', async () => {
    const { getProviderConfig } = await import('../ai/providerConfigs.js');
    expect(getProviderConfig('ghost-provider')).toMatchObject({ key: 'ghost-provider' });
    expect(Object.keys(ProviderRegistry.PROVIDER_CAPABILITIES)).not.toContain('ghost-provider');
  });

  it('refuses a provider the capability registry does not know', () => {
    expect(PF.resolveProviderKey('ghost-provider')).toBeNull();
    expect(PF.isKnownProvider('ghost-provider')).toBe(false);
  });

  it('drops such a tier from the chain rather than shipping a dead one', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'ghost-provider', model: 'x' }],
    });

    expect(chain).toHaveLength(1);
  });

  it('still resolves real providers through the same path', () => {
    expect(PF.resolveProviderKey('Cursor')).toBe('cursor-cli');
  });
});

describe('config and capability tables — divergence tripwire', () => {
  it('currently hold identical key sets', async () => {
    // Not a requirement, an observation — but if it ever stops being true the
    // gate above changes from dead code to load-bearing, and whoever caused the
    // divergence should find out from a test rather than from a dead tier.
    const { getAllProviderKeys } = await vi.importActual('../ai/providerConfigs.js');
    expect([...getAllProviderKeys()].sort()).toEqual(
      [...Object.keys(ProviderRegistry.PROVIDER_CAPABILITIES)].sort()
    );
  });
});
