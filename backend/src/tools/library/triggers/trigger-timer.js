import BaseTrigger from '../BaseTrigger.js';
import { SCHEDULE_OPTIONS, nextFireAt, resolveTimerSpec } from '../../../services/scheduler/timerSchedule.js';
import { lockedTimerSchedules } from '../../../services/hostedPlanLimits.js';

/**
 * Timer Trigger — fires a workflow on an interval or at a time of day.
 *
 * DURABLE, BECAUSE THE PROCESS IS NOT
 * -----------------------------------
 * The next fire time is an absolute timestamp written to trigger_wakes BEFORE
 * each fire, not a setTimeout counted from "now". That is what lets:
 *   - a restart resume the same schedule instead of starting a new one,
 *   - a hosted instance that the fleet put to sleep be woken for it (the fleet
 *     reads the row through the tenant_due_work view), and
 *   - a fire missed while the process was down run exactly once on return.
 *
 * FIRE ON START MEANS "WHEN YOU SWITCH IT ON"
 * -------------------------------------------
 * Boot restore and user activation reach setup() through the same path; the
 * engine's `activation` ('user' | 'restore') tells them apart. It used to fire
 * on every boot, which on a sleeping instance meant an extra run per wake and,
 * on desktop, a run every time the app opened.
 */

// setTimeout's ceiling (~24.8 days). A Monthly timer used to be clamped to it
// and fire early; now a long wait is chained and re-checked instead.
const MAX_TIMEOUT_MS = 2_147_483_647;
// Timers due at boot all wake together and race the dashboard for the event
// loop and the SQLite lock, so a fire that lands in the first seconds of
// process uptime is held until the stampede settles.
const BOOT_GRACE_MS = 30_000;
// A timeout can come back a hair before its target; do not re-arm for that.
const EARLY_WAKE_TOLERANCE_MS = 5;

let defaultStore = null;
async function loadDefaultStore() {
  defaultStore ??= (await import('../../../models/TriggerWakeModel.js')).default;
  return defaultStore;
}

class TriggerTimer extends BaseTrigger {
  static schema = {
    title: 'Timer Trigger',
    category: 'trigger',
    type: 'trigger-timer',
    icon: 'clock',
    description: 'This trigger node fires the workflow at specified intervals or at a specific time.',
    documentation: 'https://docs.slop.ai/docs/triggers/timer-trigger',
    parameters: {
      fireOnStart: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['Yes', 'No'],
        default: 'Yes',
        description: 'Fire once immediately when you switch the workflow on (not when the app restarts)',
      },
      scheduleType: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['Interval', 'Specific Time'],
        default: 'Interval',
        description: 'Choose between interval-based or specific time scheduling',
      },
      schedule: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        // Static on purpose: toolLibrary.json mirrors this byte for byte (see
        // toolManifest.drift.test.js). Options this instance's PLAN cannot use
        // are overlaid per request by /api/tools/workflow-tools
        // (hostedPlanLimits.applyPlanLocks) and enforced again in setup().
        options: [...SCHEDULE_OPTIONS],
        description: 'Select the interval for the timer',
        conditional: {
          field: 'scheduleType',
          value: 'Interval',
        },
      },
      specificTime: {
        type: 'string',
        inputType: 'time',
        inputSize: 'half',
        description: 'Select the specific time to run the trigger',
        conditional: {
          field: 'scheduleType',
          value: 'Specific Time',
        },
      },
      specificDays: {
        type: 'array',
        inputType: 'checkbox',
        inputSize: 'half',
        options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        description: 'Select the days to run the trigger at the specific time',
        conditional: {
          field: 'scheduleType',
          value: 'Specific Time',
        },
      },
      timezone: {
        type: 'string',
        // Text, not a 400-entry select: this schema is copied into the manifest
        // the model reads. Validated in setup() with a readable error.
        inputType: 'text',
        inputSize: 'half',
        // New nodes start in the editor's own zone. A hosted instance runs in
        // UTC, so without this "09:00" would fire at 09:00 UTC.
        defaultFrom: 'browserTimeZone',
        description: 'Time zone for the time above, e.g. America/New_York (also used by Monthly). Filled in with yours.',
        conditional: {
          field: 'scheduleType',
          value: 'Specific Time',
        },
      },
    },
    outputs: {
      timestamp: {
        type: 'string',
        description: 'The timestamp when the trigger fired',
      },
    },
  };

  constructor() {
    super('trigger-timer');
    // Where fire times are written. Null = TriggerWakeModel, loaded on first
    // use so importing this module never opens the database. Tests inject.
    this.store = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);

    if (!node.parameters) {
      throw new Error('Timer trigger node is missing parameters');
    }
    const parameters = node.parameters;

    // Enforced here, not only greyed out in the editor: a workflow imported,
    // generated or saved before the plan changed reaches this line too.
    const locked = lockedTimerSchedules();
    if ((parameters.scheduleType || 'Interval') === 'Interval' && locked[parameters.schedule]) {
      throw new Error(`"${parameters.schedule}" is not available on this plan. ${locked[parameters.schedule]}`);
    }

    const spec = resolveTimerSpec(parameters);
    const store = this.store ?? (await loadDefaultStore());
    const workflowId = engine.workflowId;
    const nodeId = node.id;
    const restoring = engine.activation === 'restore';
    const now = Date.now();

    let saved = null;
    if (restoring) {
      try {
        saved = await store.get(workflowId, nodeId);
      } catch (error) {
        console.error(`[trigger-timer] could not read the saved schedule for ${workflowId}/${nodeId}; starting fresh:`, error.message);
      }
    }

    // A row computed for a different configuration is not this timer's
    // schedule. Every edit goes through stop (which deletes the row), so this
    // only guards against rows written by some other path.
    const usable = saved && saved.schedule_key === spec.key && Number.isFinite(Number(saved.next_fire_at));

    let anchorAt;
    let nextAt;
    let fireNow;
    if (usable) {
      anchorAt = saved.anchor_at == null ? now : Number(saved.anchor_at);
      nextAt = Number(saved.next_fire_at);
      // Missed while the process was down: run it once, then carry on from
      // the next slot on the original phase. Never a burst of every miss.
      fireNow = nextAt <= now;
      if (fireNow) nextAt = nextFireAt(spec, { anchorAt, after: now });
    } else {
      anchorAt = now;
      nextAt = nextFireAt(spec, { anchorAt, after: now });
      fireNow = !restoring && parameters.fireOnStart === 'Yes';
    }

    const persist = async (fireAt) => {
      try {
        await store.upsert({
          workflowId,
          nodeId,
          triggerType: 'trigger-timer',
          nextFireAt: fireAt,
          anchorAt,
          scheduleKey: spec.key,
        });
      } catch (error) {
        // The timer keeps running in this process; what is lost is the ability
        // to be woken for it. Loud, because that loss is otherwise silent.
        console.error(`[trigger-timer] could not save the next fire time for ${workflowId}/${nodeId} — a sleeping instance will not wake for it:`, error.message);
      }
    };

    const fire = () => {
      const result = engine.processWorkflowTrigger({ type: 'timer', nodeId, timestamp: new Date().toISOString() });
      if (result && typeof result.catch === 'function') {
        result.catch((error) => console.error(`[trigger-timer] ${workflowId}/${nodeId} run failed to start:`, error.message));
      }
    };

    const arm = (targetAt) => {
      const delay = Math.min(Math.max(0, targetAt - Date.now()), MAX_TIMEOUT_MS);
      const handle = setTimeout(async () => {
        if (targetAt - Date.now() > EARLY_WAKE_TOLERANCE_MS) {
          arm(targetAt);
          return;
        }
        const following = nextFireAt(spec, { anchorAt, after: Math.max(Date.now(), targetAt) });
        // Written BEFORE firing: a crash mid-run must not replay this slot.
        await persist(following);
        // Stopped while the write was in flight: the handle is gone from the map.
        if (engine.timerIntervals.get(nodeId) !== handle) return;
        fire();
        arm(following);
      }, delay);
      engine.timerIntervals.set(nodeId, handle);
    };

    await persist(nextAt);

    if (fireNow) {
      const uptimeMs = process.uptime() * 1000;
      const delay = uptimeMs < BOOT_GRACE_MS ? BOOT_GRACE_MS - uptimeMs : 0;
      // Registered in engine.timerIntervals so stopWorkflowListeners() disarms
      // it; a shot that already fired is rejected by the stopped-engine guard.
      const shot = setTimeout(() => {
        engine.timerIntervals.delete(`${nodeId}:fireOnStart`);
        fire();
      }, delay);
      engine.timerIntervals.set(`${nodeId}:fireOnStart`, shot);
    }

    arm(nextAt);

    console.log(
      `Timer trigger armed for ${workflowId}/${nodeId}: ${spec.key}, next ${new Date(nextAt).toISOString()}` +
        (fireNow ? (usable ? ' (catching up a missed run)' : ' (fire on start)') : '') +
        (restoring ? ' [restored]' : '')
    );
  }

  async validate(triggerData, node) {
    return triggerData.type === 'timer' && triggerData.nodeId === node.id;
  }

  async process(inputData) {
    return {
      timestamp: inputData.timestamp,
    };
  }
}

export default new TriggerTimer();
