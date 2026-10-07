import { canRunScheduledGoals } from '../auth/planEntitlements.js';
import ScheduleModel from '../../models/ScheduleModel.js';
import { nextFireTime, isValidCron } from './cronParser.js';

/**
 * SchedulerService — durable cron scheduler (PRD-091 Layer 1).
 *
 * Ticks every 60s. On each tick, queries enabled schedules where next_run is
 * due, persists the next next_run, then runs them one at a time (the tick
 * waits for each run, so one goal never runs twice at once). Idempotent on
 * last_run + on_missed policy survives restart and downtime.
 *
 * Every fire opens a schedule_runs row as 'running' first and closes it with
 * the target's real outcome, so the history shows work in flight and a
 * manual fire-now can answer at once with the run id.
 */

const TICK_INTERVAL_MS = 60_000;

const targetExecutors = new Map();

/**
 * A run's recorded status from what the executor returned. Goal runs report
 * their outcome as { status } rather than throwing, so 'error', 'stuck' or
 * 'needs_review' must not be recorded as completed.
 */
function runOutcome(result) {
  const status = result && typeof result === 'object' && typeof result.status === 'string' ? result.status : null;
  if (!status || status === 'completed') return { status: 'completed', error: null };
  if (status === 'error') return { status: 'failed', error: result.error || result.reason || 'The run ended in error' };
  return { status, error: result.reason || null };
}

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

    // A run left 'running' by a previous process will never finish — but only
    // the data-dir owner can know the previous process is gone.
    try {
      const { isDataDirOwner } = await import('../../models/database/dataDirOwnership.js');
      const interrupted = (await isDataDirOwner()) ? await ScheduleModel.markInterruptedRuns() : 0;
      if (interrupted > 0) console.log(`[Scheduler] Marked ${interrupted} unfinished run(s) from the last session as interrupted`);
    } catch (err) {
      console.error('[Scheduler] Interrupted-run sweep failed:', err.message);
    }

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

      // Persisted trial deadlines are reviewed even while collection is paused.
      const { getLearningCoordinator } = await import('../learning/LearningCoordinator.js');
      const learning=await getLearningCoordinator();
      await learning.reviewDue();
      const { reconcileLearningEvidence } = await import('../learning/learningRuntime.js');
      try { await reconcileLearningEvidence(); } catch(error) {
        await learning.transaction(()=>learning.run(`INSERT INTO learning_health(source,failures,last_error,last_failure_at) VALUES('reconciliation',1,?,?) ON CONFLICT(source) DO UPDATE SET failures=failures+1,last_error=excluded.last_error,last_failure_at=excluded.last_failure_at`,[error.code||'evidence_reconciliation_failed',Date.now()]));
        throw error;
      }
    } finally {
      this._ticking = false;
    }
  }

  static async _fireOne(schedule, now) {
    const started = await this._startRun(schedule, now);
    if (started.fired) await started.completion;
  }

  /**
   * Do the bookkeeping for a fire and start the target. Resolves once the run
   * is underway, with { fired: true, runId, completion }; `completion`
   * resolves (never rejects) when the run has finished and been recorded.
   * Resolves { fired: false, reason } when the schedule cannot fire.
   */
  static async _startRun(schedule, now) {
    const executor = targetExecutors.get(schedule.target_type);
    if (!executor) {
      console.warn(`[Scheduler] No executor registered for target_type=${schedule.target_type}, disabling schedule ${schedule.id}`);
      await ScheduleModel.setEnabled(schedule.id, false);
      return { fired: false, reason: `No executor for target type ${schedule.target_type}` };
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
      return { fired: false, reason: `Invalid cron expression: ${schedule.cron}` };
    }

    // Resolve user (allow override for multi-tenant later).
    const userId = this._userResolver
      ? await this._userResolver(schedule)
      : schedule.user_id;

    if (schedule.target_type === 'goal' && !(await canRunScheduledGoals(userId))) {
      await ScheduleModel.updateAfterRun(schedule.id, { lastRun: schedule.last_run, nextRun, status: 'upgrade_required', error: 'Scheduled goals require a paid plan.' });
      return { fired: false, reason: 'upgrade_required' };
    }

    // Persist next_run BEFORE firing — this is the idempotency guard. If the
    // process crashes during executor execution, we won't re-fire the same
    // moment on restart.
    await ScheduleModel.updateAfterRun(schedule.id, {
      lastRun: now,
      nextRun,
      status: 'firing',
      error: null,
    });

    // The history row exists before the target runs. If it cannot be written
    // the run still happens (the schedule is the contract); it just has no id.
    let runId = null;
    try {
      runId = await ScheduleModel.startRun({ scheduleId: schedule.id, targetType: schedule.target_type, targetId: schedule.target_id });
    } catch (err) {
      console.error(`[Scheduler] Failed to record run start for schedule ${schedule.id}:`, err.message);
    }

    const completion = this._runToEnd({ schedule, executor, userId, runId, now, nextRun });
    return { fired: true, runId, completion };
  }

  /** Execute the target and record its outcome. Never rejects. */
  static async _runToEnd({ schedule, executor, userId, runId, now, nextRun }) {
    const startedAt = Date.now();
    let runTargetId = null;
    let outcome;
    try {
      const result = await executor(schedule.target_id, userId, schedule);
      if (result && typeof result === 'object') {
        runTargetId = result.goalId || result.id || null;
      }
      outcome = runOutcome(result);
    } catch (err) {
      outcome = { status: 'failed', error: err && err.message ? err.message : String(err) };
    }
    if (outcome.status === 'failed') {
      console.error(`[Scheduler] Run failed for schedule ${schedule.id}:`, outcome.error);
    }

    if (runId) {
      await ScheduleModel.finishRun(runId, {
        status: outcome.status,
        error: outcome.error,
        runTargetId: runTargetId || schedule.target_id,
        durationMs: Date.now() - startedAt,
      }).catch((err) => console.error(`[Scheduler] Failed to record run outcome:`, err.message));
    }

    // Final status pass — overwrites the transient 'firing' state.
    await ScheduleModel.updateAfterRun(schedule.id, {
      lastRun: now,
      nextRun,
      status: outcome.status,
      error: outcome.error,
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

  /**
   * Fire a schedule now regardless of next_run. Used by ScheduleRoutes.
   * Returns as soon as the run has started, not when it finishes: a goal run
   * can take minutes, longer than any HTTP client waits (#95). Poll
   * GET /schedules/:id/runs (or the goal) with the returned runId.
   */
  static async fireNow(scheduleId) {
    const schedule = await ScheduleModel.findOne(scheduleId);
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    const started = await this._startRun(schedule, new Date());
    if (!started.fired) return { fired: false, scheduleId, reason: started.reason };
    return { fired: true, scheduleId, runId: started.runId, status: 'running' };
  }
}

export default SchedulerService;
