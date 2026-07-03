// Differential verification for the daily_usage_stats rollup path.
//
// Replicates ExecutionModel._getActivityViaRollup's algorithm (same SQL, same
// padding/clipping rules) and asserts it produces chart-identical results to
// the original full-window aggregation across 7/30/90/365-day windows, for
// every user in the DB. Runs each window twice: pass 1 fills the rollup
// (doubling as the production backfill), pass 2 must serve from cache.
//
// "Chart-identical" = equal after the frontend's own normalization
// (fillMissingDates): zero-fill every date in [startDate, endDate), clip
// everything outside. Today's rows are compared with tolerance only — they
// mutate while the test runs, and the rollup computes today via the exact
// same raw query anyway.
//
// Usage: node scripts/verify-activity-rollup.js [path-to-db]
'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath =
  process.argv[2] ||
  process.env.AGNT_DB_PATH ||
  path.join(process.env.APPDATA || '', 'AGNT', 'Data', 'agnt.db');

const RAW_SQL = `
        SELECT
          date,
          SUM(credits_used) as credits_used,
          SUM(total_tokens) as total_tokens,
          SUM(estimated_cost) as estimated_cost
        FROM (
          SELECT
            DATE(we.start_time, 'localtime') as date,
            SUM(we.credits_used) as credits_used,
            COALESCE(SUM(ne_sum.tokens), 0) as total_tokens,
            0 as estimated_cost
          FROM workflow_executions we
          LEFT JOIN (
            SELECT ne.execution_id,
                   SUM(ne.input_tokens + ne.output_tokens) as tokens
            FROM node_executions ne
            INNER JOIN workflow_executions we2 ON we2.id = ne.execution_id
            WHERE we2.user_id = ? AND we2.start_time BETWEEN ? AND ?
            GROUP BY ne.execution_id
          ) ne_sum ON ne_sum.execution_id = we.id
          WHERE we.user_id = ? AND we.start_time BETWEEN ? AND ?
          GROUP BY DATE(we.start_time, 'localtime')
          UNION ALL
          SELECT
            DATE(start_time, 'localtime') as date,
            SUM(credits_used) as credits_used,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COALESCE(SUM(estimated_cost), 0) as estimated_cost
          FROM agent_executions
          WHERE user_id = ? AND start_time BETWEEN ? AND ?
          GROUP BY DATE(start_time, 'localtime')
        )
        GROUP BY date
        ORDER BY date`;

const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const eachDay = (fromYmd, toYmd) => {
  const days = [];
  for (let d = fromYmd; d <= toYmd; d = addDays(d, 1)) days.push(d);
  return days;
};

function main() {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 60000');

  // Gate: the covering index must exist or the raw 365-day queries take hours.
  const idx = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_node_executions_exec_tokens'`)
    .get();
  if (!idx) {
    console.error('ABORT: idx_node_executions_exec_tokens not built yet. Run build-activity-index.js first.');
    process.exit(2);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS daily_usage_stats (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    credits_used REAL DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, date)
  )`);

  const rawStmt = db.prepare(RAW_SQL);
  const computeRaw = (userId, s, e) => rawStmt.all(userId, s, e, userId, s, e, userId, s, e);

  const upsert = db.prepare(`
    INSERT INTO daily_usage_stats (user_id, date, credits_used, total_tokens, estimated_cost, computed_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, date) DO UPDATE SET
      credits_used = excluded.credits_used,
      total_tokens = excluded.total_tokens,
      estimated_cost = excluded.estimated_cost,
      computed_at = CURRENT_TIMESTAMP`);
  const selectCached = db.prepare(`
    SELECT date, credits_used, total_tokens, estimated_cost
    FROM daily_usage_stats
    WHERE user_id = ? AND date >= ? AND date <= ?
      AND NOT (date = ? AND computed_at < datetime('now', '-1 hour'))`);

  // Transcription of ExecutionModel._getActivityViaRollup.
  function rollupActivity(userId, startDate, endDate) {
    const reqStart = String(startDate).slice(0, 10);
    const reqEnd = String(endDate).slice(0, 10);
    const { today } = db.prepare(`SELECT DATE('now', 'localtime') AS today`).get();
    const yesterday = addDays(today, -1);

    const lastRequested = addDays(reqEnd, -1);
    const rollEnd = lastRequested < yesterday ? lastRequested : yesterday;
    const rowsByDate = new Map();
    if (reqStart <= rollEnd) {
      const cached = selectCached.all(userId, reqStart, rollEnd, yesterday);
      for (const r of cached) rowsByDate.set(r.date, r);
      const missing = eachDay(reqStart, rollEnd).filter((d) => !rowsByDate.has(d));
      if (missing.length > 0) {
        const spanStart = missing[0];
        const spanEnd = missing[missing.length - 1];
        const raw = computeRaw(userId, addDays(spanStart, -1), addDays(spanEnd, 2));
        const rawByDate = new Map(raw.map((r) => [r.date, r]));
        for (const day of missing) {
          const row = rawByDate.get(day) || { credits_used: 0, total_tokens: 0, estimated_cost: 0 };
          upsert.run(userId, day, row.credits_used || 0, row.total_tokens || 0, row.estimated_cost || 0);
          rowsByDate.set(day, {
            date: day,
            credits_used: row.credits_used || 0,
            total_tokens: row.total_tokens || 0,
            estimated_cost: row.estimated_cost || 0,
          });
        }
      }
    }

    let todayRows = [];
    if (lastRequested >= today) {
      const rawToday = computeRaw(userId, yesterday, reqEnd);
      todayRows = rawToday.filter((r) => r.date >= today);
    }

    return {
      rows: [...rowsByDate.values(), ...todayRows]
        .filter((r) => r.credits_used || r.total_tokens || r.estimated_cost)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      today,
    };
  }

  // fillMissingDates equivalent: zero-fill + clip to [startDate, endDate).
  function normalize(rows, startDate, endDate) {
    const byDate = new Map(rows.map((r) => [r.date, r]));
    return eachDay(startDate, addDays(endDate, -1)).map((d) => {
      const r = byDate.get(d) || {};
      return {
        date: d,
        credits_used: r.credits_used || 0,
        total_tokens: r.total_tokens || 0,
        estimated_cost: r.estimated_cost || 0,
      };
    });
  }

  const users = db
    .prepare(
      `SELECT user_id, COUNT(*) n FROM workflow_executions GROUP BY user_id
       UNION SELECT user_id, COUNT(*) FROM agent_executions GROUP BY user_id`
    )
    .all()
    .map((r) => r.user_id)
    .filter((v, i, a) => v && a.indexOf(v) === i);
  console.log(`users under test: ${users.length}`);

  const { today: todayStr } = db.prepare(`SELECT DATE('now', 'localtime') AS today`).get();
  const tomorrow = addDays(todayStr, 1);

  let failures = 0;
  const close = (a, b) => Math.abs((a || 0) - (b || 0)) < 1e-6;

  for (const userId of users) {
    for (const days of [7, 30, 90, 365]) {
      const startDate = addDays(todayStr, -days);
      const endDate = tomorrow; // frontend semantics: endDate = tomorrow

      const t0 = Date.now();
      const raw = computeRaw(userId, startDate, endDate);
      const tRaw = Date.now() - t0;

      const t1 = Date.now();
      const pass1 = rollupActivity(userId, startDate, endDate); // fills cache
      const tFill = Date.now() - t1;

      const t2 = Date.now();
      const pass2 = rollupActivity(userId, startDate, endDate); // must hit cache
      const tCached = Date.now() - t2;

      const nRaw = normalize(raw, startDate, endDate);
      for (const [label, res] of [['fill', pass1], ['cached', pass2]]) {
        const nRoll = normalize(res.rows, startDate, endDate);
        for (let i = 0; i < nRaw.length; i++) {
          const a = nRaw[i];
          const b = nRoll[i];
          const isToday = a.date === res.today;
          const ok =
            close(a.credits_used, b.credits_used) &&
            a.total_tokens === b.total_tokens &&
            close(a.estimated_cost, b.estimated_cost);
          if (!ok && !isToday) {
            failures++;
            console.log(
              `❌ MISMATCH user=${userId.slice(0, 8)} window=${days}d pass=${label} date=${a.date}\n` +
                `   raw:    ${JSON.stringify(a)}\n   rollup: ${JSON.stringify(b)}`
            );
          } else if (!ok && isToday) {
            console.log(
              `ℹ️ today drift (expected, live data) user=${userId.slice(0, 8)} ${days}d ${label}: ` +
                `raw=${a.credits_used.toFixed(2)}/${a.total_tokens} rollup=${b.credits_used.toFixed(2)}/${b.total_tokens}`
            );
          }
        }
      }
      console.log(
        `user=${userId.slice(0, 8)} ${String(days).padStart(3)}d: raw=${tRaw}ms fill=${tFill}ms cached=${tCached}ms rows=${raw.length}`
      );
    }
  }

  const cnt = db.prepare('SELECT COUNT(*) n FROM daily_usage_stats').get();
  console.log(`\ndaily_usage_stats rows persisted: ${cnt.n}`);
  console.log(failures === 0 ? '\n✅ ALL WINDOWS MATCH — rollup is chart-identical to raw aggregation' : `\n❌ ${failures} mismatches`);
  db.close();
  process.exit(failures === 0 ? 0 : 1);
}

main();
