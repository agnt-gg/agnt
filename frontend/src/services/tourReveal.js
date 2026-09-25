// tourReveal — a guided tour can point at a rail row the account has not
// unlocked yet.
//
// The rail grows with the account (navigationOnion.js): a new account sees only
// Chat. But the assistant's tours address rows by id ('sidebar.tools', …) from
// a fixed registry, so on a young account a step naming a locked row pointed
// at an element that did not exist and the popup explained empty space.
//
// Being shown a row by the assistant is as good a reason to have it as earning
// it, so the row is unlocked the same way an earned one is: recorded in the
// onion state, never as a Settings choice. A row the person HID in Settings →
// Navigation stays hidden; a tour does not overrule an explicit decision.

import { loadOnionState, saveOnionState } from '@/services/navigationOnion.js';
import { navigationItems, NAVIGATION_CHANGED_EVENT } from '@/services/navigationPreferences.js';

const SIDEBAR_TARGET = /\[data-tour-id=["']sidebar\.([a-z][a-z0-9-]*)["']\]/;

/** The rail row ids a set of tour steps points at. */
export function sidebarTargets(steps = []) {
  return [...new Set(steps.map((step) => SIDEBAR_TARGET.exec(step?.targetSelector || '')?.[1]).filter(Boolean))];
}

/**
 * Put every hidden-but-hideable rail row the steps point at on the rail.
 * @returns {string[]} the ids that were revealed
 */
export function revealSidebarTargets(steps = []) {
  const ids = sidebarTargets(steps);
  if (ids.length === 0) return [];
  const items = navigationItems([]);
  const revealed = ids.filter((id) => {
    const item = items.find((candidate) => candidate.id === id && candidate.type !== 'page');
    return item && !item.visible && !item.explicit;
  });
  if (revealed.length === 0) return [];
  const onion = loadOnionState();
  saveOnionState({
    ...onion,
    unlocked: [...new Set([...onion.unlocked, ...revealed])],
    seeded: [...new Set([...onion.seeded, ...revealed])],
  });
  window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED_EVENT));
  return revealed;
}
