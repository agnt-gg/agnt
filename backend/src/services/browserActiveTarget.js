/**
 * Which tab the agent is working in, and which tabs belong to whom.
 *
 * The driver (browserActDriver) and the viewer (BrowserScreencastService) hold
 * SEPARATE CDP connections to one browser. Each used to pick "the first page
 * target" on its own, so the moment the agent opened or switched tabs the two
 * diverged: the agent worked in tab B while the live view kept streaming tab A
 * — often about:blank. From the user's chair that is a blank browser.
 *
 * The driver is the authority on where work happens, so it records the tab
 * here and the viewer follows. A leaf module (no imports) so neither service
 * has to import the other.
 *
 * ---------------------------------------------------------------------------
 * SCOPES: WHY THIS IS NOT KEYED BY ENDPOINT ANY MORE
 * ---------------------------------------------------------------------------
 * The launched browser is ONE Chrome shared by every conversation, so one
 * endpoint used to mean one shared "current tab": conversation B moving tabs
 * moved conversation A's agent and A's live view with it. Everything here is
 * now keyed by a SCOPE:
 *
 *   - a CONFINED scope (a conversation's lane, see browserLanes.js) sees only
 *     the tabs it owns, plus the popups those tabs open;
 *   - any other scope (a widget bridge, the shared default tab) is keyed by
 *     its endpoint exactly as before, and sees every tab NO lane owns.
 *
 * So lanes cannot see each other, and the shared default cannot see lanes.
 * Ownership is in memory on purpose: a tab id means nothing once the browser
 * that issued it is gone, and a restart starts every lane afresh.
 */

/** scope -> targetId */
const activeTargets = new Map();

/** targetId -> owning confined scope. Unowned tabs belong to the default view. */
const owners = new Map();

/** Scopes that see only their own tabs. */
const confined = new Set();

/** Listeners notified when the agent moves to another tab. */
const listeners = new Set();

/**
 * The scope a surface's tabs are tracked under: its own id when it is a
 * confined lane, otherwise its endpoint (the behaviour before lanes existed).
 */
export function scopeFor(instanceId, cdpUrl) {
  return instanceId && confined.has(instanceId) ? instanceId : cdpUrl;
}

/** Make a scope see only its own tabs. Idempotent. */
export function confineScope(scope) {
  if (scope) confined.add(scope);
}

export function isConfined(scope) {
  return confined.has(scope);
}

/** Record that a confined scope owns a tab. */
export function claimTab(scope, targetId) {
  if (!scope || !targetId || !confined.has(scope)) return;
  owners.set(targetId, scope);
}

/** Which scope owns this tab, or null when it belongs to the default view. */
export function tabOwner(targetId) {
  return owners.get(targetId) || null;
}

/** Tab ids a scope owns right now (after the last visiblePages call pruned it). */
export function ownedTabs(scope) {
  return [...owners.entries()].filter(([, owner]) => owner === scope).map(([id]) => id);
}

/**
 * The page targets a scope may see, from a fresh Target.getTargets list.
 *
 * Popups follow their opener: a page whose openerId is a lane's tab joins that
 * lane, transitively, so "click opened a new tab" stays in the conversation
 * that clicked. Tabs of this scope that are no longer in the list are dropped,
 * which keeps the ownership map bounded by the tabs that actually exist.
 */
export function visiblePages(scope, targetInfos = []) {
  const pages = targetInfos.filter((t) => t.type === 'page');
  const live = new Set(pages.map((p) => p.targetId));
  for (const [id, owner] of owners) {
    if (owner === scope && !live.has(id)) owners.delete(id);
  }

  // Bounded: each pass claims at least one page or stops.
  for (let changed = true; changed;) {
    changed = false;
    for (const page of pages) {
      if (!owners.has(page.targetId) && page.openerId && owners.has(page.openerId)) {
        owners.set(page.targetId, owners.get(page.openerId));
        changed = true;
      }
    }
  }

  if (confined.has(scope)) return pages.filter((p) => owners.get(p.targetId) === scope);
  return pages.filter((p) => !owners.has(p.targetId));
}

export function setActiveTarget(scope, targetId) {
  if (!scope || !targetId) return;
  if (activeTargets.get(scope) === targetId) return;
  activeTargets.set(scope, targetId);
  for (const listener of listeners) {
    try { listener(scope, targetId); } catch (err) { console.warn('[BrowserActiveTarget] listener failed:', err.message); }
  }
}

export function getActiveTarget(scope) {
  return activeTargets.get(scope) || null;
}

/** The browser behind this scope is gone; its tab ids mean nothing now. */
export function forgetActiveTarget(scope) {
  activeTargets.delete(scope);
}

/** A lane closed: forget its tabs, its current tab and its confinement. */
export function releaseScope(scope) {
  for (const [id, owner] of owners) {
    if (owner === scope) owners.delete(id);
  }
  activeTargets.delete(scope);
  confined.delete(scope);
}

export function onActiveTargetChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Test seam. Clears tab state only: listeners are wiring registered once at
 * module load (BrowserScreencastService), and clearing them would silently
 * disconnect the viewer from the driver for the rest of the process.
 */
export function _resetActiveTargets() {
  activeTargets.clear();
  owners.clear();
  confined.clear();
}
