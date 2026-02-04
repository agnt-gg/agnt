import db from '../models/database/index.js';
import { VERSION_RETENTION } from '../config/versioning.js';
import zlib from 'zlib';
import { promisify } from 'util';
import { diffWorkflows } from './WorkflowManipulationService.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Workflow Version Service
 * Manages workflow version history, reverts, and retention policies
 */

class WorkflowVersionService {
  /**
   * Create a new version snapshot
   */
  static async createVersion({ workflowId, workflowState, createdBy = 'system', changeType = 'auto', changeSummary = '', toolCalls = [], isCheckpoint = false }) {
    return new Promise(async (resolve, reject) => {
      try {
        // Get current version number
        const currentVersion = await this.getCurrentVersion(workflowId);
        const nextVersionNumber = currentVersion ? currentVersion.version_number + 1 : 1;

        // Prepare workflow state
        const stateJSON = JSON.stringify(workflowState);

        // Compress if larger than threshold
        const shouldCompress = stateJSON.length > VERSION_RETENTION.COMPRESSION_THRESHOLD_BYTES;
        let storedState = stateJSON;

        if (shouldCompress) {
          const compressed = await gzip(stateJSON);
          storedState = compressed.toString('base64');
          console.log(`[Version] Compressed workflow state: ${stateJSON.length} -> ${storedState.length} bytes`);
        }

        // Insert version
        db.run(
          `INSERT INTO workflow_versions
           (workflow_id, version_number, workflow_state, created_by, change_type,
            change_summary, tool_calls, parent_version_id, is_checkpoint, is_compressed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            workflowId,
            nextVersionNumber,
            storedState,
            createdBy,
            changeType,
            changeSummary,
            JSON.stringify(toolCalls),
            currentVersion?.id || null,
            isCheckpoint ? 1 : 0,
            shouldCompress ? 1 : 0,
          ],
          function (err) {
            if (err) {
              console.error('[Version] Error creating version:', err);
              return reject(err);
            }

            const versionId = this.lastID;

            // Update current version pointer
            db.run('UPDATE workflows SET current_version_id = ? WHERE id = ?', [versionId, workflowId], (updateErr) => {
              if (updateErr) {
                console.error('[Version] Error updating current_version_id:', updateErr);
              }
            });

            console.log(`[Version] Created version ${nextVersionNumber} for workflow ${workflowId} (checkpoint: ${isCheckpoint})`);

            resolve({
              versionId,
              versionNumber: nextVersionNumber,
            });

            // Apply retention policy asynchronously (don't block)
            WorkflowVersionService.applyRetentionPolicy(workflowId).catch((policyErr) => console.error('[Version] Retention policy error:', policyErr));
          }
        );
      } catch (error) {
        console.error('[Version] Error in createVersion:', error);
        reject(error);
      }
    });
  }

  /**
   * Get current version for a workflow
   */
  static async getCurrentVersion(workflowId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM workflow_versions
         WHERE workflow_id = ?
         ORDER BY version_number DESC
         LIMIT 1`,
        [workflowId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Get all versions for a workflow
   */
  static async getVersionHistory(workflowId, options = {}) {
    const { limit = 50, offset = 0, checkpointsOnly = false } = options;

    return new Promise((resolve, reject) => {
      const whereClause = checkpointsOnly ? 'WHERE workflow_id = ? AND is_checkpoint = 1' : 'WHERE workflow_id = ?';

      db.all(
        `SELECT id, version_number, created_at, created_by, change_type,
                change_summary, is_checkpoint, parent_version_id
         FROM workflow_versions
         ${whereClause}
         ORDER BY version_number DESC
         LIMIT ? OFFSET ?`,
        checkpointsOnly ? [workflowId, limit, offset] : [workflowId, limit, offset],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get specific version by ID or number
   */
  static async getVersion(workflowId, versionIdentifier) {
    return new Promise(async (resolve, reject) => {
      const isNumber = typeof versionIdentifier === 'number';
      const query = `SELECT * FROM workflow_versions
                     WHERE workflow_id = ? AND ${isNumber ? 'version_number' : 'id'} = ?`;

      db.get(query, [workflowId, versionIdentifier], async (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);

        // Decompress if needed
        if (row.is_compressed) {
          try {
            const buffer = Buffer.from(row.workflow_state, 'base64');
            const decompressed = await gunzip(buffer);
            row.workflow_state = decompressed.toString();
          } catch (decompressErr) {
            console.error('[Version] Error decompressing version:', decompressErr);
            return reject(decompressErr);
          }
        }

        resolve(row);
      });
    });
  }

  /**
   * Revert workflow to a previous version
   */
  static async revertToVersion(workflowId, versionId) {
    const targetVersion = await this.getVersion(workflowId, versionId);

    if (!targetVersion || targetVersion.workflow_id !== workflowId) {
      throw new Error('Version not found');
    }

    const workflowState = JSON.parse(targetVersion.workflow_state);

    // Create a new version marking this as a revert
    const newVersion = await this.createVersion({
      workflowId,
      workflowState,
      createdBy: 'user',
      changeType: 'revert',
      changeSummary: `Reverted to version ${targetVersion.version_number}`,
      toolCalls: [{ tool: 'revert_workflow', versionId }],
    });

    return {
      newVersion,
      revertedToVersion: targetVersion.version_number,
      workflowState,
    };
  }

  /**
   * Create a checkpoint (user-marked important version)
   */
  static async createCheckpoint(workflowId, checkpointName, currentWorkflowState) {
    return await this.createVersion({
      workflowId,
      workflowState: currentWorkflowState,
      createdBy: 'user',
      changeType: 'checkpoint',
      changeSummary: checkpointName || 'Manual checkpoint',
      isCheckpoint: true,
    });
  }

  /**
   * Compare two versions and generate diff
   */
  static async compareVersions(workflowId, versionIdA, versionIdB) {
    const [versionA, versionB] = await Promise.all([this.getVersion(workflowId, versionIdA), this.getVersion(workflowId, versionIdB)]);

    if (!versionA || !versionB) {
      throw new Error('One or both versions not found');
    }

    const stateA = JSON.parse(versionA.workflow_state);
    const stateB = JSON.parse(versionB.workflow_state);

    return diffWorkflows(stateA, stateB);
  }

  /**
   * Apply retention policy to clean up old versions
   */
  static async applyRetentionPolicy(workflowId) {
    return new Promise((resolve, reject) => {
      // Get all versions sorted by age
      db.all(
        `SELECT id, version_number, created_at, is_checkpoint
         FROM workflow_versions
         WHERE workflow_id = ?
         ORDER BY version_number DESC`,
        [workflowId],
        async (err, allVersions) => {
          if (err) return reject(err);

          if (allVersions.length <= VERSION_RETENTION.MIN_VERSIONS_TO_KEEP) {
            return resolve(); // Don't delete if under minimum
          }

          const now = new Date();
          const keepAllUntil = new Date(now - VERSION_RETENTION.KEEP_ALL_DURATION_HOURS * 60 * 60 * 1000);

          const versionsToKeep = new Set();
          const hourlyKeeps = new Map();
          const dailyKeeps = new Map();

          allVersions.forEach((version, index) => {
            const versionDate = new Date(version.created_at);

            // Always keep checkpoints
            if (version.is_checkpoint && VERSION_RETENTION.KEEP_CHECKPOINTS_FOREVER) {
              versionsToKeep.add(version.id);
              return;
            }

            // Keep all recent versions
            if (versionDate > keepAllUntil) {
              versionsToKeep.add(version.id);
              return;
            }

            // Keep minimum recent versions
            if (index < VERSION_RETENTION.MIN_VERSIONS_TO_KEEP) {
              versionsToKeep.add(version.id);
              return;
            }

            // Apply hourly/daily retention rules
            const ageInDays = (now - versionDate) / (1000 * 60 * 60 * 24);

            if (ageInDays <= VERSION_RETENTION.KEEP_HOURLY_FOR_DAYS) {
              // Keep one per hour
              const hourKey = versionDate.toISOString().slice(0, 13);
              if (!hourlyKeeps.has(hourKey)) {
                hourlyKeeps.set(hourKey, version.id);
                versionsToKeep.add(version.id);
              }
            } else if (ageInDays <= VERSION_RETENTION.KEEP_DAILY_FOR_MONTHS * 30) {
              // Keep one per day
              const dayKey = versionDate.toISOString().slice(0, 10);
              if (!dailyKeeps.has(dayKey)) {
                dailyKeeps.set(dayKey, version.id);
                versionsToKeep.add(version.id);
              }
            }
          });

          // Collect versions to delete
          const versionsToDelete = allVersions.filter((v) => !versionsToKeep.has(v.id)).map((v) => v.id);

          // Delete old versions (batch)
          if (versionsToDelete.length > 0) {
            const placeholders = versionsToDelete.map(() => '?').join(',');
            db.run(`DELETE FROM workflow_versions WHERE id IN (${placeholders})`, versionsToDelete, (deleteErr) => {
              if (deleteErr) {
                console.error('[Version] Error deleting old versions:', deleteErr);
                return reject(deleteErr);
              }
              console.log(`[Version] Deleted ${versionsToDelete.length} old versions for workflow ${workflowId}`);
              resolve();
            });
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get storage stats for a workflow
   */
  static async getStorageStats(workflowId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
           COUNT(*) as total_versions,
           SUM(LENGTH(workflow_state)) as total_bytes,
           MIN(created_at) as oldest_version,
           MAX(created_at) as newest_version,
           SUM(is_checkpoint) as checkpoint_count
         FROM workflow_versions
         WHERE workflow_id = ?`,
        [workflowId],
        (err, stats) => {
          if (err) return reject(err);

          resolve({
            totalVersions: stats?.total_versions || 0,
            totalSizeBytes: stats?.total_bytes || 0,
            totalSizeMB: ((stats?.total_bytes || 0) / 1024 / 1024).toFixed(2),
            oldestVersion: stats?.oldest_version,
            newestVersion: stats?.newest_version,
            checkpointCount: stats?.checkpoint_count || 0,
          });
        }
      );
    });
  }

  /**
   * Delete all versions for a workflow (called when workflow is deleted)
   */
  static async deleteAllVersions(workflowId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM workflow_versions WHERE workflow_id = ?', [workflowId], function (err) {
        if (err) return reject(err);
        console.log(`[Version] Deleted all versions for workflow ${workflowId}`);
        resolve(this.changes);
      });
    });
  }
}

export default WorkflowVersionService;
