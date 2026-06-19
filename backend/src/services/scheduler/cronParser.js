// Minimal 5-field cron parser (PRD-091 Layer 1).
// Fields: minute (0-59) | hour (0-23) | day-of-month (1-31) | month (1-12) | day-of-week (0-7, 0/7 = Sun)
// Supports: star, star-slash-N, A-B, A,B,C, MON..SUN, JAN..DEC.
// Returns next firing time in the given IANA timezone (default UTC).

const MIN_BOUNDS = [0, 59];
const HOUR_BOUNDS = [0, 23];
const DOM_BOUNDS = [1, 31];
const MONTH_BOUNDS = [1, 12];
const DOW_BOUNDS = [0, 6];

const DOW_NAMES = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MONTH_NAMES = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

function expandField(spec, [min, max], aliases = null) {
  spec = String(spec).trim().toUpperCase();
  // Comma-separated list
  if (spec.includes(',')) {
    const parts = spec.split(',').map((p) => expandField(p, [min, max], aliases));
    const merged = new Set();
    parts.forEach((arr) => arr.forEach((v) => merged.add(v)));
    return [...merged].sort((a, b) => a - b);
  }
  // Step: */N or A-B/N
  let step = 1;
  let range = spec;
  if (spec.includes('/')) {
    const [r, s] = spec.split('/');
    range = r;
    step = parseInt(s, 10);
    if (!Number.isFinite(step) || step <= 0) throw new Error(`Invalid step in cron field: ${spec}`);
  }
  let start, end;
  if (range === '*') {
    start = min;
    end = max;
  } else if (range.includes('-')) {
    const [a, b] = range.split('-');
    start = resolveAlias(a, aliases, min);
    end = resolveAlias(b, aliases, max);
  } else {
    const v = resolveAlias(range, aliases, min);
    start = v;
    end = v;
  }
  if (start < min || end > max || start > end) {
    throw new Error(`Cron field out of range: ${spec} (allowed ${min}-${max})`);
  }
  const out = [];
  for (let v = start; v <= end; v++) {
    if ((v - start) % step === 0) out.push(v);
  }
  return out;
}

function resolveAlias(token, aliases, fallback) {
  token = String(token).trim().toUpperCase();
  if (aliases && aliases[token] !== undefined) return aliases[token];
  const n = parseInt(token, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid cron token: ${token}`);
  return n;
}

export function parseCron(expr) {
  if (typeof expr !== 'string') throw new Error('Cron must be a string');
  const trimmed = expr.trim();
  // Common macros
  const macros = {
    '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *', '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
  };
  const norm = macros[trimmed.toLowerCase()] || trimmed;
  const parts = norm.split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron must be 5 fields (got ${parts.length}): ${expr}`);
  const [minute, hour, dom, month, dow] = parts;
  return {
    minutes: expandField(minute, MIN_BOUNDS),
    hours: expandField(hour, HOUR_BOUNDS),
    daysOfMonth: expandField(dom, DOM_BOUNDS),
    months: expandField(month, MONTH_BOUNDS),
    // sun = 0; allow 7 to mean Sunday too
    daysOfWeek: expandField(dow === '7' ? '0' : dow, DOW_BOUNDS, DOW_NAMES),
    // remember whether dom/dow were stars (cron OR semantics when both restricted)
    domStar: dom === '*',
    dowStar: dow === '*',
  };
}

/**
 * Decompose a Date into wall-clock fields in `tz`.
 * Returns { year, month, day, hour, minute, dayOfWeek }.
 */
function inZone(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour === '24' ? '0' : parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
    dayOfWeek: dowMap[parts.weekday] ?? 0,
  };
}

/**
 * Build a UTC Date that, when rendered in `tz`, has the given wall-clock fields.
 * We approximate via a guess + correction loop (handles DST shifts).
 */
function fromZone({ year, month, day, hour, minute }, tz) {
  // Initial guess: pretend the wall-clock is UTC.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  // Correct twice — enough for any real-world DST offset.
  for (let i = 0; i < 3; i++) {
    const back = inZone(guess, tz);
    const wantMin = year * 12 * 31 * 24 * 60 + (month - 1) * 31 * 24 * 60 + (day - 1) * 24 * 60 + hour * 60 + minute;
    const haveMin = back.year * 12 * 31 * 24 * 60 + (back.month - 1) * 31 * 24 * 60 + (back.day - 1) * 24 * 60 + back.hour * 60 + back.minute;
    const diff = wantMin - haveMin;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff * 60_000);
  }
  return guess;
}

/**
 * Compute the next firing time strictly after `from` for a given cron in tz.
 * Returns a Date (UTC). Searches up to ~5 years ahead before giving up.
 */
export function nextFireTime(cronExpr, from = new Date(), timezone = 'UTC') {
  const cron = parseCron(cronExpr);
  // Start at the next whole minute after `from` (cron has minute resolution).
  let probe = new Date(Math.floor(from.getTime() / 60_000 + 1) * 60_000);

  const maxIterations = 60 * 24 * 366 * 5; // ~5 years of minute scans, with month/day skipping below
  let iter = 0;

  while (iter++ < maxIterations) {
    const z = inZone(probe, timezone);

    if (!cron.months.includes(z.month)) {
      // Jump to first day of next month.
      const nextMonth = z.month === 12 ? 1 : z.month + 1;
      const nextYear = z.month === 12 ? z.year + 1 : z.year;
      probe = fromZone({ year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0 }, timezone);
      continue;
    }

    const domOk = cron.daysOfMonth.includes(z.day);
    const dowOk = cron.daysOfWeek.includes(z.dayOfWeek);
    // Standard cron: when both dom and dow are restricted (not *), the match is OR.
    let dayMatch;
    if (cron.domStar && cron.dowStar) dayMatch = true;
    else if (cron.domStar) dayMatch = dowOk;
    else if (cron.dowStar) dayMatch = domOk;
    else dayMatch = domOk || dowOk;

    if (!dayMatch) {
      // Advance to midnight of the NEXT day in zone (not +1 minute — that
      // would round back to today's midnight and spin forever).
      const tomorrow = new Date(probe.getTime() + 24 * 60 * 60_000);
      const zt = inZone(tomorrow, timezone);
      probe = fromZone({ year: zt.year, month: zt.month, day: zt.day, hour: 0, minute: 0 }, timezone);
      continue;
    }

    if (!cron.hours.includes(z.hour)) {
      // Try start of next hour.
      probe = new Date(probe.getTime() + (60 - z.minute) * 60_000);
      continue;
    }

    if (!cron.minutes.includes(z.minute)) {
      probe = new Date(probe.getTime() + 60_000);
      continue;
    }

    return probe;
  }

  throw new Error(`No matching time found within ~5 years for cron: ${cronExpr}`);
}

export function isValidCron(expr) {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}
