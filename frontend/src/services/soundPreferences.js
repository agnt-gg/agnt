/**
 * Sound preferences — the single source of truth for what plays, how loud, and
 * whether it plays at all.
 *
 * There are two layers:
 *
 *   master — the global on/off and volume that have always existed
 *            (localStorage: `soundsEnabled`, `soundVolume`)
 *   event  — per-sound overrides, stored as one JSON blob
 *            (localStorage: `soundEventPrefs`)
 *
 * Effective volume is master x event. Every event defaults to a 1.0 multiplier,
 * so an install that has never touched a per-event control behaves EXACTLY as
 * it did before this module existed: the master slider is the only thing in the
 * signal path. That equivalence is pinned by a test, because it is the whole
 * safety argument for introducing a second layer.
 *
 * The catalog below is also the sound registry itself — `TerminalLayout` reads
 * its file paths from here rather than keeping a private map, so a sound cannot
 * exist in the app without being declarable in Settings.
 */

const MASTER_ENABLED_KEY = 'soundsEnabled';
const MASTER_VOLUME_KEY = 'soundVolume';
const EVENT_PREFS_KEY = 'soundEventPrefs';

/** Matches the historical default in TerminalLayout.playSound. */
export const DEFAULT_MASTER_VOLUME = 0.3;

/** The audio assets shipped in `frontend/public/sounds`. */
export const SOUND_FILES = [
  { src: '/sounds/success-chime.mp3', label: 'Success chime' },
  { src: '/sounds/cha-ching-money.mp3', label: 'Cha-ching' },
  { src: '/sounds/woosh_s21KzKN.mp3', label: 'Woosh' },
  { src: '/sounds/mouse-click.mp3', label: 'Mouse click' },
  { src: '/sounds/shutter-click.mp3', label: 'Shutter click' },
  { src: '/sounds/typewriter-keypress.mp3', label: 'Typewriter key' },
  { src: '/sounds/go-on-nerd-go-outside.mp3', label: 'Go outside, nerd' },
];

/**
 * Every sound the app can play.
 *
 * `configurable: true` surfaces the event as its own row in Settings → Sounds.
 * Flip the flag to expose another one; the panel is generated from this list,
 * so no UI change is required.
 */
export const SOUND_EVENTS = [
  {
    id: 'chatUnread',
    label: 'Conversation Complete',
    description: 'Plays when a run finishes and a conversation has a new message waiting',
    icon: 'fas fa-comment-dots',
    defaultSrc: '/sounds/success-chime.mp3',
    configurable: true,
  },
  { id: 'buttonClick', label: 'Button Click', defaultSrc: '/sounds/mouse-click.mp3', configurable: false },
  { id: 'shutterClick', label: 'Shutter', defaultSrc: '/sounds/shutter-click.mp3', configurable: false },
  { id: 'typewriterKeyPress', label: 'Typewriter Key', defaultSrc: '/sounds/typewriter-keypress.mp3', configurable: false },
  { id: 'chaChingMoney', label: 'Cha-ching', defaultSrc: '/sounds/cha-ching-money.mp3', configurable: false },
  { id: 'getOuttaHereNerd', label: 'Go Outside, Nerd', defaultSrc: '/sounds/go-on-nerd-go-outside.mp3', configurable: false },
];

const EVENTS_BY_ID = new Map(SOUND_EVENTS.map((event) => [event.id, event]));

/** Defaults for an event nobody has touched: audible, full multiplier, stock file. */
export const DEFAULT_EVENT_PREFERENCES = { enabled: true, volume: 1 };

function clamp01(value, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode / disabled storage. Sounds are not worth an exception.
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function getSoundEvent(eventId) {
  return EVENTS_BY_ID.get(eventId) || null;
}

export function getConfigurableSoundEvents() {
  return SOUND_EVENTS.filter((event) => event.configurable);
}

export function getMasterEnabled() {
  const raw = readStorage(MASTER_ENABLED_KEY);
  return raw === null ? true : raw === 'true';
}

export function setMasterEnabled(enabled) {
  writeStorage(MASTER_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getMasterVolume() {
  return clamp01(readStorage(MASTER_VOLUME_KEY), DEFAULT_MASTER_VOLUME);
}

export function setMasterVolume(volume) {
  writeStorage(MASTER_VOLUME_KEY, String(clamp01(volume, DEFAULT_MASTER_VOLUME)));
}

function readAllEventPreferences() {
  const raw = readStorage(EVENT_PREFS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // An array or a primitive is corrupt for our purposes; fall back to defaults
    // rather than letting a bad blob poison every lookup.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Resolved preferences for one event, always complete and always in range.
 * Unknown ids get defaults so a caller never has to null-check.
 */
export function getEventPreferences(eventId) {
  const definition = getSoundEvent(eventId);
  const stored = readAllEventPreferences()[eventId];
  const entry = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};

  return {
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : DEFAULT_EVENT_PREFERENCES.enabled,
    volume: clamp01(entry.volume, DEFAULT_EVENT_PREFERENCES.volume),
    src: typeof entry.src === 'string' && entry.src ? entry.src : definition?.defaultSrc || null,
  };
}

export function setEventPreferences(eventId, patch = {}) {
  const all = readAllEventPreferences();
  const current = all[eventId] && typeof all[eventId] === 'object' ? all[eventId] : {};
  const next = { ...current };

  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (patch.volume !== undefined) next.volume = clamp01(patch.volume, DEFAULT_EVENT_PREFERENCES.volume);
  if (patch.src !== undefined) next.src = typeof patch.src === 'string' && patch.src ? patch.src : undefined;
  if (next.src === undefined) delete next.src;

  all[eventId] = next;
  writeStorage(EVENT_PREFS_KEY, JSON.stringify(all));
  notifySoundSettingsChanged();
  return getEventPreferences(eventId);
}

export function resetEventPreferences(eventId) {
  const all = readAllEventPreferences();
  delete all[eventId];
  writeStorage(EVENT_PREFS_KEY, JSON.stringify(all));
  notifySoundSettingsChanged();
  return getEventPreferences(eventId);
}

/**
 * Broadcast for anything holding derived state. The detail shape is unchanged
 * from the original `sounds-settings-changed` contract so existing listeners
 * keep working.
 */
export function notifySoundSettingsChanged() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(
    new CustomEvent('sounds-settings-changed', {
      detail: { enabled: getMasterEnabled(), volume: getMasterVolume() },
    })
  );
}

/**
 * Decide whether `eventId` should be audible right now, and at what level.
 *
 * Returns `null` when nothing should play — master off, event off, effective
 * volume zero, or an unregistered id. Callers treat null as "stay silent"; the
 * distinction between "muted" and "unknown sound" is available via
 * `getSoundEvent` for callers that want to warn.
 *
 * `volumeOverride` replaces the master level for one call (the existing
 * `playSound(name, 0.15)` contract). The event multiplier still applies, so a
 * user who turns an event down is respected even by callers that hardcode a
 * level.
 */
export function resolveSound(eventId, volumeOverride = null) {
  const definition = getSoundEvent(eventId);
  if (!definition) return null;
  if (!getMasterEnabled()) return null;

  const prefs = getEventPreferences(eventId);
  if (!prefs.enabled) return null;

  const base = volumeOverride === null || volumeOverride === undefined ? getMasterVolume() : clamp01(volumeOverride, getMasterVolume());

  const volume = clamp01(base * prefs.volume, 0);
  if (volume <= 0) return null;

  const src = prefs.src || definition.defaultSrc;
  if (!src) return null;

  return { src, volume };
}
