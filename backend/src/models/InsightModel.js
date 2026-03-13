import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * InsightModel — CRUD for the insights table.
 * Insights are discrete observations extracted from execution traces
 * that can be applied to improve any asset (agent, skill, workflow, tool).
 */
class InsightModel {
  /**
   * Create a new insight.
   */
  static create({ userId, sourceType, sourceId, sourceContext, targetType, targetId, category, title, description, evidence, confidence }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO insights (id, user_id, source_type, source_id, source_context, target_type, target_id, category, title, description, evidence, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, sourceType, sourceId, sourceContext ? JSON.stringify(sourceContext) : null, targetType, targetId, category, title, description, evidence ? JSON.stringify(evidence) : null, confidence || 0.5],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Find a single insight by ID.
   */
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM insights WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else {
          if (row) {
            row.source_context = row.source_context ? JSON.parse(row.source_context) : null;
            row.evidence = row.evidence ? JSON.parse(row.evidence) : null;
            row.applied_result = row.applied_result ? JSON.parse(row.applied_result) : null;
          }
          resolve(row || null);
        }
      });
    });
  }

  /**
   * Find all insights for a user, with optional filters.
   */
  static findByUserId(userId, { targetType, targetId, status, category, limit = 1000 } = {}) {
    let query = 'SELECT * FROM insights WHERE user_id = ?';
    const params = [userId];

    if (targetType) { query += ' AND target_type = ?'; params.push(targetType); }
    if (targetId) { query += ' AND target_id = ?'; params.push(targetId); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (category) { query += ' AND category = ?'; params.push(category); }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else {
          (rows || []).forEach(row => {
            row.source_context = row.source_context ? JSON.parse(row.source_context) : null;
            row.evidence = row.evidence ? JSON.parse(row.evidence) : null;
            row.applied_result = row.applied_result ? JSON.parse(row.applied_result) : null;
          });
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Find insights targeting a specific asset.
   */
  static findByTarget(targetType, targetId, { status, limit = 50 } = {}) {
    let query = 'SELECT * FROM insights WHERE target_type = ? AND target_id = ?';
    const params = [targetType, targetId];

    if (status) { query += ' AND status = ?'; params.push(status); }

    query += ' ORDER BY confidence DESC, created_at DESC LIMIT ?';
    params.push(limit);

    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else {
          (rows || []).forEach(row => {
            row.source_context = row.source_context ? JSON.parse(row.source_context) : null;
            row.evidence = row.evidence ? JSON.parse(row.evidence) : null;
            row.applied_result = row.applied_result ? JSON.parse(row.applied_result) : null;
          });
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Find an existing insight for deduplication.
   * Matches on target + category + similar title.
   */
  static findDuplicate(userId, targetType, targetId, category, title) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM insights WHERE user_id = ? AND target_type = ? AND target_id = ? AND category = ? AND title = ? AND status != 'superseded'`,
        [userId, targetType, targetId, category, title],
        (err, row) => {
          if (err) reject(err);
          else {
            if (row) {
              row.source_context = row.source_context ? JSON.parse(row.source_context) : null;
              row.evidence = row.evidence ? JSON.parse(row.evidence) : null;
              row.applied_result = row.applied_result ? JSON.parse(row.applied_result) : null;
            }
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Reinforce an existing insight (bump count, confidence, last_seen).
   */
  static reinforce(id) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE insights SET occurrence_count = occurrence_count + 1, confidence = MIN(1.0, confidence + 0.1), last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Update insight status (apply, reject, supersede).
   */
  static updateStatus(id, status, appliedResult = null) {
    const appliedAt = status === 'applied' ? new Date().toISOString() : null;
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE insights SET status = ?, applied_at = COALESCE(?, applied_at), applied_result = COALESCE(?, applied_result) WHERE id = ?`,
        [status, appliedAt, appliedResult ? JSON.stringify(appliedResult) : null, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Get counts by status for a user.
   */
  static getStatusCounts(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT status, COUNT(*) as count FROM insights WHERE user_id = ? GROUP BY status`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else {
            const counts = { pending: 0, applied: 0, rejected: 0, superseded: 0 };
            (rows || []).forEach(r => { counts[r.status] = r.count; });
            resolve(counts);
          }
        }
      );
    });
  }

  /**
   * Get counts grouped by target_type for a user.
   */
  static getTargetTypeCounts(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT target_type, COUNT(*) as count FROM insights WHERE user_id = ? AND status = 'pending' GROUP BY target_type`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else {
            const counts = {};
            (rows || []).forEach(r => { counts[r.target_type] = r.count; });
            resolve(counts);
          }
        }
      );
    });
  }

  /**
   * Find insights by source (execution that generated them).
   */
  static findBySource(sourceType, sourceId, { limit = 50 } = {}) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM insights WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC LIMIT ?',
        [sourceType, sourceId, limit],
        (err, rows) => {
          if (err) reject(err);
          else {
            (rows || []).forEach(row => {
              row.source_context = row.source_context ? JSON.parse(row.source_context) : null;
              row.evidence = row.evidence ? JSON.parse(row.evidence) : null;
              row.applied_result = row.applied_result ? JSON.parse(row.applied_result) : null;
            });
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Delete an insight.
   */
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM insights WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default InsightModel;
