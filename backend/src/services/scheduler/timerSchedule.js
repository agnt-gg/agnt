import { nextFireTime } from './cronParser.js';

/**
 * When does a Timer Trigger fire next? Pure: no clock, no timers, no database.
 *
 * The trigger used to answer this with "the interval, counted from now", which
 * is only correct for a process that never stops. A hosted instance sleeps, so
 * the answer has to be an absolute time that can be written down, handed to the
 * fleet, and recomputed identically after a restart.
 *
 * Fixed intervals keep their phase from an ANCHOR (the moment the user switched
 * the workflow on): a 15-minute timer activated at 10:07 fires at 10:22, 10:37,
 * ... forever, including across restarts. Calendar schedules (Specific Time,
 * Monthly) go through the same cron engine the Scheduler uses, in an explicit
 * time zone, because "09:00" means nothing without one.
 */

export const INTERVAL_MS = Object.freeze({
  'Every Minute': 60_000,
  'Every 5 Minutes': 5 * 60_000,
  'Every 15 Minutes': 15 * 60_000,
  'Every 30 Minutes': 30 * 60_000,
  Hourly: 60 * 60_000,
  Daily: 24 * 60 * 60_000,
  Weekly: 7 * 24 * 60 * 60_000,
});

export const SCHEDULE_OPTIONS = Object.freeze([...Object.keys(INTERVAL_MS), 'Monthly']);

const CRON_DAY = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

/** The zone this process runs in. Desktop: the user's. Hosted containers: UTC. */
export function processTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise and validate a timer node's parameters. Throws a message a user can
 * act on — it is shown on the node — rather than letting a bad value surface as
 * a NaN delay or, for Specific Time with no days ticked, an infinite loop (the
 * old calculator spun forever looking for a matching weekday).
 */
export function resolveTimerSpec(parameters = {}, { defaultTimeZone = processTimeZone() } = {}) {
  const scheduleType = parameters.scheduleType || 'Interval';
  const timeZone = parameters.timezone || defaultTimeZone;
  if (!isValidTimeZone(timeZone)) throw new Error(`Unknown time zone: ${timeZone}`);

  if (scheduleType === 'Interval') {
    const schedule = parameters.schedule;
    if (!SCHEDULE_OPTIONS.includes(schedule)) throw new Error(`Invalid schedule: ${schedule}`);
    if (schedule === 'Monthly') return { kind: 'cron', cron: '0 0 1 * *', timeZone, key: `monthly|${timeZone}` };
    return { kind: 'interval', intervalMs: INTERVAL_MS[schedule], timeZone, key: `interval|${schedule}` };
  }

  if (scheduleType === 'Specific Time') {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(parameters.specificTime || '').trim());
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new Error('Specific Time needs a time of day (HH:MM)');
    }
    const days = (Array.isArray(parameters.specificDays) ? parameters.specificDays : [])
      .map((day) => CRON_DAY[day])
      .filter((day) => day !== undefined);
    if (days.length === 0) throw new Error('Specific Time needs at least one day selected');
    const uniqueDays = [...new Set(days)].sort((a, b) => a - b);
    const cron = `${Number(match[2])} ${Number(match[1])} * * ${uniqueDays.join(',')}`;
    return { kind: 'cron', cron, timeZone, key: `cron|${cron}|${timeZone}` };
  }

  throw new Error(`Invalid scheduleType: ${scheduleType}`);
}

/**
 * First fire time strictly after `after` (epoch ms).
 *
 * `anchorAt` fixes the phase of fixed intervals and is ignored by calendar
 * schedules. Strictly-after matters: the caller passes the fire time it just
 * served, and must never get the same slot back.
 */
export function nextFireAt(spec, { anchorAt, after }) {
  if (spec.kind === 'interval') {
    if (!Number.isFinite(anchorAt)) throw new Error('Interval timers need an anchor');
    if (after < anchorAt) return anchorAt + spec.intervalMs;
    const elapsed = Math.floor((after - anchorAt) / spec.intervalMs) + 1;
    return anchorAt + elapsed * spec.intervalMs;
  }
  return nextFireTime(spec.cron, new Date(after), spec.timeZone).getTime();
}
