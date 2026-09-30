import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Timer Trigger survives the process.
 *
 * A hosted instance is stopped when idle and restarted to do work. Each case
 * below is one way that used to lose or duplicate a run: fire-on-start on
 * every boot, the schedule restarting from "now" after every restart, missed
 * runs vanishing, a Monthly timer firing early.
 */

const { default: TriggerTimer } = await import('./trigger-timer.js');

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 30, 10, 7, 0);

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    get: vi.fn(async (workflowId, nodeId) => rows.get(`${workflowId}/${nodeId}`) ?? null),
    upsert: vi.fn(async (row) => {
      rows.set(`${row.workflowId}/${row.nodeId}`, {
        next_fire_at: row.nextFireAt,
        anchor_at: row.anchorAt,
        schedule_key: row.scheduleKey,
      });
    }),
  };
}

const makeEngine = (activation = 'user') => ({
  activation,
  workflowId: 'wf-1',
  timerIntervals: new Map(),
  processWorkflowTrigger: vi.fn(),
});

const node = (parameters) => ({ id: 'timer-node', type: 'trigger-timer', category: 'trigger', parameters });
const every15 = (extra = {}) => node({ scheduleType: 'Interval', schedule: 'Every 15 Minutes', fireOnStart: 'No', ...extra });

const stop = (engine) => {
  for (const handle of engine.timerIntervals.values()) clearTimeout(handle);
  engine.timerIntervals.clear();
};

let store;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  // Well past the boot grace window, so fire-on-start is not deferred.
  vi.spyOn(process, 'uptime').mockReturnValue(3600);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  store = memoryStore();
  TriggerTimer.store = store;
  delete process.env.AGNT_TENANT_SLUG;
  delete process.env.AGNT_TENANT_PLAN;
});

afterEach(() => {
  TriggerTimer.store = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.AGNT_TENANT_SLUG;
  delete process.env.AGNT_TENANT_PLAN;
});

describe('trigger-timer — durable schedule', () => {
  it('fires on its cadence and writes each next time before firing', async () => {
    const engine = makeEngine();
    await TriggerTimer.setup(engine, every15());
    expect(store.rows.get('wf-1/timer-node').next_fire_at).toBe(T0 + 15 * MIN);

    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(store.rows.get('wf-1/timer-node').next_fire_at).toBe(T0 + 30 * MIN);

    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(3);
    stop(engine);
  });

  it('fires on start when switched on by the user', async () => {
    const engine = makeEngine('user');
    await TriggerTimer.setup(engine, every15({ fireOnStart: 'Yes' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    stop(engine);
  });

  it('does NOT fire on start when a restart restores it', async () => {
    const first = makeEngine('user');
    await TriggerTimer.setup(first, every15({ fireOnStart: 'Yes' }));
    await vi.advanceTimersByTimeAsync(5 * MIN);
    stop(first); // the process goes away

    const restored = makeEngine('restore');
    await TriggerTimer.setup(restored, every15({ fireOnStart: 'Yes' }));
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(restored.processWorkflowTrigger).not.toHaveBeenCalled();
    stop(restored);
  });

  it('keeps the original phase across a restart instead of restarting the clock', async () => {
    const first = makeEngine('user');
    await TriggerTimer.setup(first, every15());
    await vi.advanceTimersByTimeAsync(7 * MIN);
    stop(first);

    const restored = makeEngine('restore');
    await TriggerTimer.setup(restored, every15());
    // Due at T0+15, i.e. 8 minutes after the restart — not 15.
    await vi.advanceTimersByTimeAsync(8 * MIN);
    expect(restored.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    stop(restored);
  });

  it('runs a missed fire exactly once after downtime, then stays on phase', async () => {
    const first = makeEngine('user');
    await TriggerTimer.setup(first, every15());
    stop(first);

    // Asleep for 70 minutes: four slots missed (T0+15, +30, +45, +60).
    vi.setSystemTime(T0 + 70 * MIN);
    const restored = makeEngine('restore');
    await TriggerTimer.setup(restored, every15());
    await vi.advanceTimersByTimeAsync(0);
    expect(restored.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(store.rows.get('wf-1/timer-node').next_fire_at).toBe(T0 + 75 * MIN);

    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(restored.processWorkflowTrigger).toHaveBeenCalledTimes(2);
    stop(restored);
  });

  it('ignores a saved row computed for a different schedule', async () => {
    store.rows.set('wf-1/timer-node', { next_fire_at: T0 - MIN, anchor_at: T0 - 60 * MIN, schedule_key: 'interval|Hourly' });
    const restored = makeEngine('restore');
    await TriggerTimer.setup(restored, every15());
    await vi.advanceTimersByTimeAsync(0);
    expect(restored.processWorkflowTrigger).not.toHaveBeenCalled();
    expect(store.rows.get('wf-1/timer-node').next_fire_at).toBe(T0 + 15 * MIN);
    stop(restored);
  });

  it('does not fire a Monthly timer before the first of the month', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 2, 0, 0, 0)); // 30 days out: past setTimeout's ceiling
    const engine = makeEngine();
    await TriggerTimer.setup(engine, node({ scheduleType: 'Interval', schedule: 'Monthly', timezone: 'UTC', fireOnStart: 'No' }));

    await vi.advanceTimersByTimeAsync(29 * 24 * 60 * MIN);
    expect(engine.processWorkflowTrigger).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    stop(engine);
  });

  it('stops cleanly: nothing fires once its handles are cleared', async () => {
    const engine = makeEngine();
    await TriggerTimer.setup(engine, every15({ fireOnStart: 'Yes' }));
    stop(engine);
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(engine.processWorkflowTrigger).not.toHaveBeenCalled();
  });

  it('keeps running when the store cannot be written', async () => {
    store.upsert.mockRejectedValue(new Error('SQLITE_BUSY'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const engine = makeEngine();
    await TriggerTimer.setup(engine, every15());
    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    stop(engine);
  });
});

describe('trigger-timer — sleeping plan limits', () => {
  it('refuses a five-minute timer on a sleeping hosted plan', async () => {
    process.env.AGNT_TENANT_SLUG = 'goku';
    process.env.AGNT_TENANT_PLAN = 'personal';
    const engine = makeEngine();
    await expect(TriggerTimer.setup(engine, node({ scheduleType: 'Interval', schedule: 'Every 5 Minutes' }))).rejects.toThrow(
      /not available on this plan/
    );
    expect(engine.timerIntervals.size).toBe(0);
  });

  it('allows fifteen minutes on the same plan', async () => {
    process.env.AGNT_TENANT_SLUG = 'goku';
    process.env.AGNT_TENANT_PLAN = 'personal';
    const engine = makeEngine();
    await TriggerTimer.setup(engine, every15());
    expect(engine.timerIntervals.has('timer-node')).toBe(true);
    stop(engine);
  });
});
