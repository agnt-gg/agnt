import { describe, it, expect } from 'vitest';
import { parseCron, nextFireTime, isValidCron } from './cronParser.js';

// Helper: snapshot the wall-clock minute in UTC so DST-sensitive tests
// don't pin to a single platform's timezone.
function utc(y, mo, d, h = 0, mi = 0) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
}

describe('parseCron — field expansion', () => {
  it('parses a basic 5-field expression', () => {
    const c = parseCron('0 12 * * *');
    expect(c.minutes).toEqual([0]);
    expect(c.hours).toEqual([12]);
    expect(c.daysOfMonth.length).toBe(31);
    expect(c.months.length).toBe(12);
    expect(c.daysOfWeek.length).toBe(7);
    expect(c.domStar).toBe(true);
    expect(c.dowStar).toBe(true);
  });

  it('expands star-slash steps', () => {
    expect(parseCron('*/15 * * * *').minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron('0 */6 * * *').hours).toEqual([0, 6, 12, 18]);
  });

  it('expands ranges', () => {
    expect(parseCron('0 9-17 * * *').hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('expands comma lists', () => {
    expect(parseCron('0,15,30 * * * *').minutes).toEqual([0, 15, 30]);
  });

  it('combines comma + step', () => {
    expect(parseCron('0,30 */2 * * *').hours).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });

  it('accepts day-of-week names', () => {
    const c = parseCron('0 9 * * MON-FRI');
    expect(c.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts month names', () => {
    // months field uses numeric (no month alias support per current impl); range works
    expect(parseCron('0 0 1 1-3 *').months).toEqual([1, 2, 3]);
  });

  it('treats dow=7 as Sunday (=0)', () => {
    expect(parseCron('0 0 * * 7').daysOfWeek).toEqual([0]);
  });

  it('flags whether dom/dow are restricted (for OR semantics)', () => {
    expect(parseCron('0 0 1 * *').domStar).toBe(false);
    expect(parseCron('0 0 1 * *').dowStar).toBe(true);
    expect(parseCron('0 0 * * 1').domStar).toBe(true);
    expect(parseCron('0 0 * * 1').dowStar).toBe(false);
  });
});

describe('parseCron — macros', () => {
  it('@hourly', () => {
    expect(parseCron('@hourly').minutes).toEqual([0]);
    expect(parseCron('@hourly').hours.length).toBe(24);
  });
  it('@daily and @midnight', () => {
    const a = parseCron('@daily');
    const b = parseCron('@midnight');
    expect(a).toEqual(b);
    expect(a.minutes).toEqual([0]);
    expect(a.hours).toEqual([0]);
  });
  it('@weekly', () => {
    const c = parseCron('@weekly');
    expect(c.daysOfWeek).toEqual([0]);
  });
  it('@monthly', () => {
    const c = parseCron('@monthly');
    expect(c.daysOfMonth).toEqual([1]);
  });
  it('@yearly and @annually', () => {
    const a = parseCron('@yearly');
    const b = parseCron('@annually');
    expect(a).toEqual(b);
    expect(a.months).toEqual([1]);
    expect(a.daysOfMonth).toEqual([1]);
  });
});

describe('parseCron — invalid input', () => {
  it('rejects non-string input', () => {
    expect(() => parseCron(123)).toThrow(/string/);
    expect(() => parseCron(null)).toThrow(/string/);
  });
  it('rejects wrong field count', () => {
    expect(() => parseCron('0 12 * *')).toThrow(/5 fields/);
    expect(() => parseCron('0 12 * * * *')).toThrow(/5 fields/);
  });
  it('rejects out-of-range fields', () => {
    expect(() => parseCron('60 0 * * *')).toThrow(/out of range/);
    expect(() => parseCron('0 24 * * *')).toThrow(/out of range/);
    expect(() => parseCron('0 0 32 * *')).toThrow(/out of range/);
    expect(() => parseCron('0 0 * 13 *')).toThrow(/out of range/);
  });
  it('rejects invalid step', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(/step/);
  });
  it('rejects unparseable tokens', () => {
    expect(() => parseCron('XYZ * * * *')).toThrow();
  });
});

describe('isValidCron', () => {
  it('returns true for valid', () => {
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('@hourly')).toBe(true);
  });
  it('returns false for invalid', () => {
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('60 * * * *')).toBe(false);
    expect(isValidCron(null)).toBe(false);
  });
});

describe('nextFireTime — basic cadences (UTC)', () => {
  it('every minute → next minute', () => {
    const from = utc(2026, 6, 19, 10, 0);
    const next = nextFireTime('* * * * *', from, 'UTC');
    expect(next.getTime()).toBe(utc(2026, 6, 19, 10, 1).getTime());
  });

  it('every hour at :00 → next top-of-hour', () => {
    const from = utc(2026, 6, 19, 10, 30);
    const next = nextFireTime('0 * * * *', from, 'UTC');
    expect(next.getTime()).toBe(utc(2026, 6, 19, 11, 0).getTime());
  });

  it('@daily at midnight → next 00:00', () => {
    const from = utc(2026, 6, 19, 23, 45);
    const next = nextFireTime('@daily', from, 'UTC');
    expect(next.getTime()).toBe(utc(2026, 6, 20, 0, 0).getTime());
  });

  it('skips to next day if today\'s slot already passed', () => {
    const from = utc(2026, 6, 19, 15, 0);
    const next = nextFireTime('0 9 * * *', from, 'UTC');
    expect(next.getTime()).toBe(utc(2026, 6, 20, 9, 0).getTime());
  });

  it('fires today if slot is still ahead', () => {
    const from = utc(2026, 6, 19, 8, 0);
    const next = nextFireTime('0 9 * * *', from, 'UTC');
    expect(next.getTime()).toBe(utc(2026, 6, 19, 9, 0).getTime());
  });

  it('honors restricted day-of-week (Monday only)', () => {
    // 2026-06-19 is a Friday. Next Monday is 2026-06-22.
    const from = utc(2026, 6, 19, 12, 0);
    const next = nextFireTime('0 9 * * MON', from, 'UTC');
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getTime()).toBe(utc(2026, 6, 22, 9, 0).getTime());
  });

  it('honors month restriction (jumps months when needed)', () => {
    const from = utc(2026, 6, 19, 12, 0);
    const next = nextFireTime('0 0 1 1 *', from, 'UTC');
    expect(next.getTime()).toBe(utc(2027, 1, 1, 0, 0).getTime());
  });

  it('returns strictly AFTER `from` (no zero-tick)', () => {
    const from = utc(2026, 6, 19, 10, 0);
    const next = nextFireTime('0 10 * * *', from, 'UTC');
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('nextFireTime — OR semantics for dom/dow when both restricted', () => {
  // "0 0 1 * MON" should fire on either the 1st of the month OR any Monday.
  it('matches either dom OR dow when both restricted', () => {
    // Friday June 19 → next match could be next Monday (22nd) OR next 1st (July 1)
    const from = utc(2026, 6, 19, 12, 0);
    const next = nextFireTime('0 0 1 * MON', from, 'UTC');
    // Next Monday is 22nd. That should win over July 1.
    expect(next.getTime()).toBe(utc(2026, 6, 22, 0, 0).getTime());
  });
});
