/**
 * tenant_due_work — the ONE answer to "does this instance have work, and when?"
 *
 * WHY A VIEW, AND WHY THE APP OWNS IT
 * -----------------------------------
 * A hosted instance is stopped when idle. The fleet (agnt-server
 * infra/hetzner/fleet: work-due.py while asleep, sleeper.sh busy_reason while
 * awake) decides when to wake it and when it may sleep, by reading this
 * database from outside. It used to keep its own hand-written list of "tables
 * that mean work", in two places that had already drifted apart, and every
 * clock that lived only in memory — the Timer Trigger above all — was invisible
 * to it. A timer set to every 15 minutes ran twice per human visit and never
 * otherwise.
 *
 * Now the app says what work is, here, and the fleet asks only this view. A new
 * kind of work is an app change; the fleet does not have to learn about it.
 *
 * THE CONTRACT (agnt-server/infra/hetzner/fleet/bin/due-work.sql reads it)
 *   source  TEXT     what produced the row ('trigger', 'schedule', ...)
 *   ref     TEXT     which one, for the log line
 *   kind    TEXT     'due'        has a future time; wake/keep only when near
 *                    'resumable'  resumes by itself on boot; wake for it
 *                    'in_flight'  dies with the container; keep awake, never wake
 *   due_at  INTEGER  unix epoch SECONDS
 * Changing a column's meaning breaks a deployed fleet. Add columns; never repurpose.
 *
 * Built from the tables that EXIST when it is built. sqlite accepts a view over
 * a missing table and then fails every SELECT from it, and conversation_work
 * only exists on installs that opted into chat continuity. So the view is
 * rebuilt on every boot, and again when an optional table is created.
 */

const OPTIONAL_BRANCHES = {
  conversation_work: `
    SELECT 'conversation' AS source, id AS ref, 'due' AS kind, CAST(next_wake / 1000 AS INTEGER) AS due_at
      FROM conversation_work WHERE status IN ('queued', 'retry_wait')
    UNION ALL
    SELECT 'conversation', id, 'resumable', CAST(strftime('%s', 'now') AS INTEGER)
      FROM conversation_work WHERE status = 'running'`,
};

// strftime('%s', x) reads both formats the app writes: sqlite's own
// '2026-08-22 02:06:00' and ISO '2026-08-22T02:06:00.000Z'. Comparing those as
// TEXT once blinded the fleet to every schedule the app had ever fired.
//
// workflow_run: a run left open by a crash is swept at boot; the two-hour cap
// keeps one that somehow survives from pinning the instance awake for ever.
const CORE_BRANCHES = `
    SELECT 'trigger' AS source, tw.workflow_id || ':' || tw.node_id AS ref, 'due' AS kind,
           CAST(tw.next_fire_at / 1000 AS INTEGER) AS due_at
      FROM trigger_wakes tw
      JOIN workflows w ON w.id = tw.workflow_id
     WHERE w.status IN ('listening', 'running', 'queued')
    UNION ALL
    SELECT 'schedule', id, 'due', CAST(strftime('%s', next_run) AS INTEGER)
      FROM schedules WHERE enabled = 1 AND next_run IS NOT NULL
    UNION ALL
    SELECT 'goal', id, 'resumable', CAST(strftime('%s', 'now') AS INTEGER)
      FROM goals WHERE status = 'executing'
    UNION ALL
    SELECT 'task', id, 'in_flight', CAST(strftime('%s', 'now') AS INTEGER)
      FROM tasks WHERE status IN ('running', 'assigned')
    UNION ALL
    SELECT 'workflow_run', id, 'in_flight', CAST(strftime('%s', 'now') AS INTEGER)
      FROM workflow_executions
     WHERE end_time IS NULL AND status IN ('started', 'running')
       AND datetime(start_time) >= datetime('now', '-2 hours')`;

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => database.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

function exec(database, sql) {
  return new Promise((resolve, reject) => database.exec(sql, (err) => (err ? reject(err) : resolve())));
}

export async function buildDueWorkViewSql(database) {
  const rows = await all(database, "SELECT name FROM sqlite_master WHERE type = 'table'");
  const tables = new Set(rows.map((row) => row.name));
  const optional = Object.entries(OPTIONAL_BRANCHES)
    .filter(([table]) => tables.has(table))
    .map(([, sql]) => sql);
  return `CREATE VIEW tenant_due_work AS ${[CORE_BRANCHES, ...optional].join('\n    UNION ALL')}`;
}

/** Drop and recreate, in one transaction, so a reader never sees it missing. */
export async function refreshDueWorkView(database) {
  const createSql = await buildDueWorkViewSql(database);
  await exec(database, `BEGIN IMMEDIATE; DROP VIEW IF EXISTS tenant_due_work; ${createSql}; COMMIT;`).catch(async (error) => {
    await exec(database, 'ROLLBACK').catch(() => {});
    throw error;
  });
}
