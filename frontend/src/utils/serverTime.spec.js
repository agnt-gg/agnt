import { describe, it, expect } from 'vitest';
import { parseServerTime, toServerDate, serverAge } from './serverTime.js';

// The exact shape SQLite's CURRENT_TIMESTAMP writes, taken from a live row.
const SQLITE_NAIVE = '2026-07-27 01:56:50';
const SAME_INSTANT_MS = Date.UTC(2026, 6, 27, 1, 56, 50);

describe('parseServerTime — the defect', () => {
  it('reads a naive SQLite timestamp as UTC, not local time', () => {
    // REGRESSION GUARD. `new Date("2026-07-27 01:56:50")` parses as LOCAL time
    // per spec, which puts every row hours into the future west of Greenwich.
    expect(parseServerTime(SQLITE_NAIVE)).toBe(SAME_INSTANT_MS);
  });

  it('disagrees with the naive constructor whenever the machine is not on UTC', () => {
    // Proves the bug is real on this machine rather than asserting a tautology.
    const offsetMinutes = new Date().getTimezoneOffset();
    const naive = new Date(SQLITE_NAIVE).getTime();
    if (offsetMinutes === 0) {
      expect(parseServerTime(SQLITE_NAIVE)).toBe(naive);
    } else {
      expect(parseServerTime(SQLITE_NAIVE)).not.toBe(naive);
      expect(naive - parseServerTime(SQLITE_NAIVE)).toBe(offsetMinutes * 60_000);
    }
  });

  it('never reports a stored timestamp as being in the future', () => {
    // The user-visible symptom: a row written "now" appeared ~4h ahead, so a
    // client-side Date.now() could never outrank it.
    const storedNow = new Date().toISOString().slice(0, 19).replace('T', ' ');
    expect(parseServerTime(storedNow)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('is comparable with Date.now() — the comparison the sidebar depends on', () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
    expect(Date.now()).toBeGreaterThan(parseServerTime(oneHourAgo));
  });
});

describe('parseServerTime — accepted formats', () => {
  it('accepts the T separator without an offset', () => {
    expect(parseServerTime('2026-07-27T01:56:50')).toBe(SAME_INSTANT_MS);
  });

  it('accepts fractional seconds', () => {
    expect(parseServerTime('2026-07-27 01:56:50.250')).toBe(SAME_INSTANT_MS + 250);
  });

  it('accepts minute precision', () => {
    expect(parseServerTime('2026-07-27 01:56')).toBe(Date.UTC(2026, 6, 27, 1, 56));
  });

  it('leaves an explicit Z alone', () => {
    expect(parseServerTime('2026-07-27T01:56:50Z')).toBe(SAME_INSTANT_MS);
  });

  it('leaves an explicit numeric offset alone', () => {
    expect(parseServerTime('2026-07-26T21:56:50-04:00')).toBe(SAME_INSTANT_MS);
  });

  it('does not touch the date-only form, which the spec already reads as UTC', () => {
    expect(parseServerTime('2026-07-27')).toBe(Date.UTC(2026, 6, 27));
  });

  it('passes a Date through unchanged', () => {
    const d = new Date(SAME_INSTANT_MS);
    expect(parseServerTime(d)).toBe(SAME_INSTANT_MS);
  });

  it('passes epoch milliseconds through unchanged', () => {
    expect(parseServerTime(SAME_INSTANT_MS)).toBe(SAME_INSTANT_MS);
  });
});

describe('parseServerTime — hostile input returns 0, never NaN', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['garbage', 'not-a-date'],
    ['an object', { updated_at: 1 }],
    ['an array', []],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['an Invalid Date', new Date('nope')],
  ])('%s -> 0', (_label, input) => {
    const result = parseServerTime(input);
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe('toServerDate', () => {
  it('produces a Date at the correct instant', () => {
    expect(toServerDate(SQLITE_NAIVE).getTime()).toBe(SAME_INSTANT_MS);
  });

  it('returns null rather than an Invalid Date', () => {
    expect(toServerDate(null)).toBeNull();
    expect(toServerDate('')).toBeNull();
    expect(toServerDate('garbage')).toBeNull();
  });

  it('renders the correct calendar day near midnight UTC', () => {
    // 00:30 UTC on the 27th is still the 26th in EDT. The naive constructor
    // would have shown the 27th, silently shifting the date by a day.
    const d = toServerDate('2026-07-27 00:30:00');
    expect(d.getUTCDate()).toBe(27);
    expect(d.getTime()).toBe(Date.UTC(2026, 6, 27, 0, 30));
  });
});

describe('serverAge', () => {
  it('measures age against the client clock', () => {
    const now = Date.UTC(2026, 6, 27, 3, 56, 50);
    expect(serverAge(SQLITE_NAIVE, now)).toBe(2 * 3_600_000);
  });

  it('clamps clock skew to 0 instead of reporting a negative age', () => {
    const now = Date.UTC(2026, 6, 27, 1, 0, 0); // before the stamp
    expect(serverAge(SQLITE_NAIVE, now)).toBe(0);
  });

  it('returns 0 for unparseable input', () => {
    expect(serverAge('garbage')).toBe(0);
    expect(serverAge(null)).toBe(0);
  });
});

describe('negative control — the constructor this replaced', () => {
  it('demonstrates the old behaviour failing where the new one passes', () => {
    const offsetMinutes = new Date().getTimezoneOffset();
    if (offsetMinutes === 0) return; // undetectable on a UTC machine, correctly

    const stored = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const legacy = new Date(stored).getTime(); // the pre-fix parse
    const fixed = parseServerTime(stored);

    // West of Greenwich the legacy parse lands in the future, so a client-side
    // Date.now() bump can never outrank it. That was the reported symptom.
    if (offsetMinutes > 0) {
      expect(legacy).toBeGreaterThan(Date.now());
      expect(fixed).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });
});
