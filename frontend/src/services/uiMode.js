/**
 * Focused vs Studio — which shell frames the app.
 *
 * ONE APP, TWO SHELLS. Both modes render the same screens, stores, chat
 * pipeline, auth and theme. The mode decides only the FRAME around them:
 *
 *   focused — one input, recents, a library under your name (views/Focused).
 *   studio — the full canvas: rail, toolbar, panels, forges (canvas/).
 *
 * The mode is presentation, not entitlement: it is unrelated to the billing
 * plan, and nothing a user can do is gated on it. Focused has its own page for
 * every screen it can (views/Focused/focusedRoutes.js); only a Studio-only
 * screen (a forge, the run traces) renders in full, with a way back.
 *
 * Persistence rides the existing preference sync (theme store → MUTATION_MAP
 * → /api/users/preferences, global scope), so the choice follows the account
 * across devices with no new endpoint.
 */

export const UI_MODES = Object.freeze(['focused', 'studio']);

/**
 * The mode an account gets before it has ever chosen.
 *
 * Studio, deliberately, until Focused covers every action the AGNT One demo
 * has. Flipping this is the Phase 6 launch decision, and it is one line so
 * that it stays a decision rather than a refactor.
 */
export const DEFAULT_UI_MODE = 'studio';

/** The storage key, shared by theme.js (localStorage) and the sync schema. */
export const UI_MODE_STORAGE_KEY = 'uiMode';

/**
 * Earlier names for a mode, read as the current one. The Focused shell was
 * called "Simple" while it was built; a browser that saved that keeps its
 * choice instead of falling back to the default.
 */
const LEGACY_MODES = Object.freeze({ simple: 'focused' });

/** A valid mode, or null for anything else (absent, hand-edited). */
export function normalizeUiMode(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  const current = LEGACY_MODES[trimmed] || trimmed;
  return UI_MODES.includes(current) ? current : null;
}

/**
 * The mode to show. An explicit choice always wins; otherwise the default.
 * Garbage in storage degrades to the default instead of to a blank shell.
 */
export function resolveUiMode({ explicit, fallback = DEFAULT_UI_MODE } = {}) {
  return normalizeUiMode(explicit) ?? normalizeUiMode(fallback) ?? DEFAULT_UI_MODE;
}

/** The other mode — what the toggle switches to. */
export function otherUiMode(mode) {
  return resolveUiMode({ explicit: mode }) === 'focused' ? 'studio' : 'focused';
}

/** Read the stored choice without throwing (private mode, SSR, tests). */
export function readStoredUiMode(storage = globalThis.localStorage) {
  try {
    return normalizeUiMode(storage?.getItem(UI_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Human labels, one place, so copy cannot drift between toggle and menu. */
export const UI_MODE_LABELS = Object.freeze({
  focused: 'Focused',
  studio: 'Studio',
});

/**
 * Is this keyboard event the mode toggle (Ctrl/⌘ + Shift + S)?
 * Verified free across the tracked repo when it was chosen.
 */
export function isUiModeToggleKey(event) {
  if (!event || event.altKey) return false;
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return false;
  return typeof event.key === 'string' && event.key.toLowerCase() === 's';
}
