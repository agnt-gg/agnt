import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * EvolutionPerformanceSnapshotModel
 *
 * Stores lightweight time-series snapshots of "how well is the system doing".
 * This is deliberately *not* an authority layer; it's telemetry that can power
 * meta-cognitive assessment + genetic search.
 */
class EvolutionPerformanceSnapshotModel {
  static create({ userId, scope = 'user', targetType = null, targetId = null, metrics = {}, score = null, notes = null } = {}) {
    const id = generateUUID();
    const metricsJson = JSON.stringify(metrics || {});
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO evolution_performance_snapshots
          (id, user_id, scope, target_type, target_id, score, metrics_json, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          id,
          userId,
          scope,
          targetType,
          targetId,
          typeof score === 'number' ? score : null,
          metricsJson,
          notes,
        ],
        (err) => err ? reject(err) : resolve(id)
      );
    });
  }

  static findRecentByUser(userId, { scope = null, limit = 200 } = {}) {
    const params = [userId];
    let q = `SELECT * FROM evolution_performance_snapshots WHERE user_id = ?`;
    if (scope) { q += ' AND scope = ?'; params.push(scope); }
    q += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return new Promise((resolve, reject) => {
      db.all(q, params, (err, rows) => {
        if (err) return reject(err);
        const parsed = (rows || []).map((r) => {
          let metrics = {};
          try { metrics = r.metrics_json ? JSON.parse(r.metrics_json) : {}; } catch {}
          return { ...r, metrics };
        });
        resolve(parsed);
      });
    });
  }
}

export default EvolutionPerformanceSnapshotModel;
