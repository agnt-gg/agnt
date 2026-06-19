import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * ContractModel — refinement-type runtime invariants (PRD-091 Layer 5).
 *
 * A contract is a JSON predicate bound to a target (tool, workflow, agent,
 * skill). The predicate is checked at the execution boundary by
 * ContractsService.check(). Violations get recorded in `contract_violations`
 * and surface back as new insights via InsightEngine.
 *
 * Predicate shape (initial vocabulary — extend later):
 *   { type: 'numeric_bound', field: 'tokens', max: 50000 }
 *   { type: 'numeric_bound', field: 'duration_ms', max: 30000 }
 *   { type: 'always_succeeds', field: 'status', equals: 'completed' }
 *   { type: 'never_value', field: 'error_code', forbidden: ['rate_limited'] }
 */

class ContractModel {
  static create({ userId, targetType, targetId, name, predicate, source, confidence }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO contracts (id, user_id, target_type, target_id, name, predicate_json, source, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, userId, targetType, targetId || null, name,
          JSON.stringify(predicate || {}),
          source || 'mined',
          typeof confidence === 'number' ? confidence : 0.5,
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
      db.get('SELECT * FROM contracts WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else {
          if (row) row.predicate = row.predicate_json ? JSON.parse(row.predicate_json) : {};
          resolve(row || null);
        }
      });
    });
  }

  static findActiveByTarget(targetType, targetId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM contracts
          WHERE target_type = ? AND (target_id = ? OR target_id IS NULL) AND status = 'active'`,
        [targetType, targetId || null],
        (err, rows) => {
          if (err) reject(err);
          else {
            (rows || []).forEach((r) => { r.predicate = r.predicate_json ? JSON.parse(r.predicate_json) : {}; });
            resolve(rows || []);
          }
        }
      );
    });
  }

  static findByUserId(userId, { status, targetType, limit = 500 } = {}) {
    let q = 'SELECT * FROM contracts WHERE user_id = ?';
    const params = [userId];
    if (status) { q += ' AND status = ?'; params.push(status); }
    if (targetType) { q += ' AND target_type = ?'; params.push(targetType); }
    q += ' ORDER BY confidence DESC, created_at DESC LIMIT ?';
    params.push(limit);
    return new Promise((resolve, reject) => {
      db.all(q, params, (err, rows) => {
        if (err) reject(err);
        else {
          (rows || []).forEach((r) => { r.predicate = r.predicate_json ? JSON.parse(r.predicate_json) : {}; });
          resolve(rows || []);
        }
      });
    });
  }

  static incrementEvidence(id) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE contracts SET evidence_count = evidence_count + 1, confidence = MIN(1.0, confidence + 0.01), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
        function (err) { if (err) reject(err); else resolve(this.changes); }
      );
    });
  }

  static recordViolation({ contractId, targetType, targetId, runtimeValue, severity, sourceExecutionId }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(
          `INSERT INTO contract_violations (id, contract_id, target_type, target_id, runtime_value, severity, source_execution_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, contractId, targetType, targetId || null, runtimeValue ? JSON.stringify(runtimeValue) : null, severity || 'warn', sourceExecutionId || null],
          function (err) { if (err) reject(err); }
        );
        db.run(
          `UPDATE contracts SET violation_count = violation_count + 1, last_violation_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [contractId],
          function (err) { if (err) reject(err); else resolve(id); }
        );
      });
    });
  }

  static setStatus(id, status) {
    return new Promise((resolve, reject) => {
      db.run('UPDATE contracts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM contracts WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  static violationsForContract(contractId, limit = 100) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM contract_violations WHERE contract_id = ? ORDER BY observed_at DESC LIMIT ?',
        [contractId, limit],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });
  }
}

export default ContractModel;
