import { describe, expect, it } from 'vitest';
import { applyPlanLocks, lockedTimerSchedules } from './hostedPlanLimits.js';

describe('lockedTimerSchedules', () => {
  it('locks the one- and five-minute timers on a sleeping hosted plan', () => {
    const locked = lockedTimerSchedules({ AGNT_TENANT_SLUG: 'goku', AGNT_TENANT_PLAN: 'personal' });
    expect(Object.keys(locked).sort()).toEqual(['Every 5 Minutes', 'Every Minute']);
    expect(locked['Every Minute']).toMatch(/Always-On/);
  });

  it('locks nothing on a plan that never sleeps', () => {
    expect(lockedTimerSchedules({ AGNT_TENANT_SLUG: 'alpha', AGNT_TENANT_PLAN: 'always_on' })).toEqual({});
    expect(lockedTimerSchedules({ AGNT_TENANT_SLUG: 'bravo', AGNT_TENANT_PLAN: 'business' })).toEqual({});
  });

  it('locks nothing on desktop, whatever the subscription', () => {
    // A Personal subscriber's own machine does not sleep.
    expect(lockedTimerSchedules({ AGNT_TENANT_PLAN: 'personal' })).toEqual({});
  });

  it('locks nothing when the fleet did not say which plan this is', () => {
    expect(lockedTimerSchedules({ AGNT_TENANT_SLUG: 'goku' })).toEqual({});
  });
});

describe('applyPlanLocks', () => {
  const catalog = () => ({
    triggers: [
      { type: 'trigger-timer', parameters: { schedule: { options: ['Every Minute', 'Hourly'] }, fireOnStart: {} } },
      { type: 'webhook-listener', parameters: {} },
    ],
    actions: [{ type: 'x' }],
  });
  const personal = { AGNT_TENANT_SLUG: 'goku', AGNT_TENANT_PLAN: 'personal' };

  it('marks the timer options this plan cannot use, and nothing else', () => {
    const out = applyPlanLocks(catalog(), personal);
    expect(Object.keys(out.triggers[0].parameters.schedule.lockedOptions).sort()).toEqual(['Every 5 Minutes', 'Every Minute']);
    expect(out.triggers[0].parameters.schedule.options).toEqual(['Every Minute', 'Hourly']);
    expect(out.triggers[1]).toEqual({ type: 'webhook-listener', parameters: {} });
    expect(out.actions).toEqual([{ type: 'x' }]);
  });

  it('never mutates the cached manifest it was given', () => {
    const input = catalog();
    const before = JSON.stringify(input);
    applyPlanLocks(input, personal);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns the catalog untouched when nothing is locked', () => {
    const input = catalog();
    expect(applyPlanLocks(input, {})).toBe(input);
  });
});
