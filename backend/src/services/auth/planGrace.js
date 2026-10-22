/**
 * The grace period for free accounts that were already over the new limits.
 *
 * When the free limits arrived (2026-10-21), some free accounts already had
 * more automatic workflows running than the free plan allows. Switching them
 * off overnight would break people's automations without warning, and they run
 * on the user's own machine, so letting them finish the month costs nothing.
 * So at restore, an owner over the limit gets GRACE_DAYS from the first time
 * that was seen; after that only the allowed number is restored.
 *
 * Kept on disk next to the cached licences. Editing the file only moves a
 * date the user could reach anyway by not updating; it grants nothing paid.
 */
import fs from 'node:fs';
import path from 'node:path';
import pathManager from '../../utils/PathManager.js';

export const GRACE_DAYS = 14;

const file = () => pathManager.getDataPath('licences', 'plan-grace.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) || {};
  } catch {
    return {};
  }
}

/** Is this owner inside their grace period? Starts it on first ask. */
export function graceActive(userId, now = Date.now()) {
  if (!userId) return false;
  const started = read();
  if (!started[userId]) {
    started[userId] = now;
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(started));
    } catch (error) {
      console.warn('[planGrace] could not record the grace start:', error.message);
    }
  }
  return now - started[userId] < GRACE_DAYS * 86_400_000;
}

/** When this owner's grace ends (ms), or null if it has not started. */
export function graceEndsAt(userId) {
  const startedAt = read()[userId];
  return startedAt ? startedAt + GRACE_DAYS * 86_400_000 : null;
}
