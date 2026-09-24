/**
 * Source contract for per-request cache attribution in the chat orchestrator.
 *
 * The behaviour itself is tested against the real code in
 * cacheRoundTracker.test.js and OrchestratorService.cacheActivity.test.js.
 * What those cannot see is the WIRING inside a 4,000-line method that cannot be
 * booted in a unit test: that every request is stamped at the single send
 * point, that the stamp comes before the send, and that the state and the
 * telemetry actually leave the turn. A silent unwiring would leave every test
 * above green while recording nothing, so it is pinned here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'OrchestratorService.js'), 'utf8');
const body = (start, end) => {
  const i = SRC.indexOf(start);
  const j = SRC.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`section not found: ${start}`);
  return SRC.slice(i, j);
};

describe('OrchestratorService cache-telemetry wiring', () => {
  it('stamps every request inside runTierStream, after failover re-pointing and before the send', () => {
    const tier = body('const runTierStream = async', 'const onProviderFallback');
    const stampAt = tier.indexOf('cacheRounds.stamp({ provider: normalizedProvider, model, messages, tools })');
    expect(stampAt).toBeGreaterThan(tier.indexOf('if (!tier.primary)'));
    expect(stampAt).toBeLessThan(tier.indexOf('adapter.callStream('));
  });

  it('there is exactly one stamp site, so no request can be counted twice', () => {
    expect(SRC.match(/cacheRounds\.stamp\(/g)).toHaveLength(1);
  });

  it('observes every round in accumulateUsage, outside the cache-activity condition', () => {
    const fn = body('function accumulateUsage(usage) {', "// Send initial assistant message");
    const observeAt = fn.indexOf('cacheRounds.observe(');
    expect(observeAt).toBeGreaterThan(-1);
    expect(observeAt).toBeLessThan(fn.indexOf('if (roundCacheRead > 0 || roundCacheWrite > 0) {\n        sendEvent'));
  });

  it('persists the v2 telemetry with the terminal status update', () => {
    expect(SRC).toMatch(/tokenUsageForDb,\s*buildCacheTelemetry\(finalStatus, tokenAccumulator, cacheRounds\)\s*\)/);
  });

  it('carries the last request into the next turn and seeds the tracker from it', () => {
    expect(SRC).toContain('_cacheRoundState: cacheRounds.carryState(),');
    expect(SRC).toContain('createCacheRoundTracker({ carried: priorContext?._cacheRoundState ?? null })');
  });
});
