import { CACHE_CAUSES, readExecutionTelemetry } from '../ai/executionTelemetry.js';

/**
 * Aggregate persisted cache rounds by cause. Pure.
 *
 * `premium` is the price a round paid ABOVE what the same tokens would have
 * cost as cache reads, in base-input-token units. It is what a cause could
 * save if eliminated, so it is the number to rank causes by. Anthropic-family
 * providers pay the premium as a write (1.25x for 5m, 2.0x for 1h); providers
 * without explicit writes pay it as uncached input (1.0x). Reads bill 0.1x.
 *
 * @param {Array<{provider?: string, execution_telemetry?: string|object}>} rows
 */
const READ_RATE = 0.1;
const WRITE_FAMILY = new Set(['anthropic', 'claude-code']);

export function summarizeCacheRounds(rows) {
  const byCause = Object.fromEntries(CACHE_CAUSES.map((cause) => [cause, {
    cause, rounds: 0, firstOfTurn: 0, writeTokens: 0, uncachedTokens: 0, lostTokens: 0, premium: 0,
  }]));
  let executions = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const { value } = readExecutionTelemetry(row?.execution_telemetry ?? null);
    if (!value || value.version !== 2) { skipped += 1; continue; }
    executions += 1;
    const writeFamily = WRITE_FAMILY.has(String(row.provider || '').toLowerCase());
    for (const round of value.cacheRounds) {
      const bucket = byCause[round.cause];
      bucket.rounds += 1;
      if (round.firstOfTurn) bucket.firstOfTurn += 1;
      bucket.writeTokens += round.write5m + round.write1h;
      bucket.uncachedTokens += round.uncached;
      bucket.lostTokens += round.lostTokens;
      bucket.premium += writeFamily
        ? round.write5m * (1.25 - READ_RATE) + round.write1h * (2.0 - READ_RATE) + round.uncached * (1 - READ_RATE)
        : round.uncached * (1 - READ_RATE);
    }
  }
  const totalPremium = Object.values(byCause).reduce((sum, b) => sum + b.premium, 0);
  const causes = Object.values(byCause)
    .filter((b) => b.rounds > 0)
    .map((b) => ({ ...b, premium: Math.round(b.premium), premiumShare: totalPremium ? +(b.premium / totalPremium * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.premium - a.premium);
  return { executions, skipped, totalPremium: Math.round(totalPremium), causes };
}
