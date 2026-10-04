/** Additive only: legacy evidence and user assets are never reclassified or deleted. */
export async function initializeLearningSchema(db) {
  const run = sql => new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
  const tables = [
    `CREATE TABLE IF NOT EXISTS learning_work (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      state TEXT NOT NULL, verification TEXT NOT NULL DEFAULT 'unknown', revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id,source_type,source_id))`,
    `CREATE TABLE IF NOT EXISTS learning_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, work_id TEXT NOT NULL, event_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, capability TEXT, outcome TEXT,
      error_kind TEXT, trial_id TEXT, occurred_at INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL, UNIQUE(user_id,event_key))`,
    `CREATE TABLE IF NOT EXISTS learning_findings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, signature TEXT NOT NULL, capability TEXT NOT NULL,
      error_kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'detected', revision INTEGER NOT NULL DEFAULT 1,
      first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, UNIQUE(user_id,signature))`,
    `CREATE TABLE IF NOT EXISTS learning_trials (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, finding_id TEXT NOT NULL, candidate_json TEXT NOT NULL,
      candidate_hash TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      baseline_json TEXT NOT NULL, result_json TEXT, started_at INTEGER NOT NULL, review_due_at INTEGER NOT NULL,
      minimum_samples INTEGER NOT NULL, approved_at INTEGER NOT NULL, ended_at INTEGER)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS learning_one_open_trial ON learning_trials(user_id,finding_id)
      WHERE state IN ('watching','active')`,
    `CREATE TABLE IF NOT EXISTS learning_policies (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trial_id TEXT NOT NULL UNIQUE, capability TEXT NOT NULL,
      error_kind TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL,
      candidate_json TEXT NOT NULL, candidate_hash TEXT NOT NULL, activated_at INTEGER NOT NULL,
      UNIQUE(user_id,trial_id))`,
    `CREATE TABLE IF NOT EXISTS learning_settings (
      user_id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS learning_cursors (source_type TEXT PRIMARY KEY, last_seen_at TEXT NOT NULL, last_id TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS learning_health (source TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_failure_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS learning_events_scope ON learning_events(user_id,capability,occurred_at)`,
    `CREATE INDEX IF NOT EXISTS learning_events_trial ON learning_events(user_id,trial_id,occurred_at)`,
    `CREATE INDEX IF NOT EXISTS learning_due_reviews ON learning_trials(state,review_due_at)`,
  ];
  for (const sql of tables) await run(sql);
}
