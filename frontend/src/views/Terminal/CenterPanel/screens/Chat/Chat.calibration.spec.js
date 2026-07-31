// Calibration is applied ONCE, on ingest, in Chat.vue's event switch.
//
// contextCalibration.js can be perfectly correct and still never be called.
// The failure mode is silent — the panel simply shows raw estimates again,
// which look entirely plausible — so the wiring gets its own contract.
//
// Read from source rather than mounted, matching Chat.cacheActivity.spec.js:
// mounting Chat.vue drags in the router, the store and an SSE client, none of
// which say anything about where a unit conversion happens.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'Chat.vue'),
  'utf8',
);

describe('Chat.vue converts telemetry to display units on ingest', () => {
  it('imports both converters from the shared module', () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*calibrateContextStatus[^}]*calibrateManifest[^}]*\}\s*from\s*'@\/services\/contextCalibration\.js'/s,
    );
  });

  it('converts the context_status payload BEFORE anything consumes it', () => {
    const caseIdx = SRC.indexOf("case 'context_status':");
    expect(caseIdx).toBeGreaterThan(-1);
    const block = SRC.slice(caseIdx, caseIdx + 1400);

    const convertIdx = block.indexOf('calibrateContextStatus(data)');
    const reducerIdx = block.indexOf('applyContextStatusRound(');
    const assignIdx = block.indexOf('ms.contextStatus =');
    expect(convertIdx).toBeGreaterThan(-1);
    // The round reducer feeds the per-round chart and growth-per-turn forecast;
    // the assignment feeds the tiles and the localStorage cache. Both must read
    // the converted value or the panel mixes units with itself.
    expect(convertIdx).toBeLessThan(reducerIdx);
    expect(convertIdx).toBeLessThan(assignIdx);
  });

  it('feeds the CONVERTED status to the reducer and the panel, never the raw event', () => {
    const caseIdx = SRC.indexOf("case 'context_status':");
    const block = SRC.slice(caseIdx, caseIdx + 1400);
    expect(block).toMatch(/applyContextStatusRound\(ms,\s*status\)/);
    for (const field of ['currentTokens', 'utilizationPercent', 'breakdown']) {
      // `data.currentTokens` here would be the raw estimate.
      expect(block).toMatch(new RegExp(`${field}:\\s*status\\.${field}`));
      expect(block).not.toMatch(new RegExp(`${field}:\\s*data\\.${field}`));
    }
  });

  it('converts the context_manifest payload before storing it', () => {
    const caseIdx = SRC.indexOf("case 'context_manifest':");
    expect(caseIdx).toBeGreaterThan(-1);
    const block = SRC.slice(caseIdx, caseIdx + 700);

    const convertIdx = block.indexOf('calibrateManifest(data)');
    expect(convertIdx).toBeGreaterThan(-1);
    expect(block).toMatch(/ms\.lastManifest\s*=\s*manifest/);
    expect(block).not.toMatch(/ms\.lastManifest\s*=\s*data/);
    expect(convertIdx).toBeLessThan(block.indexOf('ms.lastManifest'));
  });

  it('persists the CONVERTED status, so a reload does not restore mixed units', () => {
    const caseIdx = SRC.indexOf("case 'context_status':");
    const block = SRC.slice(caseIdx, caseIdx + 1400);
    // saveContextStatus writes ms.contextStatus, which the assertions above
    // pin to the converted value; this asserts it is still that object.
    expect(block).toMatch(/saveContextStatus\(streamConvId,\s*ms\.contextStatus\)/);
    // The unit marker rides along so the cached payload is self-describing.
    expect(block).toMatch(/unit:\s*status\.unit/);
  });
});
