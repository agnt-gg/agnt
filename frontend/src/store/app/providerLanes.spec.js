import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LANE_PREVIEW_COUNT,
  PROVIDER_LANE_SIBLING,
  SUBSCRIPTION_PROVIDER_IDS,
  isSubscriptionProvider,
  providerLanes,
} from './aiProvider.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_PROVIDER_CONFIGS = path.resolve(
  HERE,
  '../../../../backend/src/services/ai/providerConfigs.js',
);

const ai = (id, extra = {}) => ({ id, name: id, icon: id, categories: ['AI'], ...extra });

describe('SUBSCRIPTION_PROVIDER_IDS mirrors the backend', () => {
  /**
   * The lane a provider lands in decides whether we tell a user their usage is
   * free or that they are about to be billed per token. Getting that wrong is
   * worse than showing nothing, so the frontend copy is pinned to the backend
   * set rather than maintained by hand on both sides.
   *
   * Parsed out of the source text because the backend is CommonJS-adjacent ESM
   * that pulls in a large config graph; the declaration is what we care about.
   */
  const backendIds = () => {
    const source = fs.readFileSync(BACKEND_PROVIDER_CONFIGS, 'utf8');
    const match = source.match(/export const SUBSCRIPTION_PROVIDERS = new Set\(\[([\s\S]*?)\]\)/);
    if (!match) throw new Error('SUBSCRIPTION_PROVIDERS declaration not found in providerConfigs.js');
    return new Set(match[1].match(/'([^']+)'/g).map((quoted) => quoted.slice(1, -1)));
  };

  it('is exactly the backend set — no drift in either direction', () => {
    expect([...SUBSCRIPTION_PROVIDER_IDS].sort()).toEqual([...backendIds()].sort());
  });

  it('reads a non-empty set, so the comparison above cannot pass vacuously', () => {
    expect(backendIds().size).toBeGreaterThan(3);
  });

  it('includes kimi-code, which has no local auth manager but is still a seat', () => {
    // The bug this whole split replaces: kimi-code was absent from the
    // frontend's CLI list, so it would have been sold as metered.
    expect(isSubscriptionProvider('kimi-code')).toBe(true);
  });
});

describe('providerLanes', () => {
  const PROVIDERS = [
    ai('openai', { connectionType: 'apikey' }),
    ai('openai-codex', { name: 'OpenAI Codex', connectionType: 'oauth' }),
    ai('anthropic', { connectionType: 'apikey' }),
    ai('claude-code', { connectionType: 'oauth' }),
    ai('cerebras', { connectionType: 'apikey' }),
    ai('local', { connectionType: 'apikey' }),
  ];

  const idsIn = (lane) => lane.map((p) => p.id);

  it('splits by who bills you, not by how you authenticate', () => {
    const lanes = providerLanes(PROVIDERS);
    expect(idsIn(lanes.subscription).sort()).toEqual(['claude-code', 'openai-codex']);
    expect(idsIn(lanes.api).sort()).toEqual(['anthropic', 'cerebras', 'openai']);
  });

  it('keeps local out of both billing lanes', () => {
    const lanes = providerLanes(PROVIDERS);
    expect(idsIn(lanes.local)).toEqual(['local']);
    expect(idsIn(lanes.subscription)).not.toContain('local');
    expect(idsIn(lanes.api)).not.toContain('local');
  });

  describe('running a model on this machine is always offered', () => {
    /**
     * Local is a runtime on the user's disk, not an account, so it has no row
     * in the remote provider catalog — and the catalog is where every other
     * entry on this screen comes from. Deriving the offer from it deleted the
     * option entirely: the one choice that needs no network was the first to
     * disappear without one.
     */
    it('appears even though the real catalog has no local record', () => {
      // Verbatim shape of the live catalog's AI subset: no `local`.
      const real = [
        ai('openai'), ai('anthropic'), ai('gemini'), ai('groq'),
        ai('openai-codex'), ai('claude-code'),
      ];
      expect(idsIn(providerLanes(real).local)).toEqual(['local']);
    });

    it('appears when the catalog is empty', () => {
      expect(idsIn(providerLanes([]).local)).toEqual(['local']);
    });

    it('carries what the click handler needs to select it', () => {
      // handleProviderClick short-circuits on `provider.id` and reports using
      // `provider.name`; getProviderCase maps 'local' → 'Local' for the store.
      const [local] = providerLanes([]).local;
      expect(local.id).toBe('local');
      expect(local.name).toBe('Local');
    });

    it('asks for no credential, so neither form claims it', () => {
      const [local] = providerLanes([]).local;
      expect(local.connectionType).not.toBe('apikey');
      expect(local.connectionType).not.toBe('oauth');
    });

    it('defers to a catalog record rather than duplicating it', () => {
      // If `local` is ever published, that row wins and only one is offered.
      const lanes = providerLanes([ai('local', { name: 'Local Models' })]);
      expect(lanes.local).toHaveLength(1);
      expect(lanes.local[0].name).toBe('Local Models');
    });

    it('is never handed out as a mutable singleton', () => {
      // One module-level record is shared by every caller; a component
      // mutating it would change what every other screen renders.
      const [first] = providerLanes([]).local;
      expect(() => { first.name = 'Hacked'; }).toThrow();
      expect(providerLanes([]).local[0].name).toBe('Local');
    });
  });

  it('orders each lane by rendered label, so ChatGPT is under C', () => {
    const lanes = providerLanes(PROVIDERS);
    // ChatGPT before Claude within the subscription lane.
    expect(idsIn(lanes.subscription)).toEqual(['openai-codex', 'claude-code']);
  });

  it('floats connected providers to the front so none hide behind "+N more"', () => {
    const many = [
      ai('anthropic'), ai('cerebras'), ai('chutes'), ai('deepseek'),
      ai('groq'), ai('openai'), ai('zai'),
    ];
    const lanes = providerLanes(many, { connectedIds: ['zai'] });
    expect(lanes.api[0].id).toBe('zai');
    expect(idsIn(lanes.api).slice(0, LANE_PREVIEW_COUNT)).toContain('zai');
  });

  it('keeps label order within each rank group', () => {
    const many = [ai('zai'), ai('groq'), ai('cerebras'), ai('chutes')];
    const lanes = providerLanes(many, { connectedIds: ['zai'] });
    // zai connected first; the rest carry no sibling, so pure label order.
    expect(idsIn(lanes.api)).toEqual(['zai', 'cerebras', 'chutes', 'groq']);
  });

  it('previews the vendors that also sell a plan, not just the early alphabet', () => {
    // The real list: alphabetical alone showed Anthropic/Cerebras/Chutes/
    // DeepSeek and buried OpenAI and Google, the two keys most people hold.
    const many = [
      ai('anthropic'), ai('cerebras'), ai('chutes'), ai('deepseek'),
      ai('gemini'), ai('groq'), ai('openai'), ai('zai'),
    ];
    const preview = idsIn(providerLanes(many).api).slice(0, LANE_PREVIEW_COUNT);
    expect(preview).toContain('openai');
    expect(preview).toContain('gemini');
    expect(preview).toContain('anthropic');
  });

  it('still puts a connection ahead of a merely well-known vendor', () => {
    const many = [ai('openai'), ai('anthropic'), ai('gemini'), ai('zai')];
    const lanes = providerLanes(many, { connectedIds: ['zai'] });
    expect(lanes.api[0].id).toBe('zai');
  });

  it('keeps both halves of a pair visible, so the cross-link has a target', () => {
    const many = [
      ai('anthropic'), ai('cerebras'), ai('chutes'), ai('deepseek'), ai('openai'),
      ai('claude-code'), ai('cursor-cli'), ai('grok-build'), ai('openai-codex'), ai('kimi-code'),
    ];
    const lanes = providerLanes(many);
    const sub = idsIn(lanes.subscription).slice(0, LANE_PREVIEW_COUNT);
    const api = idsIn(lanes.api).slice(0, LANE_PREVIEW_COUNT);
    expect(sub).toContain('openai-codex');
    expect(api).toContain('openai');
    expect(sub).toContain('claude-code');
    expect(api).toContain('anthropic');
  });

  it('matches connected ids case-insensitively', () => {
    const lanes = providerLanes([ai('anthropic'), ai('openai')], { connectedIds: ['OpenAI'] });
    expect(lanes.api[0].id).toBe('openai');
  });

  it('hides ChatGPT only when its own service reports unusable', () => {
    const codexStatus = { available: true, apiUsable: false };
    const lanes = providerLanes(PROVIDERS, { codexStatus });
    expect(idsIn(lanes.subscription)).not.toContain('openai-codex');
  });

  it('shows ChatGPT while its status is still loading', () => {
    // `available` undefined means "not checked yet". Treating that as unusable
    // hid the tile for the first moments of every session.
    const lanes = providerLanes(PROVIDERS, { codexStatus: {} });
    expect(idsIn(lanes.subscription)).toContain('openai-codex');
  });

  it('never mutates the array it was handed', () => {
    // The caller passes Vuex state; sorting it in place re-triggers the very
    // computed that read it.
    const input = [ai('zai'), ai('anthropic')];
    const snapshot = idsIn(input);
    providerLanes(input, { connectedIds: ['zai'] });
    expect(idsIn(input)).toEqual(snapshot);
  });

  it('returns empty lanes for junk input rather than throwing', () => {
    // This screen is the only place a user can fix a broken provider list;
    // throwing here blanks the fix.
    for (const junk of [null, undefined, 'nope', 42, {}]) {
      const lanes = providerLanes(junk);
      // Local survives junk input on purpose — a broken or unreachable
      // catalog is precisely when running a model on this machine is the only
      // thing that still works, so it is the last option to withdraw.
      expect(lanes.subscription).toEqual([]);
      expect(lanes.api).toEqual([]);
      expect(lanes.local.map((p) => p.id)).toEqual(['local']);
    }
  });

  it('survives a provider whose categories are malformed JSON', () => {
    const lanes = providerLanes([ai('openai'), { id: 'broken', categories: '{not json' }]);
    expect(idsIn(lanes.api)).toEqual(['openai']);
  });
});

describe('PROVIDER_LANE_SIBLING', () => {
  it('pairs every vendor that sells both a plan and a metered API', () => {
    expect(PROVIDER_LANE_SIBLING['openai-codex']).toBe('openai');
    expect(PROVIDER_LANE_SIBLING.anthropic).toBe('claude-code');
  });

  it('is symmetric — you can cross the billing divide from either side', () => {
    for (const [from, to] of Object.entries(PROVIDER_LANE_SIBLING)) {
      expect(PROVIDER_LANE_SIBLING[to]).toBe(from);
    }
  });

  it('always pairs one subscription with one metered provider', () => {
    for (const [from, to] of Object.entries(PROVIDER_LANE_SIBLING)) {
      expect(isSubscriptionProvider(from)).toBe(!isSubscriptionProvider(to));
    }
  });
});
