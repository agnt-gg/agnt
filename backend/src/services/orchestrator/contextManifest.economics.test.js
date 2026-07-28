import { describe, it, expect } from 'vitest';
import { buildContextManifest } from './contextManifest.js';
import { buildEconomics } from '../../utils/contextEconomics.js';

const tool = (name, propCount = 2) => ({
  type: 'function',
  function: {
    name,
    description: `does ${name}`,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: propCount }, (_, i) => [`p${i}`, { type: 'string', description: 'x'.repeat(40) }])
      ),
    },
  },
});

const base = {
  systemPrompt: 'SYSTEM',
  promptSections: [
    { id: 'memory', label: 'Memory', tokens: 15_310, frozen: true },
    { id: 'skills', label: 'Skills catalog', tokens: 2_863, frozen: true },
  ],
  toolSchemas: [tool('alpha'), tool('beta', 6)],
  toolProvenance: { alpha: { reason: 'default' }, beta: { reason: 'group', group: 'core' } },
  toolSurfaceMeta: { registryTotal: 296, mode: 'auto' },
  contextResult: { systemTokens: 31_645, toolTokens: 37_434, messagesTokens: 712_011, messages: [] },
};

const econ = buildEconomics({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  systemTokens: 31_645,
  toolTokens: 37_434,
});

describe('buildContextManifest — economics', () => {
  it('attaches the economics block when pricing is available', () => {
    const { manifest } = buildContextManifest({ ...base, economics: econ });
    expect(manifest.economics).toBeTruthy();
    expect(manifest.economics.floorTokens).toBe(69_079);
    expect(manifest.economics.floorCost).toBeGreaterThan(0);
  });

  it('prices every system section at the per-turn rate', () => {
    const { manifest } = buildContextManifest({ ...base, economics: econ });
    const mem = manifest.system.sections.find((s) => s.id === 'memory');
    expect(mem.cost).toBeCloseTo(15_310 * econ.rate, 12);
    // The derived "Core instructions" residue is priced too, or the biggest
    // line item in the system prompt would be the one with no cost on it.
    const core = manifest.system.sections.find((s) => s.id === 'static');
    expect(core).toBeTruthy();
    expect(core.cost).toBeCloseTo(core.tokens * econ.rate, 12);
  });

  it('prices every tool schema', () => {
    const { manifest } = buildContextManifest({ ...base, economics: econ });
    for (const t of manifest.tools.items) {
      expect(t.cost).toBeCloseTo(t.tokens * econ.rate, 12);
    }
    // Preserves the fields the panel already relied on.
    expect(manifest.tools.items.map((t) => t.name)).toEqual(['alpha', 'beta']);
    expect(manifest.tools.items[1].reason).toBe('group');
    expect(manifest.tools.items[1].group).toBe('core');
  });

  it('costs scale with size — the ranking is usable', () => {
    const { manifest } = buildContextManifest({ ...base, economics: econ });
    const [a, b] = manifest.tools.items;
    expect(b.tokens).toBeGreaterThan(a.tokens);
    expect(b.cost).toBeGreaterThan(a.cost);
  });

  it('emits economics: null and unpriced items when the model is unknown', () => {
    const { manifest } = buildContextManifest({
      ...base,
      economics: buildEconomics({ provider: 'nope', model: 'nope', systemTokens: 1, toolTokens: 1 }),
    });
    expect(manifest.economics).toBeNull();
    expect(manifest.system.sections[0].cost).toBeUndefined();
    expect(manifest.tools.items[0].cost).toBeUndefined();
  });

  it('is backwards compatible — omitting economics changes nothing else', () => {
    const withOut = buildContextManifest(base).manifest;
    const withIn = buildContextManifest({ ...base, economics: econ }).manifest;
    expect(withOut.economics).toBeNull();
    expect(withOut.system.total).toBe(withIn.system.total);
    expect(withOut.tools.count).toBe(withIn.tools.count);
    expect(withOut.tools.registryTotal).toBe(withIn.tools.registryTotal);
    expect(withOut.messages.total).toBe(withIn.messages.total);
    expect(withOut.system.sections.map((s) => s.id)).toEqual(withIn.system.sections.map((s) => s.id));
  });

  it('leaves cache-prefix fingerprinting untouched by pricing', () => {
    const first = buildContextManifest({ ...base, economics: econ });
    const second = buildContextManifest({ ...base, economics: econ, prior: first.fingerprints });
    expect(second.manifest.cache.prefixStable).toBe(true);

    const grown = buildContextManifest({
      ...base,
      economics: econ,
      toolSchemas: [...base.toolSchemas, tool('gamma')],
      prior: first.fingerprints,
    });
    expect(grown.manifest.cache.prefixStable).toBe(true);
    expect(grown.manifest.cache.toolsAdded).toBe(1);

    const reordered = buildContextManifest({
      ...base,
      economics: econ,
      toolSchemas: [tool('beta', 6), tool('alpha')],
      prior: first.fingerprints,
    });
    expect(reordered.manifest.cache.prefixStable).toBe(false);
  });
});
