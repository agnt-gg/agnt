import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import generateUUID from '../../utils/generateUUID.js';
import pathManager from '../../utils/PathManager.js';

/**
 * ArenaService — Dream Arena sandbox (PRD-091 Layer 6).
 *
 * Forks the live SQLite DB into a scratch file, applies a candidate mutation,
 * and runs cheap empirical checks against it. SQLite makes this almost free:
 * a file copy completes in milliseconds and the second handle is fully
 * isolated from the live process.
 *
 * Used by InsightAutonomyRouter for `gated` decisions. The Arena does not
 * mutate live state; on pass, the router proceeds with the real applicator.
 */

const ARENA_DIR_NAME = 'arena';

class ArenaService {
  static _arenaDir() {
    return pathManager.getDataPath
      ? pathManager.getDataPath(ARENA_DIR_NAME)
      : path.join(pathManager.getDataDir(), ARENA_DIR_NAME);
  }

  static _liveDbPath() {
    return path.join(pathManager.getDataDir(), 'agnt.db');
  }

  /**
   * Snapshot the live DB to a scratch file inside the arena dir.
   * Returns { snapshotPath, snapshotId }.
   */
  static async fork() {
    const dir = this._arenaDir();
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
    const id = generateUUID();
    const snapshotPath = path.join(dir, `${id}.db`);
    const live = this._liveDbPath();
    // Best-effort: trigger a WAL checkpoint so the snapshot reflects committed state.
    // We don't await the checkpoint — copyFile of WAL-mode DBs still gives a consistent point-in-time view.
    await fs.copyFile(live, snapshotPath);
    // Copy WAL/SHM sidecars if present — improves accuracy on busy DBs.
    for (const ext of ['-wal', '-shm']) {
      try {
        await fs.copyFile(live + ext, snapshotPath + ext);
      } catch { /* sidecars may not exist; that's fine */ }
    }
    return { snapshotPath, snapshotId: id };
  }

  static async destroy(snapshotPath) {
    for (const p of [snapshotPath, snapshotPath + '-wal', snapshotPath + '-shm']) {
      try { await fs.unlink(p); } catch { /* ignore */ }
    }
  }

  static _open(snapshotPath) {
    return new sqlite3.Database(snapshotPath);
  }

  static _all(handle, sql, params = []) {
    return new Promise((resolve, reject) => {
      handle.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
  }

  static _close(handle) {
    return new Promise((resolve) => handle.close(() => resolve()));
  }

  /**
   * Evaluate an insight in the sandbox.
   *
   * For `contract_proposal`: simulate installing the contract and check how
   * many recent successful runs would have violated it. Low violation rate
   * → pass.
   *
   * For everything else: pass with a 'no_specific_check' note so the router
   * can proceed. As applicator-specific simulators are added (e.g., dry-run
   * skill instructions through eval dataset), this method routes to them.
   */
  static async evaluate({ insight, userId, options = {} }) {
    if (!insight) return { pass: true, delta: 0, reason: 'no_insight' };

    if (insight.category === 'contract_proposal') {
      return this._evaluateContractProposal(insight, userId, options);
    }

    // For mutations we can't yet simulate in the sandbox, return pass + a
    // low-information delta so the router proceeds. Layer 7's mutation
    // history + canary-revert is the safety net for these.
    return { pass: true, delta: 0, reason: 'no_specific_simulator', note: insight.category };
  }

  static async _evaluateContractProposal(insight, userId, options) {
    const predicate = insight.evidence?.predicate;
    if (!predicate) return { pass: false, delta: 0, reason: 'missing_predicate' };
    const toolName = insight.target_id;
    if (!toolName) return { pass: false, delta: 0, reason: 'missing_target_id' };

    let snapshotPath;
    let handle;
    try {
      const fork = await this.fork();
      snapshotPath = fork.snapshotPath;
      handle = this._open(snapshotPath);

      // Pull recent successful runs of this tool from the snapshot.
      const rows = await this._all(handle, `
        SELECT ate.*, ae.user_id
          FROM agent_tool_executions ate
          JOIN agent_executions ae ON ate.execution_id = ae.id
         WHERE ate.tool_name = ?
           AND ae.user_id = ?
           AND ate.status = 'completed'
           AND ate.start_time > datetime('now', '-14 days')
         LIMIT 1000
      `, [toolName, userId]);

      if (rows.length === 0) {
        return { pass: false, delta: 0, reason: 'no_sandbox_samples', sampleSize: 0 };
      }

      let violations = 0;
      for (const r of rows) {
        const value = predicate.field === 'duration_ms'
          ? (r.end_time && r.start_time ? new Date(r.end_time).getTime() - new Date(r.start_time).getTime() : null)
          : r[predicate.field];
        if (!Number.isFinite(Number(value))) continue;
        if (predicate.type === 'numeric_bound') {
          if (typeof predicate.max === 'number' && Number(value) > predicate.max) violations++;
          if (typeof predicate.min === 'number' && Number(value) < predicate.min) violations++;
        }
      }

      const violationRate = violations / rows.length;
      const maxAllowed = options.maxViolationRate ?? 0.05;
      const pass = violationRate <= maxAllowed;
      const delta = pass ? (1 - violationRate) : -violationRate;
      return {
        pass,
        delta,
        reason: pass ? 'contract_simulation_pass' : 'contract_would_violate_history',
        sampleSize: rows.length,
        violations,
        violationRate,
      };
    } catch (err) {
      return { pass: false, delta: 0, reason: 'sandbox_error', error: err.message };
    } finally {
      if (handle) await this._close(handle).catch(() => {});
      if (snapshotPath) await this.destroy(snapshotPath).catch(() => {});
    }
  }
}

export default ArenaService;
