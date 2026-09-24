// Read-only. Rank prompt-cache causes by the premium they cost.
//
// Reads the per-request cache rounds that chat turns persist into
// agent_executions.execution_telemetry (v2) and aggregates them by cause.
// A cause above ~25% of the premium is the next thing to fix.
//
// Usage: node scripts/cache-break-report.mjs [--days N] [--provider P] [--db PATH]
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { summarizeCacheRounds } from '../src/services/orchestrator/cacheBreakReport.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const days = Number(arg('days', '3'));
if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');
const provider = arg('provider', null);
const dbPath = arg('db', process.env.AGNT_DB_PATH || path.join(process.env.APPDATA || '', 'AGNT', 'Data', 'agnt.db'));

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const rows = db.prepare(`
    SELECT provider, execution_telemetry FROM agent_executions
    WHERE start_time >= datetime('now', ?) AND execution_telemetry IS NOT NULL
      AND (? IS NULL OR lower(provider) = lower(?))
  `).all(`-${days} days`, provider, provider);
  const report = summarizeCacheRounds(rows);
  console.log(`Cache attribution, last ${days} day(s)${provider ? `, provider ${provider}` : ''}: ` +
    `${report.executions} run(s) with v2 telemetry, ${report.skipped} without.`);
  if (report.causes.length === 0) {
    console.log('No cache rounds recorded yet. Chat turns record them from this build onward.');
  } else {
    console.table(report.causes);
    console.log('premium = cost above cache-read price, in base-input-token units. Rank by premiumShare.');
  }
} finally {
  db.close();
}
