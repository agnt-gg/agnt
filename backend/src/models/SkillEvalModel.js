import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class SkillEvalModel {
  /**
   * Record an A/B test evaluation result
   */
  static create({ skillId, skillVersionId, userId, sourceGoalId, baselineSes, baselineCompletion, baselineToolCalls, baselineErrors, baselineDurationMs, treatmentSes, treatmentCompletion, treatmentToolCalls, treatmentErrors, treatmentDurationMs, delta, decision, traceAnalysis, judgeReasoning }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO skill_evaluations (id, skill_id, skill_version_id, user_id, source_goal_id, baseline_ses, baseline_completion, baseline_tool_calls, baseline_errors, baseline_duration_ms, treatment_ses, treatment_completion, treatment_tool_calls, treatment_errors, treatment_duration_ms, delta, decision, trace_analysis, judge_reasoning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, skillId, skillVersionId || null, userId, sourceGoalId, baselineSes, baselineCompletion, baselineToolCalls, baselineErrors, baselineDurationMs, treatmentSes, treatmentCompletion, treatmentToolCalls, treatmentErrors, treatmentDurationMs, delta, decision, traceAnalysis ? JSON.stringify(traceAnalysis) : null, judgeReasoning || null],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Get all evaluations for a specific skill
   */
  static findBySkillId(skillId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skill_evaluations WHERE skill_id = ? ORDER BY created_at DESC`,
        [skillId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get all evaluations originating from a specific goal
   */
  static findByGoalId(goalId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skill_evaluations WHERE source_goal_id = ? ORDER BY created_at DESC`,
        [goalId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get all evaluations for a user
   */
  static findByUserId(userId, limit = 50) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skill_evaluations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Calculate win rate for a skill (% of evals where delta > threshold)
   */
  static getWinRate(skillId, threshold = 2.0) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN delta > ? THEN 1 ELSE 0 END) as wins
         FROM skill_evaluations WHERE skill_id = ?`,
        [threshold, skillId],
        (err, row) => {
          if (err) reject(err);
          else {
            const total = row?.total || 0;
            const wins = row?.wins || 0;
            resolve(total > 0 ? wins / total : 0);
          }
        }
      );
    });
  }

  /**
   * Get average SES delta for a skill
   */
  static getAverageDelta(skillId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT AVG(delta) as avg_delta FROM skill_evaluations WHERE skill_id = ?`,
        [skillId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.avg_delta || 0);
        }
      );
    });
  }

  /**
   * Get leaderboard: top skills by average SES delta
   */
  static getLeaderboard(userId, limit = 20) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT
           se.skill_id,
           s.name as skill_name,
           s.category,
           COUNT(*) as total_evaluations,
           AVG(se.delta) as avg_delta,
           SUM(CASE WHEN se.delta > 2.0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as win_rate,
           MAX(se.treatment_ses) as best_ses,
           MAX(se.created_at) as last_eval_date
         FROM skill_evaluations se
         JOIN skills s ON s.id = se.skill_id
         WHERE se.user_id = ?
         GROUP BY se.skill_id
         ORDER BY avg_delta DESC
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }
}

export default SkillEvalModel;
