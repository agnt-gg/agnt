/**
 * What the journey remembers about one person: finished missions, turned-down
 * offers, recorded choices, and whether the checklist is hidden.
 *
 * Keyed per account, so two people sharing a machine do not finish each
 * other's missions. Keyed by mission id, never by step index: the old tours
 * stored "steps seen" by position, so adding one step marked a different step
 * as seen. A mission's id survives its steps being rewritten.
 *
 * The two switches are the ones Settings → Tours has always written, kept so
 * a person who turned tours off stays off.
 */

const KEY_PREFIX = 'agnt.journey.v1';
export const TOURS_ENABLED_KEY = 'tours_enabled';
export const TOURS_AUTO_START_KEY = 'tours_auto_start';

const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function emptyProgress() {
  return { done: {}, dismissed: {}, flags: {}, checklistHidden: false, celebrated: false };
}

export function progressKey(account) {
  return `${KEY_PREFIX}:${String(account || 'anonymous').toLowerCase()}`;
}

const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const booleans = (value) => (isRecord(value) ? Object.fromEntries(Object.entries(value).filter(([, v]) => v === true)) : {});

/** Anything malformed in storage reads as a fresh start, never as a crash. */
export function normalizeProgress(raw) {
  if (!isRecord(raw)) return emptyProgress();
  return {
    done: booleans(raw.done),
    dismissed: booleans(raw.dismissed),
    flags: booleans(raw.flags),
    checklistHidden: raw.checklistHidden === true,
    celebrated: raw.celebrated === true,
  };
}

export function loadProgress(account, storage = defaultStorage()) {
  try {
    const text = storage?.getItem(progressKey(account));
    return normalizeProgress(text ? JSON.parse(text) : null);
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(account, progress, storage = defaultStorage()) {
  const clean = normalizeProgress(progress);
  try {
    storage?.setItem(progressKey(account), JSON.stringify(clean));
  } catch (error) {
    // Quota or private mode: the journey still works this session.
    console.warn('[journey] could not save progress:', error?.message || error);
  }
  return clean;
}

export function toursEnabled(storage = defaultStorage()) {
  return storage?.getItem(TOURS_ENABLED_KEY) !== 'false';
}

/** "Auto-start": whether pages offer their mission on a first visit. */
export function offersEnabled(storage = defaultStorage()) {
  return toursEnabled(storage) && storage?.getItem(TOURS_AUTO_START_KEY) !== 'false';
}
