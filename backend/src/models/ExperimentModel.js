import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class ExperimentModel {
  // ==================== EXPERIMENTS ====================

  static create(userId, { name, hypothesis, type, sourceGoalId, benchmarkId, skillId, evalDatasetId, config }) {
    const id = generateUUID();
    const createdAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO experiments (id, user_id, name, hypothesis, status, type, benchmark_id, skill_id, source_goal_id, eval_dataset_id, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, hypothesis || null, type || 'ab_test', benchmarkId || null, skillId || null, sourceGoalId || null, evalDatasetId || null, JSON.stringify(config || {}), createdAt, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM experiments WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else if (row) {
          row.config = JSON.parse(row.config || '{}');
          resolve(row);
        } else {
          resolve(null);
        }
      });
    });
  }

  static findByUserId(userId, { status, limit } = {}) {
    let query = `SELECT * FROM experiments WHERE user_id = ?`;
    const params = [userId];
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC`;
    if (limit) {
      query += ` LIMIT ?`;
      params.push(limit);
    }
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else {
          (rows || []).forEach((row) => {
            row.config = JSON.parse(row.config || '{}');
          });
          resolve(rows || []);
        }
      });
    });
  }

  static updateStatus(id, status, completedAt = null) {
    const updatedAt = new Date().toISOString();
    const finalCompletedAt = completedAt || (status === 'completed' || status === 'failed' ? updatedAt : null);
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE experiments SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        [status, finalCompletedAt, updatedAt, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM experiments WHERE id = ? AND user_id = ?`, [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  // ==================== EXPERIMENT RUNS ====================

  static createRun(experimentId, variant, evalExampleIndex) {
    const id = generateUUID();
    const createdAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO experiment_runs (id, experiment_id, variant, eval_example_index, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
        [id, experimentId, variant, evalExampleIndex, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findRunsByExperiment(experimentId, { variant } = {}) {
    let query = `SELECT * FROM experiment_runs WHERE experiment_id = ?`;
    const params = [experimentId];
    if (variant) {
      query += ` AND variant = ?`;
      params.push(variant);
    }
    query += ` ORDER BY eval_example_index ASC, variant ASC`;
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else {
          (rows || []).forEach((row) => {
            row.metrics = JSON.parse(row.metrics || '{}');
          });
          resolve(rows || []);
        }
      });
    });
  }

  static updateRunStatus(id, status, startedAt = null, completedAt = null) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE experiment_runs SET status = ?, started_at = COALESCE(?, started_at), completed_at = COALESCE(?, completed_at) WHERE id = ?`,
        [status, startedAt, completedAt, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateRunMetrics(id, metrics, evaluationScore, evaluationPassed, judgeFeedback) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE experiment_runs SET metrics = ?, evaluation_score = ?, evaluation_passed = ?, judge_feedback = ? WHERE id = ?`,
        [JSON.stringify(metrics || {}), evaluationScore, evaluationPassed, judgeFeedback || null, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateRunGoalId(id, goalId) {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE experiment_runs SET goal_id = ? WHERE id = ?`, [goalId, id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  // ==================== EXPERIMENT RESULTS ====================

  static createResult(experimentId, { iteration, controlAvgSes, treatmentAvgSes, delta, confidence, perDimension, constraintResults, decision, analysis }) {
    const id = generateUUID();
    const createdAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO experiment_results (id, experiment_id, iteration, control_avg_ses, treatment_avg_ses, delta, confidence, per_dimension, constraint_results, decision, analysis, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, experimentId, iteration || 1, controlAvgSes, treatmentAvgSes, delta, confidence, JSON.stringify(perDimension || {}), JSON.stringify(constraintResults || []), decision, JSON.stringify(analysis || {}), createdAt],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findByExperiment(experimentId) {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM experiment_results WHERE experiment_id = ? ORDER BY iteration ASC`, [experimentId], (err, rows) => {
        if (err) reject(err);
        else {
          (rows || []).forEach((row) => {
            row.per_dimension = JSON.parse(row.per_dimension || '{}');
            row.constraint_results = JSON.parse(row.constraint_results || '[]');
            row.analysis = JSON.parse(row.analysis || '{}');
          });
          resolve(rows || []);
        }
      });
    });
  }

  static findLatest(experimentId) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM experiment_results WHERE experiment_id = ? ORDER BY iteration DESC LIMIT 1`, [experimentId], (err, row) => {
        if (err) reject(err);
        else if (row) {
          row.per_dimension = JSON.parse(row.per_dimension || '{}');
          row.constraint_results = JSON.parse(row.constraint_results || '[]');
          row.analysis = JSON.parse(row.analysis || '{}');
          resolve(row);
        } else {
          resolve(null);
        }
      });
    });
  }

  // ==================== EVAL DATASETS ====================

  static createDataset(userId, { name, skillId, category, source, items, splitConfig }) {
    const id = generateUUID();
    const createdAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO eval_datasets (id, user_id, name, skill_id, category, source, items, split_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, name, skillId || null, category || null, source || 'synthetic', JSON.stringify(items || []), JSON.stringify(splitConfig || { trainRatio: 0.6, valRatio: 0.2, holdoutRatio: 0.2 }), createdAt, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findDataset(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM eval_datasets WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else if (row) {
          row.items = JSON.parse(row.items || '[]');
          row.split_config = JSON.parse(row.split_config || '{}');
          resolve(row);
        } else {
          resolve(null);
        }
      });
    });
  }

  static findDatasetsByUserId(userId, { skillId, category } = {}) {
    let query = `SELECT * FROM eval_datasets WHERE user_id = ?`;
    const params = [userId];
    if (skillId) {
      query += ` AND skill_id = ?`;
      params.push(skillId);
    }
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    query += ` ORDER BY created_at DESC`;
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else {
          (rows || []).forEach((row) => {
            row.items = JSON.parse(row.items || '[]');
            row.split_config = JSON.parse(row.split_config || '{}');
          });
          resolve(rows || []);
        }
      });
    });
  }

  static updateDataset(id, { items, splitConfig }) {
    const updatedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE eval_datasets SET items = ?, split_config = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(items || []), JSON.stringify(splitConfig || {}), updatedAt, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static deleteDataset(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM eval_datasets WHERE id = ? AND user_id = ?`, [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default ExperimentModel;
