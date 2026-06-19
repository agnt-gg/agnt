import ScheduleModel from '../../models/ScheduleModel.js';
import { nextFireTime, isValidCron } from './cronParser.js';

/**
 * SchedulerService — durable cron scheduler (PRD-091 Layer 1).
 *
 * Ticks every 60s. On each tick, queries enabled schedules where next_run is
 * due, fires them (fire-and-forget so a long goal run doesn't stall the
 * tick), then computes and persists the next next_run. Idempotent on
 * last_run + on_missed policy survives restart and downtime.
 */

const TICK_INTERVAL_MS = 60_000;

const targetExecutors = new Map();

function defaultGoalExecutor(targetId, userId, schedule) {
  // Dynamic import so we don't form a hard load-time cycle with TaskOrchestrator.
  return import('../goal/TaskOrchestrator.js').then(({ default: TaskOrchestrator }) =>
    TaskOrchestrator.executeGoalAutonomous(targetId, userId, {})
  );
}

class SchedulerService {
  static _started = false;
  static _interval = null;
  static _ticking = false;
  static _userResolver = null;

  /**
   * Register a custom executor for a target_type.
   * The default for 'goal' is TaskOrchestrator.executeGoalAutonomous.
   */
  static registerExecutor(targetType, fn) {
    targetExecutors.set(targetType, fn);
  }

  /**
   * Override how the scheduler resolves a userId from a target (used when the
   * schedule row's user_id isn't trusted or needs validation). Default: use
   * schedule.user_id as-is.
   */
  static setUserResolver(fn) {
    this._userResolver = fn;
  }

  static async start({ tickIntervalMs = TICK_INTERVAL_MS, fireImmediately = true } = {}) {
    if (this._started) return;
    this._started = true;
    targetExecutors.set('goal', defaultGoalExecutor);

    console.log(`[Scheduler] Starting (tick every ${tickIntervalMs}ms)`);

    // Seed next_run for any schedule that doesn't have one yet (fresh row).
    try {
      const enabled = await ScheduleModel.findEnabled();
      for (const s of enabled) {
        if (!s.next_run) {
          const next = this._safeNextFire(s.cron, new Date(), s.timezone || 'UTC');
          if (next) await ScheduleModel.updateNextRun(s.id, next);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Seed pass failed:', err.message);
    }

    if (fireImmediately) {
      // First tick on next event loop turn so server.js finishes booting.
      setImmediate(() => this.tick().catch((e) => console.error('[Scheduler] tick error:', e)));
    }

    this._interval = setInterval(() => {
      this.tick().catch((e) => console.error('[Scheduler] tick error:', e));
    }, tickIntervalMs);
    if (typeof this._interval.unref === 'function') this._interval.unref();
  }

  static stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    this._started = false;
  }

  static async tick() {
    if (this._ticking) return; // overlap guard
    this._ticking = true;
    try {
      const now = new Date();
      const due = await ScheduleModel.findDue(now);
      if (due.length > 0) {
        console.log(`[Scheduler] ${due.length} schedule(s) due at ${now.toISOString()}`);
        for (const schedule of due) {
          await this._fireOne(schedule, now);
        }
      }

      // PRD-091 Layer 7: canary sweep — every 5th tick (~5 minutes), check
      // recently-applied mutations for regressions and auto-revert.
      this._canaryTickCounter = (this._canaryTickCounter || 0) + 1;
      if (this._canaryTickCounter % 5 === 0) {
        await this._runCanarySweep().catch((err) => console.error('[Scheduler] canary sweep error:', err.message));
      }
    } finally {
      this._ticking = false;
    }
  }

  static async _runCanarySweep() {
    try {
      const FitnessScoreService = (await import('../evolution/FitnessScoreService.js')).default;
      const db = (await import('../../models/database/index.js')).default;
      // Recently-applied, still-active mutations across all users (the scheduler
      // is global). We only revert when there's a clear regression.
      const rows = await new Promise((resolve) => {
        db.all(
          `SELECT * FROM mutation_history
            WHERE status = 'applied'
              AND fitness_before IS NOT NULL
              AND created_at > datetime('now', '-1 day')
            LIMIT 50`,
          [],
          (err, r) => resolve(err ? [] : (r || []))
        );
      });

      for (const mh of rows) {
        const verdict = await FitnessScoreService.canaryCheck(mh.id, { minDelta: -0.05 }).catch(() => null);
        if (verdict && verdict.regression) {
          await this._revertMutation(mh, `Regression: fitness dropped ${verdict.delta.toFixed(3)}`);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Canary sweep failed:', err.message);
    }
  }

  static async _revertMutation(mh, reason) {
    try {
      const MutationHistoryModel = (await import('../../models/MutationHistoryModel.js')).default;
      if (mh.snapshot_kind === 'workflow_version' && mh.snapshot_ref) {
        try {
          const WorkflowVersionService = (await import('../WorkflowVersionService.js')).default;
          await WorkflowVersionService.revertToVersion(mh.target_id, mh.snapshot_ref);
        } catch (e) {
          console.warn('[Scheduler] Workflow revert failed:', e.message);
        }
      }
      await MutationHistoryModel.markReverted(mh.id, reason);
      console.log(`[Scheduler] Canary auto-reverted mutation ${mh.id}: ${reason}`);
    } catch (err) {
      console.error('[Scheduler] Revert failed:', err.message);
    }
  }

  static async _fireOne(schedule, now) {
    const executor = targetExecutors.get(schedule.target_type);
    if (!executor) {
      console.warn(`[Scheduler] No executor registered for target_type=${schedule.target_type}, disabling schedule ${schedule.id}`);
      await ScheduleModel.setEnabled(schedule.id, false);
      return;
    }

    // Decide what "next" means. On long downtime, on_missed governs whether
    // we catch up multiple missed fires or skip past them.
    let nextRun;
    try {
      nextRun = this._safeNextFire(schedule.cron, now, schedule.timezone || 'UTC');
    } catch (err) {
      console.error(`[Scheduler] Cron parse failed for schedule ${schedule.id} (${schedule.cron}):`, err.message);
      await ScheduleModel.updateAfterRun(schedule.id, {
        lastRun: now,
        nextRun: null,
        status: 'cron_invalid',
        error: err.message,
      });
      await ScheduleModel.setEnabled(schedule.id, false);
      return;
    }

    // Resolve user (allow override for multi-tenant later).
    const userId = this._userResolver
      ? await this._userResolver(schedule)
      : schedule.user_id;

    // Persist next_run BEFORE firing — this is the idempotency guard. If the
    // process crashes during executor execution, we won't re-fire the same
    // moment on restart.
    await ScheduleModel.updateAfterRun(schedule.id, {
      lastRun: now,
      nextRun,
      status: 'firing',
      error: null,
    });

    let runTargetId = null;
    let runStatus = 'fired';
    let runError = null;
    try {
      const result = await executor(schedule.target_id, userId, schedule);
      if (result && typeof result === 'object') {
        runTargetId = result.goalId || result.id || null;
      }
      runStatus = 'completed';
    } catch (err) {
      runStatus = 'failed';
      runError = err && err.message ? err.message : String(err);
      console.error(`[Scheduler] Executor failed for schedule ${schedule.id}:`, runError);
    }

    try {
      await ScheduleModel.recordRun({
        scheduleId: schedule.id,
        targetType: schedule.target_type,
        targetId: schedule.target_id,
        runTargetId,
        status: runStatus,
        error: runError,
      });
    } catch (err) {
      console.error(`[Scheduler] Failed to record run history:`, err.message);
    }

    // Final status pass — overwrites the transient 'firing' state.
    await ScheduleModel.updateAfterRun(schedule.id, {
      lastRun: now,
      nextRun,
      status: runStatus,
      error: runError,
    }).catch((err) => console.error(`[Scheduler] Final status update failed:`, err.message));
  }

  static _safeNextFire(cron, from, tz) {
    if (!isValidCron(cron)) throw new Error(`Invalid cron expression: ${cron}`);
    return nextFireTime(cron, from, tz);
  }

  /** Convenience for ScheduleRoutes — preview the next N firings. */
  static preview(cron, count = 5, timezone = 'UTC') {
    if (!isValidCron(cron)) throw new Error(`Invalid cron: ${cron}`);
    const out = [];
    let cursor = new Date();
    for (let i = 0; i < count; i++) {
      cursor = nextFireTime(cron, cursor, timezone);
      out.push(cursor.toISOString());
    }
    return out;
  }

  /** Fire a schedule now regardless of next_run. Used by ScheduleRoutes. */
  static async fireNow(scheduleId) {
    const schedule = await ScheduleModel.findOne(scheduleId);
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    await this._fireOne(schedule, new Date());
    return { fired: true, scheduleId };
  }
}

export default SchedulerService;
