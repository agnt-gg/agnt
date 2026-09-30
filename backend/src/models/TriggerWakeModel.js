import db, { dbRunWithRetry } from './database/index.js';

/**
 * trigger_wakes — a trigger's next fire time, written down.
 *
 * One row per (workflow, trigger node). The Timer Trigger writes next_fire_at
 * BEFORE it fires, so a restart at any instant resumes on the same schedule,
 * and the fleet can read it (via tenant_due_work) to wake a sleeping instance
 * in time. anchor_at fixes the phase of fixed intervals; schedule_key is what
 * the row was computed for, so a row from an older configuration is ignored
 * rather than trusted.
 *
 * Rows are deleted when the USER stops the workflow, never when the process
 * stops: a fleet sleep must leave them in place, that is the point.
 */
class TriggerWakeModel {
  static get(workflowId, nodeId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM trigger_wakes WHERE workflow_id = ? AND node_id = ?', [workflowId, nodeId], (err, row) =>
        err ? reject(err) : resolve(row || null)
      );
    });
  }

  static upsert({ workflowId, nodeId, triggerType, nextFireAt, anchorAt, scheduleKey, cursor = null }) {
    return dbRunWithRetry(
      () =>
        new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO trigger_wakes (workflow_id, node_id, trigger_type, next_fire_at, anchor_at, schedule_key, cursor, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(workflow_id, node_id) DO UPDATE SET
               trigger_type = excluded.trigger_type, next_fire_at = excluded.next_fire_at,
               anchor_at = excluded.anchor_at, schedule_key = excluded.schedule_key,
               cursor = excluded.cursor, updated_at = excluded.updated_at`,
            [workflowId, nodeId, triggerType, nextFireAt, anchorAt, scheduleKey, cursor, Date.now()],
            (err) => (err ? reject(err) : resolve())
          );
        })
    );
  }

  static deleteForWorkflow(workflowId) {
    return dbRunWithRetry(
      () =>
        new Promise((resolve, reject) => {
          db.run('DELETE FROM trigger_wakes WHERE workflow_id = ?', [workflowId], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          });
        })
    );
  }
}

export default TriggerWakeModel;
