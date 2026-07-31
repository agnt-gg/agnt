// One unit on the wire.
//
// The Context & Cost panel is fed by TWO events — `context_status` (the tiles)
// and `context_manifest` (the inventory) — rendered side by side. The backend
// used to apply the estimate->real calibration factor to the first and not the
// second, so the same panel showed "System 37.6k" above an inventory whose own
// sections summed to 24.9k. buildEconomics compounded it: it received
// CALIBRATED bucket totals while priceItems priced RAW per-item tokens at the
// same rate, so the "recurring drivers" table understated the floor cost
// directly above it by the whole factor.
//
// The fix is that the backend emits ONE unit (raw) plus the factor, and the
// display boundary converts once. These tests pin both halves of that contract.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildContextManifest, TOKEN_UNIT_RAW } from './contextManifest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const tool = (name) => ({
  type: 'function',
  function: { name, description: `${name} does a thing`, parameters: { type: 'object', properties: {} } },
});

const base = {
  systemPrompt: 'SYSTEM',
  promptSections: [{ id: 'memory', label: 'Memory', tokens: 4557, frozen: true }],
  toolSchemas: [tool('web_search'), tool('read_file')],
  toolProvenance: { web_search: { reason: 'default' } },
  toolSurfaceMeta: { registryTotal: 325, mode: 'auto' },
  contextResult: { systemTokens: 24_940, toolTokens: 13_500, messagesTokens: 105_600, messages: [] },
};

describe('buildContextManifest declares its unit', () => {
  it('marks token counts raw and publishes the conversion factor', () => {
    const { manifest } = buildContextManifest({ ...base, calibration: 1.508 });
    expect(manifest.unit).toBe(TOKEN_UNIT_RAW);
    expect(manifest.calibration).toBe(1.508);
  });

  it('emits RAW totals — unscaled, exactly as measured', () => {
    const { manifest } = buildContextManifest({ ...base, calibration: 1.508 });
    expect(manifest.system.total).toBe(24_940);
    expect(manifest.tools.total).toBe(13_500);
    expect(manifest.messages.total).toBe(105_600);
  });

  it('defaults to a factor of 1 rather than dropping the field', () => {
    // A missing factor must read as "no correction", never as undefined — the
    // display boundary multiplies by it.
    for (const calibration of [undefined, 0, -1, NaN]) {
      const { manifest } = buildContextManifest({ ...base, calibration });
      expect(manifest.calibration).toBe(1);
      expect(manifest.unit).toBe(TOKEN_UNIT_RAW);
    }
  });

  it('keeps the system sections summing to the system total', () => {
    const { manifest } = buildContextManifest({ ...base, calibration: 1.508 });
    const sum = manifest.system.sections.reduce((a, s) => a + s.tokens, 0);
    expect(sum).toBe(manifest.system.total);
  });
});

// The resolver can be perfect and still not be used. These assertions read the
// source at the point where telemetry actually leaves the orchestrator.
describe('OrchestratorService emits one unit (source contract)', () => {
  const SRC = fs.readFileSync(path.join(HERE, '..', 'OrchestratorService.js'), 'utf8');

  it('has more than one context_status emit site (anti-vacuity)', () => {
    // Every negative assertion below is worthless if the emit sites moved or
    // were renamed, so prove they are still here and still plural.
    const sites = SRC.match(/sendEvent\('context_status',/g) || [];
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  it('every context_status payload declares unit: TOKEN_UNIT_RAW', () => {
    // A third emit site added later without the marker would ship calibrated-
    // looking numbers that the frontend would then calibrate again.
    const re = /sendEvent\('context_status',\s*\{/g;
    let match;
    let checked = 0;
    while ((match = re.exec(SRC)) !== null) {
      const block = SRC.slice(match.index, match.index + 900);
      expect(block).toMatch(/unit:\s*TOKEN_UNIT_RAW/);
      expect(block).toMatch(/calibration:\s*\w+/);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('no longer multiplies telemetry by the calibration factor', () => {
    // The exact shape of the old per-consumer scaling.
    expect(SRC).not.toMatch(/scaleForDisplay/);
    expect(SRC).not.toMatch(/const loopScale\s*=/);
  });

  it('prices the floor from the same RAW tokens priceItems itemizes', () => {
    const idx = SRC.indexOf('economics: buildEconomics({');
    expect(idx).toBeGreaterThan(-1);
    const block = SRC.slice(idx, idx + 400);
    // ANCHORED TO END OF VALUE. An unanchored /contextResult\.systemTokens/ is
    // also satisfied by `contextResult.systemTokens * displayCalibration` — the
    // precise regression this test exists to catch — so the trailing comma is
    // load-bearing, not punctuation. (Caught by NC4.)
    expect(block).toMatch(/systemTokens:\s*contextResult\.systemTokens,/);
    expect(block).toMatch(/toolTokens:\s*contextResult\.toolTokens,?\s*\n/);
    // Belt and braces: no arithmetic of any kind inside the economics call.
    expect(block.slice(0, block.indexOf('}),'))).not.toMatch(/[*/]/);
  });

  it('passes the factor into the manifest so the two events agree', () => {
    const idx = SRC.indexOf('const { manifest, fingerprints } = buildContextManifest({');
    expect(idx).toBeGreaterThan(-1);
    expect(SRC.slice(idx, idx + 1200)).toMatch(/calibration:\s*displayCalibration/);
  });

  it('still learns calibration from RAW totals, not from display values', () => {
    // If the calibrated number were fed back into the learner the ratio would
    // converge to 1 and silently stop correcting anything.
    expect(SRC).toMatch(
      /updateEstimateCalibration\(\s*\r?\n?\s*conversationContext\._estimateCalibration,\s*\r?\n?\s*\w+,\s*\r?\n?\s*\w*[cC]ontextResult\.totalRequestTokens/,
    );
  });
});
