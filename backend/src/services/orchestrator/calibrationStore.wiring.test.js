import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * A positional source-contract test.
 *
 * Unit-testing calibrationStore proves the logic works; it proves nothing about
 * whether the orchestrator actually CALLS it. That distinction is not academic
 * — AGNT has shipped exactly this failure before (toolValidator was correct and
 * complete, but wired into only one of five adapter families, so its recovery
 * pipeline was dead code for the rest). The bug being prevented here is a
 * wiring bug, so the test has to assert wiring.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../OrchestratorService.js'), 'utf8');

describe('calibration is wired into the request path', () => {
  it('imports the store', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*getCalibration[^}]*\}\s*from\s*'\.\/orchestrator\/calibrationStore\.js'/s);
    expect(SRC).toMatch(/recordCalibration/);
    expect(SRC).toMatch(/loadCalibrations/);
  });

  it('seeds a new conversation before the first manageContext call', () => {
    const seedAt = SRC.indexOf('getCalibration(normalizedProvider, model)');
    const firstManage = SRC.indexOf('const contextResult = manageContext(');
    expect(seedAt).toBeGreaterThan(-1);
    expect(firstManage).toBeGreaterThan(-1);
    // Seeding after the budget was computed would leave turn 1 uncalibrated —
    // precisely the case this feature exists to fix.
    expect(seedAt).toBeLessThan(firstManage);
  });

  it('guards the seed on nothing but "a trustworthy value exists"', () => {
    // Asserting mere PRESENCE of the assignment is not enough: wrapping it in a
    // dead branch (`if (false && ...)`) leaves every positional check above
    // satisfied while the seed never runs. Pin the exact guard so the only way
    // to pass is to actually apply the value.
    expect(SRC).toMatch(
      /if \(seededCalibration != null\) \{\s*\r?\n\s*conversationContext\._estimateCalibration = seededCalibration;\s*\r?\n\s*\}/
    );
  });

  it('loads the table before the first lookup', () => {
    const load = SRC.indexOf('await loadCalibrations()');
    const lookup = SRC.indexOf('getCalibration(normalizedProvider, model)');
    expect(load).toBeGreaterThan(-1);
    expect(load).toBeLessThan(lookup);
  });

  it('lets an established conversation override the global prior', () => {
    const seed = SRC.indexOf('conversationContext._estimateCalibration = seededCalibration');
    const restore = SRC.indexOf('conversationContext._estimateCalibration = priorContext._estimateCalibration');
    expect(seed).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(-1);
    // The per-conversation value is measured from THIS conversation's traffic,
    // so it must win over the cross-conversation average.
    expect(restore).toBeGreaterThan(seed);
  });

  it('records an observation at every site that folds usage into the EMA', () => {
    const folds = SRC.match(/_estimateCalibration = updateEstimateCalibration\(/g) || [];
    const records = SRC.match(/recordCalibration\(normalizedProvider, model,/g) || [];
    expect(folds.length).toBeGreaterThanOrEqual(3);
    // One record per fold: a missed site silently stops learning from an entire
    // class of turn (e.g. every tool-loop round).
    expect(records).toHaveLength(folds.length);
  });

  it('measures against the RAW estimate so seeding cannot feed back', () => {
    // totalRequestTokens is the uncalibrated sum; if the calibrated display
    // value were passed instead, the ratio would converge to 1 and silently
    // stop correcting anything.
    expect(SRC).toMatch(/updateEstimateCalibration\(\s*\r?\n?\s*conversationContext\._estimateCalibration,\s*\r?\n?\s*\w+,\s*\r?\n?\s*\w*[cC]ontextResult\.totalRequestTokens/);
  });
});
