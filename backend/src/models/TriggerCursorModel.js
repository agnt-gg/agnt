import db from './database/index.js';

/**
 * Durable read positions for trigger sources that have no per-workflow row of
 * their own (the account inbox is shared by every Receive Email workflow).
 * Webhooks keep theirs on the `webhooks` row instead.
 *
 * Without this, a receiver's position lived only in memory and restarted at
 * "now" on every boot - so a hosted instance that slept, or a desktop that was
 * closed, silently skipped every message that arrived in between.
 */
class TriggerCursorModel {
  /** The stored position for `source`, or null if none has been recorded. */
  static get(source) {
    return new Promise((resolve, reject) => {
      db.get('SELECT cursor FROM trigger_cursors WHERE source = ?', [source], (err, row) => {
        if (err) reject(err);
        else resolve(row ? Number(row.cursor) : null);
      });
    });
  }

  /** Advance the position. Monotonic: never moves backwards. */
  static save(source, cursor) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO trigger_cursors (source, cursor, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(source) DO UPDATE SET cursor = MAX(cursor, excluded.cursor), updated_at = CURRENT_TIMESTAMP`,
        [source, cursor],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }
}

export default TriggerCursorModel;
