import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * ScheduleModel — durable cron schedules (PRD-091 Layer 1, the Clock).
 *
 * A schedule binds a target (currently only `goal`) to a cron expression.
 * SchedulerService ticks every 60s and fires anything where next_run <= now.
 */
class ScheduleModel {
  static create({ userId, targetType, targetId, cron, timezone, nextRun, enabled, onMissed }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO schedules (id, user_id, target_type, target_id, cron, timezone, next_run, enabled, on_missed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          targetType,
          targetId,
          cron,
          timezone || 'UTC',
          nextRun ? new Date(nextRun).toISOString() : null,
          enabled === false ? 0 : 1,
          onMissed || 'fire_once',
        ],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM schedules WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  static findByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static findByTarget(targetType, targetId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM schedules WHERE target_type = ? AND target_id = ?', [targetType, targetId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Find all enabled schedules whose next_run is now or in the past.
   * Used by the scheduler tick.
   */
  static findDue(asOf = new Date()) {
    const cutoff = asOf.toISOString();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM schedules WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?`,
        [cutoff],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static findEnabled() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM schedules WHERE enabled = 1', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static updateAfterRun(id, { lastRun, nextRun, status, error }) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE schedules
         SET last_run = ?, next_run = ?, last_status = ?, last_error = ?, run_count = run_count + 1
         WHERE id = ?`,
        [
          lastRun ? new Date(lastRun).toISOString() : null,
          nextRun ? new Date(nextRun).toISOString() : null,
          status || null,
          error || null,
          id,
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateNextRun(id, nextRun) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE schedules SET next_run = ? WHERE id = ?`,
        [nextRun ? new Date(nextRun).toISOString() : null, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static setEnabled(id, enabled) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE schedules SET enabled = ? WHERE id = ?`,
        [enabled ? 1 : 0, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateCron(id, { cron, timezone, nextRun, onMissed }) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE schedules
         SET cron = COALESCE(?, cron),
             timezone = COALESCE(?, timezone),
             next_run = COALESCE(?, next_run),
             on_missed = COALESCE(?, on_missed)
         WHERE id = ?`,
        [
          cron || null,
          timezone || null,
          nextRun ? new Date(nextRun).toISOString() : null,
          onMissed || null,
          id,
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM schedules WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static recordRun({ scheduleId, targetType, targetId, runTargetId, status, error }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO schedule_runs (id, schedule_id, target_type, target_id, run_target_id, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, scheduleId, targetType, targetId, runTargetId || null, status || 'fired', error || null],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findRunHistory(scheduleId, limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY fired_at DESC LIMIT ?`,
        [scheduleId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }
}

export default ScheduleModel;
