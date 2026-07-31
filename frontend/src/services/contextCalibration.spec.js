import { describe, it, expect } from 'vitest';
import {
  calibrateContextStatus,
  calibrateManifest,
  TOKEN_UNIT_RAW,
  TOKEN_UNIT_CALIBRATED,
} from './contextCalibration.js';

// The numbers measured on the live chat that exposed the bug: the tiles showed
// System 37.6k / Tools 20.4k / Messages 159.3k (calibrated) while the inventory
// underneath summed to 24.9k (raw), because only one of the two events was
// being scaled.
const CAL = 1.508;
const RAW_SYSTEM = 24_940;
const RAW_TOOLS = 13_500;
const RAW_MESSAGES = 105_600;
const RAW_TOTAL = RAW_SYSTEM + RAW_TOOLS + RAW_MESSAGES;

const rawStatus = () => ({
  round: 1,
  unit: TOKEN_UNIT_RAW,
  calibration: CAL,
  currentTokens: RAW_TOTAL,
  tokenLimit: 1_000_000,
  utilizationPercent: (RAW_TOTAL / 1_000_000) * 100,
  model: 'claude-opus-5',
  messagesCount: 42,
  breakdown: {
    systemTokens: RAW_SYSTEM,
    toolTokens: RAW_TOOLS,
    messagesTokens: RAW_MESSAGES,
    outputBufferTokens: 60_000,
    totalRequestTokens: RAW_TOTAL,
    calibration: CAL,
    residualDrift: 1.02,
  },
});

const rawManifest = () => ({
  mode: 'auto',
  unit: TOKEN_UNIT_RAW,
  calibration: CAL,
  cacheTtlMs: 300_000,
  economics: {
    rate: 1.5e-6,
    cachedRate: 1.5e-7,
    floorTokens: RAW_SYSTEM + RAW_TOOLS,
    floorCost: (RAW_SYSTEM + RAW_TOOLS) * 1.5e-6,
    floorCostCached: (RAW_SYSTEM + RAW_TOOLS) * 1.5e-7,
    systemTokens: RAW_SYSTEM,
    toolTokens: RAW_TOOLS,
  },
  system: {
    total: RAW_SYSTEM,
    sections: [
      { id: 'static', label: 'Core instructions', tokens: 11_600, cost: 11_600 * 1.5e-6, frozen: true },
      { id: 'skills', label: 'Skills catalog', tokens: 5_000, cost: 5_000 * 1.5e-6, frozen: true },
      { id: 'workspace', label: 'Workspace context', tokens: 137, cost: 137 * 1.5e-6 },
    ],
  },
  tools: {
    total: RAW_TOOLS,
    count: 30,
    registryTotal: 325,
    hiddenCount: 295,
    droppedCount: 0,
    deniedCount: 0,
    groups: ['core'],
    items: [
      { name: 'web_search', tokens: 268, cost: 268 * 1.5e-6, reason: 'default' },
      { name: 'query_data', tokens: 599, cost: 599 * 1.5e-6, reason: 'default' },
    ],
  },
  messages: { total: RAW_MESSAGES, count: 42, managed: true, reduction: 8_000 },
  cache: { prefixStable: true },
});

describe('calibrateContextStatus', () => {
  it('scales every estimated token count by the calibration factor', () => {
    const out = calibrateContextStatus(rawStatus());
    expect(out.currentTokens).toBe(Math.round(RAW_TOTAL * CAL));
    expect(out.breakdown.systemTokens).toBe(Math.round(RAW_SYSTEM * CAL));
    expect(out.breakdown.toolTokens).toBe(Math.round(RAW_TOOLS * CAL));
    expect(out.breakdown.messagesTokens).toBe(Math.round(RAW_MESSAGES * CAL));
    expect(out.breakdown.totalRequestTokens).toBe(Math.round(RAW_TOTAL * CAL));
  });

  it('leaves real quantities and ratios alone', () => {
    const out = calibrateContextStatus(rawStatus());
    expect(out.tokenLimit).toBe(1_000_000);            // the model's real window
    expect(out.breakdown.outputBufferTokens).toBe(60_000); // a reserve, not an estimate
    expect(out.breakdown.calibration).toBe(CAL);       // the factor itself
    expect(out.breakdown.residualDrift).toBe(1.02);    // a ratio
    expect(out.messagesCount).toBe(42);                // a count
    expect(out.round).toBe(1);
    expect(out.model).toBe('claude-opus-5');
  });

  it('returns integers — a float token count renders as 206.59599999999998', () => {
    const out = calibrateContextStatus(rawStatus());
    for (const v of [out.currentTokens, out.breakdown.systemTokens, out.breakdown.toolTokens]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('never mutates its input', () => {
    const input = rawStatus();
    calibrateContextStatus(input);
    expect(input.currentTokens).toBe(RAW_TOTAL);
    expect(input.breakdown.systemTokens).toBe(RAW_SYSTEM);
    expect(input.unit).toBe(TOKEN_UNIT_RAW);
  });
});

describe('idempotence — payloads are replayed on reconnect and restored from cache', () => {
  it('converting twice equals converting once', () => {
    const once = calibrateContextStatus(rawStatus());
    const twice = calibrateContextStatus(once);
    expect(twice).toEqual(once);
    expect(once.unit).toBe(TOKEN_UNIT_CALIBRATED);
  });

  it('converting a manifest twice equals converting it once', () => {
    const once = calibrateManifest(rawManifest());
    expect(calibrateManifest(once)).toEqual(once);
  });

  it('leaves a legacy payload (no unit marker) untouched — it was already calibrated', () => {
    const legacy = { currentTokens: 217_300, breakdown: { systemTokens: 37_600 } };
    expect(calibrateContextStatus(legacy)).toBe(legacy);
    const legacyManifest = { system: { total: 37_600 } };
    expect(calibrateManifest(legacyManifest)).toBe(legacyManifest);
  });

  it('survives null / non-object input', () => {
    expect(calibrateContextStatus(null)).toBeNull();
    expect(calibrateManifest(undefined)).toBeUndefined();
  });
});

describe('degenerate calibration values', () => {
  it('treats a missing, zero, negative or NaN factor as 1', () => {
    for (const calibration of [undefined, 0, -2, NaN, 'x']) {
      const out = calibrateContextStatus({ ...rawStatus(), calibration });
      expect(out.currentTokens).toBe(RAW_TOTAL);
      expect(out.unit).toBe(TOKEN_UNIT_CALIBRATED);
    }
  });

  it('still marks the payload converted at factor 1 so it cannot be scaled later', () => {
    const out = calibrateContextStatus({ ...rawStatus(), calibration: 1 });
    expect(out.unit).toBe(TOKEN_UNIT_CALIBRATED);
    expect(calibrateContextStatus(out).currentTokens).toBe(RAW_TOTAL);
  });
});

describe('calibrateManifest', () => {
  it('scales group totals and every line item', () => {
    const out = calibrateManifest(rawManifest());
    expect(out.system.total).toBe(Math.round(RAW_SYSTEM * CAL));
    expect(out.system.sections[0].tokens).toBe(Math.round(11_600 * CAL));
    expect(out.system.sections[2].tokens).toBe(Math.round(137 * CAL));
    expect(out.tools.total).toBe(Math.round(RAW_TOOLS * CAL));
    expect(out.tools.items[0].tokens).toBe(Math.round(268 * CAL));
    expect(out.messages.total).toBe(Math.round(RAW_MESSAGES * CAL));
    expect(out.messages.reduction).toBe(Math.round(8_000 * CAL));
  });

  it('scales money without rounding it to zero', () => {
    const out = calibrateManifest(rawManifest());
    expect(out.economics.floorCost).toBeCloseTo(out.economics.floorTokens * 1.5e-6, 12);
    expect(out.economics.floorCostCached).toBeCloseTo(out.economics.floorTokens * 1.5e-7, 12);
    // The bug this guards: Math.round on a sub-cent cost yields $0.00. The
    // 137-token workspace section costs ~$0.0003 and must survive.
    expect(out.system.sections[2].cost).toBeGreaterThan(0);
    expect(out.tools.items[0].cost).toBeCloseTo(out.tools.items[0].tokens * 1.5e-6, 15);
  });

  it('keeps floorCostCached null when the provider has no cached rate', () => {
    const m = rawManifest();
    m.economics.cachedRate = null;
    m.economics.floorCostCached = null;
    expect(calibrateManifest(m).economics.floorCostCached).toBeNull();
  });

  it('leaves per-token prices and tool counts alone', () => {
    const out = calibrateManifest(rawManifest());
    expect(out.economics.rate).toBe(1.5e-6);        // dollars per token, a real price
    expect(out.economics.cachedRate).toBe(1.5e-7);
    expect(out.tools.count).toBe(30);
    expect(out.tools.registryTotal).toBe(325);
    expect(out.tools.hiddenCount).toBe(295);
    expect(out.messages.count).toBe(42);
    expect(out.cacheTtlMs).toBe(300_000);
    expect(out.cache).toEqual({ prefixStable: true });
  });

  it('tolerates a manifest with no economics block (unpriceable model)', () => {
    const { economics: _drop, ...noEcon } = rawManifest();
    const out = calibrateManifest({ ...noEcon, economics: null });
    expect(out.economics).toBeNull();
    expect(out.system.total).toBe(Math.round(RAW_SYSTEM * CAL));
  });
});

describe('THE REGRESSION: both events land in the same unit', () => {
  it('tile System equals inventory System', () => {
    const status = calibrateContextStatus(rawStatus());
    const manifest = calibrateManifest(rawManifest());
    expect(status.breakdown.systemTokens).toBe(manifest.system.total);
    expect(status.breakdown.toolTokens).toBe(manifest.tools.total);
    expect(status.breakdown.messagesTokens).toBe(manifest.messages.total);
  });

  it('the inventory sections still sum to the System tile', () => {
    const status = calibrateContextStatus(rawStatus());
    const raw = rawManifest();
    const manifest = calibrateManifest(raw);
    // The fixture's sections are a subset of the real prompt, so compare the
    // relationship that must hold: scaled parts sum to the scaled whole, not to
    // a different unit entirely. Tolerance is HALF A TOKEN PER ITEM — the
    // arithmetic limit of rounding each row independently, and ~4 orders of
    // magnitude below the panel's own 0.1k display resolution. A unit mismatch
    // would miss by 50%, not by one token.
    const rawSum = raw.system.sections.reduce((a, s) => a + s.tokens, 0);
    const scaledSum = manifest.system.sections.reduce((a, s) => a + s.tokens, 0);
    expect(Math.abs(scaledSum - rawSum * CAL)).toBeLessThanOrEqual(raw.system.sections.length / 2);
    // ...and nothing in the manifest is still sitting in raw units.
    expect(manifest.system.total).toBeGreaterThan(raw.system.total);
    expect(status.unit).toBe(manifest.unit);
  });

  it('the floor cost agrees with the drivers that explain it', () => {
    const manifest = calibrateManifest(rawManifest());
    const rate = manifest.economics.rate;
    // Every itemized cost must be that item's displayed tokens at the real
    // rate. Previously floorCost used calibrated tokens while priceItems used
    // raw ones, so the drivers understated the floor by the whole factor.
    for (const item of [...manifest.system.sections, ...manifest.tools.items]) {
      expect(item.cost).toBe(item.tokens * rate);
    }
    expect(manifest.economics.floorCost).toBe(manifest.economics.floorTokens * rate);
  });
});
