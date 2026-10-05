/**
 * Whether a screen's left or right panel is collapsed: remembered PER SCREEN.
 *
 * It used to be one app-wide value. Every screen started from it, wrote to
 * it, and (being kept alive) watched it, so closing the right panel on Chat
 * closed it on every page. Only Chat's right panel had its own memory
 * (screenRegistry `rightCollapsedDefault`); every other panel shared.
 *
 * A screen that has never been toggled starts from:
 *   - its registry default (right panel), else
 *   - the old app-wide value, so nobody's current layout changes on upgrade.
 * After the first toggle it remembers its own choice under its own key and
 * nothing else reads or writes that key.
 *
 * Reactive, so PanelBackdrop (which paints the panel surfaces for the screen
 * about to render) agrees with the screen itself. The keys are stable:
 * `rightPanelCollapsed:<screenId>` is the key Chat already used.
 */
import { reactive } from 'vue';
import { rightCollapsedDefault } from './screenRegistry.js';

const SIDES = Object.freeze(['left', 'right']);
const LEGACY_KEY = Object.freeze({ left: 'leftPanelCollapsed', right: 'rightPanelCollapsed' });
const state = reactive({});

export const panelCollapseKey = (side, screenId) => `${side}PanelCollapsed:${screenId}`;

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readStored(key) {
  const value = storage()?.getItem(key);
  return value === null || value === undefined ? undefined : value === 'true';
}

function initial(side, screenId) {
  const saved = readStored(panelCollapseKey(side, screenId));
  if (saved !== undefined) return saved;
  if (side === 'right') {
    const registry = rightCollapsedDefault(screenId);
    if (registry !== undefined) return registry;
  }
  return readStored(LEGACY_KEY[side]) ?? false;
}

function assertSide(side) {
  if (!SIDES.includes(side)) throw new Error(`panel side must be left or right, got ${side}`);
}

/** Whether `side` is collapsed on `screenId`. */
export function isPanelCollapsed(side, screenId) {
  assertSide(side);
  const key = panelCollapseKey(side, screenId);
  if (!(key in state)) state[key] = initial(side, screenId);
  return state[key];
}

/** Remember `side` collapsed (or not) on `screenId` only. */
export function setPanelCollapsed(side, screenId, collapsed) {
  assertSide(side);
  const key = panelCollapseKey(side, screenId);
  state[key] = !!collapsed;
  try {
    storage()?.setItem(key, String(!!collapsed));
  } catch {
    // Private mode / quota: the toggle still works this session.
  }
}

/** Tests only: forget what was read, so the next read hits storage again. */
export function __resetPanelCollapseForTests() {
  for (const key of Object.keys(state)) delete state[key];
}
