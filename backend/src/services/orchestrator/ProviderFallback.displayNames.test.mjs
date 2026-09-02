import { describe, it, expect } from 'vitest';
import PF from './ProviderFallback.js';
import * as ProviderRegistry from '../ai/ProviderRegistry.js';

/**
 * A fallback tier stored under a provider's DISPLAY NAME must still be built
 * into the chain.
 *
 * The UI writes a tier as `{ provider: <displayName> }` (FallbackProviders.vue),
 * but `isKnownProvider` matched raw PROVIDER_CAPABILITIES KEYS. For 18 of the 20
 * built-ins the display name lowercases to exactly the key, so nothing looked
 * wrong. For two it did not, and those tiers were silently dropped from every
 * chain ever built:
 *
 *     "Cursor" -> cursor-cli        "Z.AI" -> zai
 *
 * Same failure signature as the custom-provider bug before it: the tier saves,
 * renders as configured, and never fires.
 *
 * These tests run against the REAL registry rather than a stub, so they fail if
 * the mapping breaks for any reason — including someone renaming a display name
 * or dropping a provider from the capability table.
 */

const CUSTOM_ID = '052c419d-1beb-42c9-81b8-f287685af155';

/** Every provider whose display name is NOT simply its key. */
const DISPLAY_NAME_MISMATCHES = [
  ['Cursor', 'cursor-cli'],
  ['Z.AI', 'zai'],
];

describe('resolveProviderKey', () => {
  it.each(DISPLAY_NAME_MISMATCHES)('resolves display name %s to its registry key %s', (display, key) => {
    expect(PF.resolveProviderKey(display)).toBe(key);
  });

  it('passes a canonical key straight through', () => {
    expect(PF.resolveProviderKey('cursor-cli')).toBe('cursor-cli');
    expect(PF.resolveProviderKey('anthropic')).toBe('anthropic');
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(PF.resolveProviderKey('  CURSOR  ')).toBe('cursor-cli');
    expect(PF.resolveProviderKey('z.ai')).toBe('zai');
  });

  it('returns null for a provider the capability registry does not know', () => {
    // Admitting these would swap a silently-DROPPED tier for a silently-DEAD
    // one, which is worse: the chain would claim a depth it cannot deliver.
    expect(PF.resolveProviderKey('totally-fake-xyz')).toBeNull();
    // 'ollama' exists in the provider TEMPLATES table but has no capability
    // entry, so it is not a usable tier.
    expect(PF.resolveProviderKey('ollama')).toBeNull();
    // 'Local' is offered by the frontend but has no capability entry either.
    // Documented here so a future capability addition trips this test rather
    // than passing unnoticed.
    expect(PF.resolveProviderKey('Local')).toBeNull();
  });

  it('returns null for a custom-provider UUID (it has no registry key)', () => {
    expect(PF.resolveProviderKey(CUSTOM_ID)).toBeNull();
  });

  it('returns null for empty and non-string input instead of throwing', () => {
    expect(PF.resolveProviderKey('')).toBeNull();
    expect(PF.resolveProviderKey('   ')).toBeNull();
    expect(PF.resolveProviderKey(null)).toBeNull();
    expect(PF.resolveProviderKey(undefined)).toBeNull();
    expect(PF.resolveProviderKey(42)).toBeNull();
    expect(PF.resolveProviderKey({})).toBeNull();
  });
});

describe('isKnownProvider — display names', () => {
  it.each(DISPLAY_NAME_MISMATCHES)('accepts %s', (display) => {
    expect(PF.isKnownProvider(display)).toBe(true);
  });

  it('still rejects genuinely unknown providers', () => {
    expect(PF.isKnownProvider('totally-fake-xyz')).toBe(false);
    expect(PF.isKnownProvider('')).toBe(false);
  });

  it('still accepts a custom provider id when the ids are supplied', () => {
    expect(PF.isKnownProvider(CUSTOM_ID, [CUSTOM_ID])).toBe(true);
    expect(PF.isKnownProvider(CUSTOM_ID)).toBe(false);
  });
});

describe('buildProviderChain — display-name tiers', () => {
  it('keeps a Cursor tier instead of silently dropping it', () => {
    const chain = PF.buildProviderChain({
      provider: 'claude-code',
      model: 'claude-opus-5',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'Cursor', model: 'cursor-grok-4.6-medium-fast' }],
    });

    expect(chain).toHaveLength(2);
    expect(chain[1]).toMatchObject({ tier: 1, primary: false });
  });

  it('normalizes the tier to its canonical key so the executor can look it up', () => {
    // The executor does getTextModels(String(tier.provider).toLowerCase()) to
    // resolve a default model, and createLlmClient(key) to build the client.
    // Leaving "Cursor" here would produce a tier that survives the chain and
    // then fails to resolve anything.
    const chain = PF.buildProviderChain({
      provider: 'claude-code',
      model: 'claude-opus-5',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'Cursor', model: null }],
    });

    expect(chain[1].provider).toBe('cursor-cli');
    expect(ProviderRegistry.getTextModels(chain[1].provider.toLowerCase()).length).toBeGreaterThan(0);
  });

  it('PRESERVES a user-configured model rather than snapping it to the static list', () => {
    // The regression this guards against is a fix that overreaches: resolving
    // the key for the MODEL lookup too would make resolveTierModel "recognise"
    // cursor-cli and replace a live, user-chosen model with the first hardcoded
    // one — silently rewriting the user's configuration.
    const configured = 'cursor-grok-4.6-medium-fast';
    const staticList = ProviderRegistry.getTextModels('cursor-cli') || [];

    const chain = PF.buildProviderChain({
      provider: 'claude-code',
      model: 'claude-opus-5',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'Cursor', model: configured }],
    });

    expect(chain[1].model).toBe(configured);
    // Guard the guard: if the model ever joins the static list this test still
    // passes, but it would stop proving anything, so assert the premise.
    expect(staticList).not.toContain(configured);
  });

  it('keeps a Z.AI tier and normalizes it too', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'Z.AI', model: 'glm-4.7' }],
    });

    expect(chain[1]).toMatchObject({ provider: 'zai', model: 'glm-4.7', tier: 1 });
  });

  it('leaves the PRIMARY tier exactly as the caller passed it', () => {
    // The orchestrator already resolved and lowercased the primary and uses
    // that same string for the tier-0 client; rewriting it here would be an
    // unrelated behaviour change.
    const chain = PF.buildProviderChain({
      provider: 'Cursor',
      model: 'some-model',
      fallbackEnabled: true,
      fallbackProviders: [],
    });

    expect(chain[0].provider).toBe('Cursor');
    expect(chain[0]).toMatchObject({ tier: 0, primary: true });
  });
});

describe('buildProviderChain — identity is canonical, not textual', () => {
  // Both directions matter, and only the asymmetric pairs actually discriminate:
  // for primary "cursor" vs tier "Cursor" a naive lowercase compare gets the
  // right answer by accident, so a test using only that pair would pass against
  // a textual comparison and prove nothing.
  it.each([
    ['cursor', 'Cursor'], // both lowercase to the same string — the easy case
    ['cursor-cli', 'Cursor'], // canonical primary vs display-name tier
    ['cursor', 'cursor-cli'], // display-name primary vs canonical tier
    ['Cursor', 'cursor-cli'],
  ])('does not fail %s over to %s — they are the same provider', (primary, tierProvider) => {
    const chain = PF.buildProviderChain({
      provider: primary,
      model: 'cursor-grok-4.5-high',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: tierProvider, model: 'composer-2.5' }],
    });

    expect(chain).toHaveLength(1);
    expect(chain[0].primary).toBe(true);
  });

  it('deduplicates two spellings of the same provider+model', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [
        { provider: 'Cursor', model: 'composer-2.5' },
        { provider: 'cursor-cli', model: 'composer-2.5' },
      ],
    });

    expect(chain).toHaveLength(2);
    expect(chain[1].provider).toBe('cursor-cli');
  });

  it('still allows the same provider at a DIFFERENT model', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [
        { provider: 'Cursor', model: 'composer-2.5' },
        { provider: 'cursor-cli', model: 'auto' },
      ],
    });

    expect(chain).toHaveLength(3);
    expect(chain.slice(1).map((t) => t.model)).toEqual(['composer-2.5', 'auto']);
  });
});

describe('buildProviderChain — nothing else regressed', () => {
  it('still drops a genuinely unknown provider', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'totally-fake-xyz', model: 'x' }],
    });
    expect(chain).toHaveLength(1);
  });

  it('still passes a custom-provider UUID through untouched', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: 'deepseek-v4-flash-0731' }],
      customProviderIds: [CUSTOM_ID],
    });

    expect(chain).toHaveLength(2);
    // NOT lowercased, NOT rewritten — the UUID is the provider identity.
    expect(chain[1].provider).toBe(CUSTOM_ID);
  });

  it('still drops a custom tier that has no model', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: null }],
      customProviderIds: [CUSTOM_ID],
    });
    expect(chain).toHaveLength(1);
  });

  it('still drops custom tiers when the ids are not supplied', () => {
    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: CUSTOM_ID, model: 'x' }],
    });
    expect(chain).toHaveLength(1);
  });

  it('still honours fallbackEnabled=false and the MAX_FALLBACKS cap', () => {
    expect(
      PF.buildProviderChain({
        provider: 'anthropic',
        model: 'm',
        fallbackEnabled: false,
        fallbackProviders: [{ provider: 'Cursor', model: 'auto' }],
      })
    ).toHaveLength(1);

    const many = Array.from({ length: 8 }, (_, i) => ({ provider: 'Cursor', model: `m${i}` }));
    const capped = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: many,
    });
    expect(capped.length - 1).toBe(PF.MAX_FALLBACKS);
  });
});

describe('buildProviderChain — a real four-tier configuration', () => {
  it('builds all three configured tiers, Cursor included', () => {
    // Shape taken verbatim from a users.fallback_providers row in the field:
    // a CLI primary, two CLI fallbacks, and a custom provider last.
    const chain = PF.buildProviderChain({
      provider: 'claude-code',
      model: 'claude-opus-5',
      fallbackEnabled: true,
      fallbackProviders: [
        { provider: 'Cursor', model: 'cursor-grok-4.6-medium-fast' },
        { provider: 'Grok-Build', model: 'grok-4.6' },
        { provider: CUSTOM_ID, model: 'deepseek-v4-flash-0731' },
      ],
      customProviderIds: [CUSTOM_ID],
    });

    // The contract this fix owns is WHICH providers survive, and in what order.
    expect(chain.map((t) => t.provider)).toEqual([
      'claude-code',
      'cursor-cli',
      'grok-build',
      CUSTOM_ID,
    ]);

    // Models that the fix is responsible for, asserted exactly.
    expect(chain[1].model).toBe('cursor-grok-4.6-medium-fast');
    expect(chain[3].model).toBe('deepseek-v4-flash-0731');

    // grok-build's model is NOT pinned to a literal. Its display name already
    // equals its registry key, so it reaches resolveTierModel's pre-existing
    // snap-to-first-static-model branch, and the static list moves: it held
    // ['grok-4.5','grok-4.6'] when this test was written and holds ['grok-4.5']
    // now, which would rot a hardcoded string on the next catalogue edit.
    const grokStatic = ProviderRegistry.getTextModels('grok-build') || [];
    expect(chain[2].model).toBe(
      grokStatic.includes('grok-4.6') ? 'grok-4.6' : grokStatic[0]
    );
  });

  it('trusts a configured model only where the static list cannot vouch for it', () => {
    // An asymmetry worth stating out loud, because it looks arbitrary until you
    // see which way each branch fails.
    //
    // "Cursor" does not lowercase to its registry key, so getTextModels returns
    // [] for it and resolveTierModel takes its trust-the-caller branch: the
    // user's model survives verbatim. "Grok-Build" DOES lowercase to its key,
    // finds a non-empty static list, and snaps an unrecognised model to the
    // first entry.
    //
    // That snapping is pre-existing behaviour on the primary path and is left
    // exactly as it was — this fix deliberately does not widen its blast radius
    // by feeding the canonical key into the model lookup as well. Doing so
    // would silently rewrite a live, UI-chosen Cursor model to a stale
    // hardcoded one.
    const cursorStatic = ProviderRegistry.getTextModels('Cursor') || [];
    expect(cursorStatic).toEqual([]);

    const chain = PF.buildProviderChain({
      provider: 'anthropic',
      model: 'm',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'Cursor', model: 'a-model-no-static-list-knows' }],
    });

    expect(chain[1]).toMatchObject({
      provider: 'cursor-cli',
      model: 'a-model-no-static-list-knows',
    });
  });

  it('every built-in tier it produces is resolvable by the executor', () => {
    const chain = PF.buildProviderChain({
      provider: 'claude-code',
      model: 'claude-opus-5',
      fallbackEnabled: true,
      fallbackProviders: [
        { provider: 'Cursor', model: 'cursor-grok-4.6-medium-fast' },
        { provider: 'Grok-Build', model: 'grok-4.6' },
      ],
    });

    for (const tier of chain) {
      const key = String(tier.provider).toLowerCase();
      expect(Object.keys(ProviderRegistry.PROVIDER_CAPABILITIES)).toContain(key);
    }
  });
});
