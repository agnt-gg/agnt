import { describe, expect, it } from 'vitest';
import { INTERVAL_MS, nextFireAt, resolveTimerSpec } from './timerSchedule.js';

const T0 = Date.UTC(2026, 8, 30, 10, 7, 0); // 2026-09-30T10:07:00Z, a Wednesday

describe('resolveTimerSpec', () => {
  it('resolves fixed intervals to milliseconds', () => {
    const spec = resolveTimerSpec({ scheduleType: 'Interval', schedule: 'Every 15 Minutes' });
    expect(spec).toMatchObject({ kind: 'interval', intervalMs: INTERVAL_MS['Every 15 Minutes'] });
  });

  it('rejects an unknown interval with a readable message', () => {
    expect(() => resolveTimerSpec({ scheduleType: 'Interval', schedule: 'Every Fortnight' })).toThrow('Invalid schedule: Every Fortnight');
  });

  it('refuses Specific Time with no day ticked instead of looping forever', () => {
    expect(() => resolveTimerSpec({ scheduleType: 'Specific Time', specificTime: '09:00', specificDays: [] })).toThrow(
      'at least one day'
    );
  });

  it('refuses a malformed time of day', () => {
    expect(() => resolveTimerSpec({ scheduleType: 'Specific Time', specificTime: '25:00', specificDays: ['Monday'] })).toThrow('HH:MM');
  });

  it('refuses an unknown time zone', () => {
    expect(() =>
      resolveTimerSpec({ scheduleType: 'Specific Time', specificTime: '09:00', specificDays: ['Monday'], timezone: 'Mars/Olympus' })
    ).toThrow('Unknown time zone');
  });

  it('keys the schedule by everything that changes when it fires', () => {
    const a = resolveTimerSpec({ scheduleType: 'Specific Time', specificTime: '09:00', specificDays: ['Monday'], timezone: 'UTC' });
    const b = resolveTimerSpec({ scheduleType: 'Specific Time', specificTime: '09:00', specificDays: ['Monday'], timezone: 'Europe/Berlin' });
    expect(a.key).not.toBe(b.key);
  });
});

describe('nextFireAt', () => {
  const every15 = resolveTimerSpec({ scheduleType: 'Interval', schedule: 'Every 15 Minutes' });

  it('keeps the phase of the activation anchor', () => {
    expect(nextFireAt(every15, { anchorAt: T0, after: T0 })).toBe(T0 + 15 * 60_000);
    // 47 minutes later the next slot is still on the :07/:22/:37/:52 grid.
    expect(nextFireAt(every15, { anchorAt: T0, after: T0 + 47 * 60_000 })).toBe(T0 + 60 * 60_000);
  });

  it('is strictly after the time it is given, so a served slot never comes back', () => {
    const slot = T0 + 30 * 60_000;
    expect(nextFireAt(every15, { anchorAt: T0, after: slot })).toBe(slot + 15 * 60_000);
  });

  it('fires Specific Time at that wall-clock time in the chosen zone', () => {
    const spec = resolveTimerSpec({ scheduleType: 'Specific Time', specificTime: '09:00', specificDays: ['Thursday'], timezone: 'America/New_York' });
    // Thursday 2026-10-01 09:00 EDT (UTC-4) = 13:00Z.
    expect(new Date(nextFireAt(spec, { after: T0 })).toISOString()).toBe('2026-10-01T13:00:00.000Z');
  });

  it('follows the zone across a daylight-saving change', () => {
    const spec = resolveTimerSpec({ scheduleType: 'Specific Time', specificTime: '09:00', specificDays: ['Monday'], timezone: 'America/New_York' });
    // US DST ends 2026-11-01; Monday 2026-11-02 09:00 EST (UTC-5) = 14:00Z.
    const after = Date.UTC(2026, 9, 31, 0, 0, 0);
    expect(new Date(nextFireAt(spec, { after })).toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });

  it('lands Monthly on the first of the month, however far away', () => {
    const spec = resolveTimerSpec({ scheduleType: 'Interval', schedule: 'Monthly', timezone: 'UTC' });
    const after = Date.UTC(2026, 0, 2, 0, 0, 0);
    expect(new Date(nextFireAt(spec, { after })).toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});
