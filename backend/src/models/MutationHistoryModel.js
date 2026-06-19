import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * MutationHistoryModel — provenance + revertable history of router-applied
 * mutations (PRD-091 Layer 7).
 */
class MutationHistoryModel {
  static create({ userId, insightId, targetType, targetId, appliedVia, snapshotKind, snapshotRef, fitnessBefore, fitnessAfter, delta, status, notes }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO mutation_history
           (id, user_id, insight_id, target_type, target_id, applied_via, snapshot_kind, snapshot_ref, fitness_before, fitness_after, delta, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, userId, insightId || null, targetType, targetId || null,
          appliedVia || 'router',
          snapshotKind || null, snapshotRef || null,
          typeof fitnessBefore === 'number' ? fitnessBefore : null,
          typeof fitnessAfter === 'number' ? fitnessAfter : null,
          typeof delta === 'number' ? delta : null,
          status || 'applied',
          notes || null,
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
      db.get('SELECT * FROM mutation_history WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  static findByUserId(userId, { status, targetType, limit = 200 } = {}) {
    let q = 'SELECT * FROM mutation_history WHERE user_id = ?';
    const params = [userId];
    if (status) { q += ' AND status = ?'; params.push(status); }
    if (targetType) { q += ' AND target_type = ?'; params.push(targetType); }
    q += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return new Promise((resolve, reject) => {
      db.all(q, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static findByTarget(targetType, targetId, limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM mutation_history WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT ?`,
        [targetType, targetId, limit],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
  }

  static findByInsight(insightId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM mutation_history WHERE insight_id = ? ORDER BY created_at DESC`,
        [insightId],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
  }

  static updateFitnessAfter(id, fitnessAfter, delta) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE mutation_history SET fitness_after = ?, delta = ? WHERE id = ?`,
        [typeof fitnessAfter === 'number' ? fitnessAfter : null, typeof delta === 'number' ? delta : null, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static markReverted(id, reason) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE mutation_history SET status = 'reverted', reverted_at = CURRENT_TIMESTAMP, revert_reason = ? WHERE id = ?`,
        [reason || null, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static setStatus(id, status) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE mutation_history SET status = ? WHERE id = ?`, [status, id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default MutationHistoryModel;
