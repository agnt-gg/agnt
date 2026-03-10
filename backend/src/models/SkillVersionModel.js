import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

class SkillVersionModel {
  /**
   * Create a new skill version record
   */
  static create({ skillId, userId, version, instructions, instructionsDiff, effectivenessScore, parentVersionId, sourceGoalId, traceAnalysisSummary, status = 'active' }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO skill_versions (id, skill_id, user_id, version, instructions, instructions_diff, effectiveness_score, parent_version_id, source_goal_id, trace_analysis_summary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, skillId, userId, version, instructions, instructionsDiff || null, effectivenessScore || null, parentVersionId || null, sourceGoalId || null, traceAnalysisSummary || null, status],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Get all versions of a skill, ordered by version ASC
   */
  static findBySkillId(skillId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version ASC`,
        [skillId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get the latest active version of a skill
   */
  static findLatest(skillId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM skill_versions WHERE skill_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1`,
        [skillId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Get a specific version by ID
   */
  static findById(versionId) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM skill_versions WHERE id = ?`, [versionId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Mark a version as superseded (replaced by a newer version)
   */
  static supersede(versionId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE skill_versions SET status = 'superseded', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [versionId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Get full version lineage for a skill (all versions with parent chain)
   */
  static getLineage(skillId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT id, skill_id, version, effectiveness_score, parent_version_id, source_goal_id, status, created_at
         FROM skill_versions WHERE skill_id = ? ORDER BY version ASC`,
        [skillId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get SES progression over versions for a skill
   */
  static getEvolutionStats(skillId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT version, effectiveness_score, status, created_at
         FROM skill_versions WHERE skill_id = ? AND effectiveness_score IS NOT NULL ORDER BY version ASC`,
        [skillId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get the next version number for a skill
   */
  static getNextVersion(skillId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT MAX(version) as max_version FROM skill_versions WHERE skill_id = ?`,
        [skillId],
        (err, row) => {
          if (err) reject(err);
          else resolve((row?.max_version || 0) + 1);
        }
      );
    });
  }
}

export default SkillVersionModel;
