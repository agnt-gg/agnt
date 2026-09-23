import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stopped workflow does not fire later.
 *
 * The fire-on-start shot is deferred past a boot grace window, so it is a live
 * timer sitting in the event loop after setup returns. Its handle was never
 * registered in engine.timerIntervals, which is the only thing
 * stopWorkflowListeners() knows how to clear — so stopping the workflow left
 * the shot armed and it fired into a stopped engine.
 */

const { default: TriggerTimer } = await import('./trigger-timer.js');

const makeEngine = () => ({
  timerIntervals: new Map(),
  processWorkflowTrigger: vi.fn(),
  workflowId: 'wf-1',
});

const timerNode = (parameters) => ({ id: 'timer-node', type: 'trigger-timer', category: 'trigger', text: 'Timer Trigger', parameters });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('trigger-timer — fire-on-start is disarmable', () => {
  it('registers the fire-on-start handle where stop can find it', async () => {
    const engine = makeEngine();

    await TriggerTimer.setup(engine, timerNode({ fireOnStart: 'Yes', scheduleType: 'Interval', schedule: 'Hourly' }));

    expect(engine.timerIntervals.has('timer-node:fireOnStart')).toBe(true);
  });

  it('does not fire after the registered handles are cleared', async () => {
    const engine = makeEngine();
    await TriggerTimer.setup(engine, timerNode({ fireOnStart: 'Yes', scheduleType: 'Interval', schedule: 'Hourly' }));

    // Exactly what stopWorkflowListeners() does with the map.
    for (const handle of engine.timerIntervals.values()) clearInterval(handle);
    engine.timerIntervals.clear();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(engine.processWorkflowTrigger).not.toHaveBeenCalled();
  });

  it('still fires when the workflow is left running', async () => {
    const engine = makeEngine();
    await TriggerTimer.setup(engine, timerNode({ fireOnStart: 'Yes', scheduleType: 'Interval', schedule: 'Hourly' }));

    await vi.advanceTimersByTimeAsync(31_000);

    expect(engine.processWorkflowTrigger).toHaveBeenCalledTimes(1);
    expect(engine.processWorkflowTrigger.mock.calls[0][0]).toMatchObject({ type: 'timer', nodeId: 'timer-node' });
    // The one-shot cleans itself out of the map once it has fired.
    expect(engine.timerIntervals.has('timer-node:fireOnStart')).toBe(false);
  });

  it('registers no fire-on-start handle when the option is off', async () => {
    const engine = makeEngine();

    await TriggerTimer.setup(engine, timerNode({ fireOnStart: 'No', scheduleType: 'Interval', schedule: 'Hourly' }));

    expect(engine.timerIntervals.has('timer-node:fireOnStart')).toBe(false);
    expect(engine.timerIntervals.has('timer-node')).toBe(true);
  });
});
