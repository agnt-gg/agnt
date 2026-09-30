/**
 * Which tab the agent is working in, per browser endpoint.
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
 */

/** cdpUrl -> targetId */
const activeTargets = new Map();

/** Listeners notified when the agent moves to another tab. */
const listeners = new Set();

export function setActiveTarget(cdpUrl, targetId) {
  if (!cdpUrl || !targetId) return;
  if (activeTargets.get(cdpUrl) === targetId) return;
  activeTargets.set(cdpUrl, targetId);
  for (const listener of listeners) {
    try { listener(cdpUrl, targetId); } catch (err) { console.warn('[BrowserActiveTarget] listener failed:', err.message); }
  }
}

export function getActiveTarget(cdpUrl) {
  return activeTargets.get(cdpUrl) || null;
}

/** The browser behind this endpoint is gone; its tab ids mean nothing now. */
export function forgetActiveTarget(cdpUrl) {
  activeTargets.delete(cdpUrl);
}

export function onActiveTargetChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Test seam. Clears the tab map only: listeners are wiring registered once at
 * module load (BrowserScreencastService), and clearing them would silently
 * disconnect the viewer from the driver for the rest of the process.
 */
export function _resetActiveTargets() {
  activeTargets.clear();
}
