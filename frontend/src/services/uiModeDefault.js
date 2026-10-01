/**
 * Which shell an account starts in, and when Focused offers Studio.
 *
 * DEFAULTS (decided once, then saved as the account's choice):
 *   new account      → Focused. Nothing built yet, so nothing to lose.
 *   existing account → Studio. It is the app they already know; Focused is
 *                      offered once (TryFocusedNote), never imposed.
 *
 * "New" means no conversations, agents or workflows. Connections are NOT a
 * signal: connecting an AI provider is the first thing onboarding asks for,
 * so counting them would classify every new account as existing.
 *
 * GRADUATION: Focused suggests Studio once, the first time the person builds a
 * workflow or an agent (a navigation-onion unlock). The app may suggest moving
 * up; it never moves anyone back down to Focused on its own.
 */

/** 'new' | 'existing' | null when the facts have not loaded yet. */
export function classifyAccount({ chats, agents, workflows } = {}) {
  const known = [chats, agents, workflows].every((n) => Number.isFinite(n));
  if (!known) return null;
  return chats + agents + workflows === 0 ? 'new' : 'existing';
}

export function defaultModeFor(kind) {
  return kind === 'new' ? 'focused' : 'studio';
}

/** Onion unlocks that mean "you are building now". */
export const GRADUATION_UNLOCKS = Object.freeze(['workflows', 'agents']);

/** The unlock to offer Studio for, or null. Asked once per account, ever. */
export function graduationUnlock(fresh, alreadyAsked) {
  if (alreadyAsked) return null;
  const ids = Array.isArray(fresh) ? fresh : [];
  return GRADUATION_UNLOCKS.find((id) => ids.includes(id)) || null;
}

export const GRADUATION_COPY = Object.freeze({
  workflows: 'Your first workflow is saved.',
  agents: 'Your first agent is ready.',
});

// Per-browser flags. Not synced: they are about what THIS screen has shown.
export const INTRO_SEEN_KEY = 'agnt:focused-intro-seen';
export const GRADUATION_ASKED_KEY = 'agnt:focused-graduation-asked';

export function readFlag(key, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function writeFlag(key, storage = globalThis.localStorage) {
  try {
    storage?.setItem(key, 'true');
  } catch {
    /* storage disabled: the note may show again next session, which is safe */
  }
}
