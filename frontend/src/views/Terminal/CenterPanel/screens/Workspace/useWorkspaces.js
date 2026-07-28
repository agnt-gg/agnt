/**
 * useWorkspaces — workspace/tab state for the Workspaces page. v2.
 *
 * A workspace IS a conversation. It owns:
 *   - one Annie chat channel (`workspace:<id>`, chatType `orchestrator`)
 *   - a list of WIDGET INSTANCES in the exact shape the widget-canvas system
 *     already uses ({ instanceId, widgetId, col, row, cols, rows, collapsed,
 *     visible, zIndex } — see store/features/widgetLayout.js)
 *
 * v2 exists because v1 rendered surfaces through a bespoke pane component.
 * That was wrong: AGNT already has a complete windowing system (WidgetFrame +
 * widgetRegistry + CustomWidgetRenderer) with drag, resize, close, collapse
 * and edit. This module now only decides WHICH instances exist per workspace;
 * everything about how they look and behave belongs to that system.
 *
 * Persistence stays in localStorage so the page needs no schema change to be
 * evaluated. The instance shape is identical to widget_layouts.layout_data,
 * so promoting a workspace to a real custom page later is a data move.
 */

import { ref, computed } from 'vue';
import { getWidget } from '@/canvas/widgetRegistry.js';
import { findEmptySlot, clampInstance, GRID_COLS, GRID_ROWS } from '@/canvas/gridUtils.js';

export const STORAGE_KEY = 'agnt:workspaces:v2';
const LEGACY_KEY = 'agnt:workspaces:v1';

/** v1 surface types → registry widget ids (used only for one-shot migration). */
const LEGACY_SURFACE_WIDGET = {
  workflow: 'workflow-forge',
  tool: 'tool-forge',
  agent: 'agent-forge',
  artifact: 'artifacts',
  traces: 'traces',
  dashboard: 'dashboard',
  goals: 'goals',
  memory: 'memory',
};

const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const blankWorkspace = (name = 'Workspace') => ({
  id: newId('ws'),
  name,
  widgets: [clampInstance({
    instanceId: newId('w'),
    widgetId: 'workspace-chat',
    // Primary chat: chatKey '' binds the workspace's own conversation
    // (workspace:<wsId>). Chats added LATER get chatKey = their instanceId,
    // i.e. their own blank conversation — see addWidget.
    chatKey: '',
    col: 0, row: 0, cols: 4, rows: 8,
    collapsed: false, visible: true, zIndex: 1,
  })],
  createdAt: Date.now(),
});

// clampInstance lives in gridUtils — ONE implementation shared with the
// custom-page store, so both surfaces enforce the identical grid invariant
// (and a fix to one is a fix to both).

/** Default footprint for a widget, from its registry definition. */
function defaultSizeFor(widgetId) {
  const def = getWidget(widgetId);
  return {
    cols: Math.min(def?.defaultSize?.cols || 6, GRID_COLS),
    rows: Math.min(def?.defaultSize?.rows || 4, GRID_ROWS),
  };
}

/**
 * Largest free rectangle on the grid, by area.
 *
 * Brute-force maximal-rectangle scan. The grid is 12x8, so this is ~100 cells
 * and a few thousand comparisons — immeasurable, and far clearer than an
 * incremental structure would be.
 */
export function largestFreeRect(existing) {
  const occupied = Array.from({ length: GRID_ROWS }, () => new Uint8Array(GRID_COLS));
  for (const w of existing) {
    if (w.visible === false) continue;
    for (let r = Math.max(0, w.row); r < Math.min(w.row + w.rows, GRID_ROWS); r++) {
      for (let c = Math.max(0, w.col); c < Math.min(w.col + w.cols, GRID_COLS); c++) {
        occupied[r][c] = 1;
      }
    }
  }

  let best = { col: 0, row: 0, cols: 0, rows: 0, area: 0 };
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (occupied[r][c]) continue;
      // Grow downward, shrinking the usable width as each new row narrows it.
      let width = GRID_COLS;
      for (let rr = r; rr < GRID_ROWS; rr++) {
        let cc = c;
        while (cc < c + width && cc < GRID_COLS && !occupied[rr][cc]) cc++;
        width = cc - c;
        if (width === 0) break;
        const area = width * (rr - r + 1);
        if (area > best.area) best = { col: c, row: r, cols: width, rows: rr - r + 1, area };
      }
    }
  }
  return best;
}

/** Is a footprint entirely free at this origin? */
export function fitsAt(existing, col, row, cols, rows) {
  if (col < 0 || row < 0 || col + cols > GRID_COLS || row + rows > GRID_ROWS) return false;
  return !existing.some((w) =>
    w.visible !== false &&
    col < w.col + w.cols && w.col < col + cols &&
    row < w.row + w.rows && w.row < row + rows);
}

/**
 * Place a widget.
 *
 * 1. Registry default footprint in the first free slot — the common case.
 * 2. If it doesn't fit anywhere, FILL THE LARGEST FREE RECTANGLE instead.
 *    A widget's defaultSize is a preference, not a requirement; a Workflow
 *    Forge that declares 12x8 should still be placeable next to three other
 *    windows, just smaller. Stacking it at the origin (the old behaviour) hid
 *    whatever was already there.
 * 3. Only when the canvas is genuinely full does it overlay at the origin —
 *    which is also what a crowded custom page does.
 */
function placeInstance(existing, widgetId, at = null) {
  const want = defaultSizeFor(widgetId);
  const occupied = existing.filter((w) => w.visible !== false);

  // Explicit drop point (drag from the palette). Honour it when the footprint
  // fits there, shrinking to the grid edge if the user aimed near it.
  if (at) {
    const cols = Math.min(want.cols, GRID_COLS - at.col);
    const rows = Math.min(want.rows, GRID_ROWS - at.row);
    if (cols > 0 && rows > 0 && fitsAt(occupied, at.col, at.row, cols, rows)) {
      return { col: at.col, row: at.row, cols, rows };
    }
    // Aimed at an occupied spot — fall through and pack it properly rather
    // than dropping a window on top of an existing one.
  }

  // Trust but VERIFY WITH THE RIGHT PREDICATE.
  //
  // findEmptySlot never fails: when nothing fits it walks a fallback ladder of
  // smaller footprints and, failing that, returns {col:0,row:0} to overlap at
  // the origin. Both of those answers describe a slot for a DIFFERENT size
  // than the one asked for, so applying `want` to them is wrong — and a bounds
  // check cannot catch it, because a 12x8 at the origin is perfectly in-bounds
  // while covering every other window. fitsAt is the actual question: is this
  // footprint free, here, right now.
  const slot = findEmptySlot(occupied, want.cols, want.rows);
  if (slot && fitsAt(occupied, slot.col, slot.row, want.cols, want.rows)) {
    return { ...slot, ...want };
  }

  // Too big for any gap — fill the biggest one instead of forcing the size.
  const free = largestFreeRect(occupied);
  if (free.area > 0) {
    return {
      col: free.col,
      row: free.row,
      cols: Math.min(want.cols, free.cols),
      rows: Math.min(want.rows, free.rows),
    };
  }

  return { col: 0, row: 0, cols: Math.min(want.cols, GRID_COLS), rows: Math.min(want.rows, GRID_ROWS) };
}

function migrateV1(parsed) {
  const out = { workspaces: [], activeId: parsed.activeId, autoOpen: parsed.autoOpen };
  for (const ws of parsed.workspaces || []) {
    const next = { id: ws.id, name: ws.name, widgets: [], createdAt: ws.createdAt || Date.now() };
    for (const key of ws.surfaces || []) {
      if (key === 'chat') continue;
      const type = key.includes(':') ? key.slice(0, key.indexOf(':')) : key;
      const widgetId = LEGACY_SURFACE_WIDGET[type];
      if (!widgetId) continue;
      const geom = ws.customLayout && ws.geometry?.[key]
        ? ws.geometry[key]
        : placeInstance(next.widgets, widgetId);
      next.widgets.push(clampInstance({
        instanceId: newId('w'),
        widgetId,
        col: geom.col, row: geom.row, cols: geom.cols, rows: geom.rows,
        collapsed: false, visible: true, zIndex: 1,
      }));
    }
    out.workspaces.push(next);
  }
  return out.workspaces.length ? out : null;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.workspaces) && parsed.workspaces.length) {
        for (const ws of parsed.workspaces) {
          // Arrow wrapper is deliberate: `.map(clampInstance)` would pass the index
    // and the array as the grid bounds.
    ws.widgets = Array.isArray(ws.widgets) ? ws.widgets.map((w) => clampInstance(w)) : [];
        }
        return parsed;
      }
    }
    // One-shot migration from the v1 (surface-based) shape.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateV1(JSON.parse(legacy));
      if (migrated) return migrated;
    }
  } catch (e) {
    console.warn('[useWorkspaces] failed to load persisted state:', e);
  }
  return null;
}

/**
 * Conversation channel for a chat widget instance.
 *
 * chatKey '' (or absent — pre-multichat persisted instances) = the primary
 * chat, bound to the workspace's own conversation. Any other chatKey scopes
 * the channel to that instance, giving it an independent, initially BLANK
 * conversation. Deleting a chat and adding a new one must never resurrect
 * the old thread — that is exactly the reported bug.
 */
export function chatChannelFor(wsId, instance) {
  const key = instance && instance.chatKey ? `:${instance.chatKey}` : '';
  return `workspace:${wsId}${key}`;
}

/* ═══════════ per-window navigation history ═══════════
 *
 * A canvas window is a TAB, not a spawn point. Clicking a row inside one
 * should change what that window shows — the way a link changes the page in
 * the tab you clicked it from — instead of minting a new window per click,
 * which is how the canvas filled with near-duplicate screens.
 *
 * History lives on the instance (so it persists with the workspace) and is
 * bounded, because nobody needs a 500-deep back stack for a dashboard.
 */
export const MAX_HISTORY = 25;

/** Current position in an instance's stack, tolerant of pre-history rows. */
export function historyIndexOf(instance) {
  if (!instance || !Array.isArray(instance.history) || !instance.history.length) return 0;
  const i = Number.isInteger(instance.historyIndex) ? instance.historyIndex : instance.history.length - 1;
  return Math.max(0, Math.min(i, instance.history.length - 1));
}

export function canGoBack(instance) {
  return !!instance && Array.isArray(instance.history) && instance.history.length > 1 && historyIndexOf(instance) > 0;
}

export function canGoForward(instance) {
  return !!instance && Array.isArray(instance.history) && historyIndexOf(instance) < instance.history.length - 1;
}

/** instanceId → memoised panel-geometry scope (see panelScopeFor). */
const panelScopes = new Map();

const persisted = load();

const workspaces = ref(persisted?.workspaces || [blankWorkspace('Workspace 1')]);
const activeId = ref(
  persisted?.activeId && workspaces.value.some((w) => w.id === persisted.activeId)
    ? persisted.activeId
    : workspaces.value[0].id,
);
const autoOpen = ref(persisted?.autoOpen !== false);

let saveTimer = null;
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        workspaces: workspaces.value,
        activeId: activeId.value,
        autoOpen: autoOpen.value,
      }));
    } catch (e) {
      console.warn('[useWorkspaces] failed to persist:', e);
    }
  }, 250);
}

export function useWorkspaces() {
  const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) || workspaces.value[0]);
  const activeWidgets = computed(() => active.value.widgets.filter((w) => w.visible !== false));

  // No mode distinction — the workspace is always a widget grid.
  // Chat is a regular widget ('workspace-chat'), not a special pane.

  // The channel auto-open scans and pageState reports: the first visible
  // chat instance's conversation (falls back to the workspace's own channel
  // when no chat widget is on the canvas).
  const chatChannelKey = computed(() => {
    const chat = active.value.widgets.find((w) => w.widgetId === 'workspace-chat' && w.visible !== false);
    return chatChannelFor(active.value.id, chat);
  });

  function setActive(id) {
    if (workspaces.value.some((w) => w.id === id)) {
      activeId.value = id;
      save();
    }
  }

  function createWorkspace(name) {
    const ws = blankWorkspace(name || `Workspace ${workspaces.value.length + 1}`);
    workspaces.value.push(ws);
    activeId.value = ws.id;
    save();
    return ws;
  }

  function closeWorkspace(id) {
    if (workspaces.value.length <= 1) return;
    const idx = workspaces.value.findIndex((w) => w.id === id);
    if (idx === -1) return;
    workspaces.value.splice(idx, 1);
    if (activeId.value === id) {
      activeId.value = workspaces.value[Math.min(idx, workspaces.value.length - 1)].id;
    }
    save();
  }

  function renameWorkspace(id, name) {
    const ws = workspaces.value.find((w) => w.id === id);
    if (!ws || !name) return;
    ws.name = name;
    save();
  }

  /**
   * Add a widget instance to the active workspace.
   *
   * One instance per widgetId here (unlike a custom page, which allows
   * duplicates) because instances are opened programmatically by Annie's tool
   * calls — auto-open firing twice must focus the existing window, not stack
   * a second copy of the same screen on top of it.
   */
  function addWidget(widgetId, at = null) {
    if (!widgetId) return null;
    const ws = active.value;
    // One instance per widgetId — EXCEPT chat. The dedupe exists so Annie's
    // auto-open firing twice focuses the existing window instead of stacking
    // a second copy; chat is opened by the USER, and a user adding a chat
    // wants another conversation, not a focus of the one they already have.
    if (widgetId !== 'workspace-chat') {
      const existing = ws.widgets.find((w) => w.widgetId === widgetId);
      if (existing) {
        existing.visible = true;
        // Dragging an already-open widget onto the canvas MOVES it. The
        // instance is a singleton, so a drop can only mean "put it here".
        if (at) Object.assign(existing, clampInstance({ ...existing, col: at.col, row: at.row }));
        bringToFront(existing.instanceId);
        return existing.instanceId;
      }
    }
    const geom = placeInstance(ws.widgets, widgetId, at);
    const instanceId = newId('w');
    const instance = {
      instanceId,
      widgetId,
      col: geom.col, row: geom.row, cols: geom.cols, rows: geom.rows,
      collapsed: false, visible: true,
      zIndex: nextZ(ws),
    };
    // Every chat added here gets its OWN conversation, keyed by instanceId —
    // always blank, never a resurrected thread. The only chat bound to the
    // workspace conversation is the one blankWorkspace creates (chatKey '').
    if (widgetId === 'workspace-chat') instance.chatKey = instanceId;
    ws.widgets.push(instance);
    save();
    return instanceId;
  }

  function removeWidget(instanceId) {
    const ws = active.value;
    const idx = ws.widgets.findIndex((w) => w.instanceId === instanceId);
    if (idx === -1) return;
    ws.widgets.splice(idx, 1);
    panelScopes.delete(instanceId);
    save();
  }

  /**
   * Point an existing window at a different widget, in place.
   *
   * Geometry is deliberately preserved: navigating a tab does not resize the
   * window it happens in. Forward entries are truncated on a new navigation,
   * same as a browser.
   *
   * @returns {boolean} whether the window actually moved.
   */
  function navigateWidget(instanceId, widgetId) {
    if (!instanceId || !widgetId) return false;
    const w = active.value.widgets.find((x) => x.instanceId === instanceId);
    if (!w || w.widgetId === widgetId) return false;

    const stack = Array.isArray(w.history) && w.history.length ? w.history : [w.widgetId];
    const at = historyIndexOf({ ...w, history: stack });
    const next = stack.slice(0, at + 1);
    next.push(widgetId);

    w.history = next.slice(-MAX_HISTORY);
    w.historyIndex = w.history.length - 1;
    w.widgetId = widgetId;
    bringToFront(instanceId);
    save();
    return true;
  }

  /** Step a window's history. delta -1 = back, +1 = forward. */
  function historyGo(instanceId, delta) {
    const w = active.value.widgets.find((x) => x.instanceId === instanceId);
    if (!w || !Array.isArray(w.history) || !w.history.length) return false;
    const at = historyIndexOf(w) + delta;
    if (at < 0 || at >= w.history.length) return false;
    w.historyIndex = at;
    w.widgetId = w.history[at];
    save();
    return true;
  }

  /**
   * Apply geometry emitted by a WidgetFrame.
   *
   * WidgetFrame does NOT mutate the instance it is given — it previews the
   * change by writing to element style during the gesture, then emits the
   * final grid geometry on mouseup and leaves persistence to its parent
   * (see WidgetCanvas.onDragEnd / onResizeEnd, which dispatch
   * updateWidgetPosition / updateWidgetSize). Without this, the frame
   * re-renders from unchanged props the moment the drag ends and visibly
   * snaps back to its old size — which is exactly what it did.
   *
   * Mirrors the store's UPDATE_WIDGET mutation: assign only what changed.
   */
  function updateWidgetGeometry(instanceId, updates) {
    const w = active.value.widgets.find((x) => x.instanceId === instanceId);
    if (!w || !updates) return;
    // Clamp on write too: the emitted geometry is computed against the CURRENT
    // cell size, so a gesture during a rail resize (or on a stale cell width)
    // can legitimately produce an out-of-grid result.
    Object.assign(w, clampInstance({ ...w, ...updates }));
    save();
  }

  function toggleCollapse(instanceId) {
    const w = active.value.widgets.find((x) => x.instanceId === instanceId);
    if (!w) return;
    w.collapsed = !w.collapsed;
    save();
  }

  const nextZ = (ws) => ws.widgets.reduce((m, w) => Math.max(m, w.zIndex || 1), 9) + 1;

  function bringToFront(instanceId) {
    const ws = active.value;
    const w = ws.widgets.find((x) => x.instanceId === instanceId);
    if (!w) return;
    w.zIndex = nextZ(ws);
    save();
  }

  function setAutoOpen(v) {
    autoOpen.value = !!v;
    save();
  }

  /* ═══════════ per-window panel geometry ═══════════
   *
   * Embedded screens run the app's REAL panel system (BaseScreen), which by
   * default persists its widths to the global vuex theme store — one shared
   * pair of numbers for the whole application. That is right when there is
   * one screen and catastrophic when there are six: dragging the sidebar in
   * one window would resize it in every other window AND in the standalone
   * app.
   *
   * BaseScreen therefore takes an injectable { get, set } scope. This is the
   * workspace's implementation, stored on the instance so a window remembers
   * its own sidebars across reloads. The scope object identity is memoised
   * per instance because it is `provide`d — a fresh object each render would
   * re-provide on every tick.
   */
  function panelScopeFor(instanceId) {
    let scope = panelScopes.get(instanceId);
    if (scope) return scope;
    scope = {
      get(key) {
        const w = active.value.widgets.find((x) => x.instanceId === instanceId);
        return w && w.panels ? w.panels[key] : undefined;
      },
      set(key, value) {
        const w = active.value.widgets.find((x) => x.instanceId === instanceId);
        if (!w) return;
        if (!w.panels) w.panels = {};
        if (w.panels[key] === value) return;
        w.panels[key] = value;
        save();
      },
    };
    panelScopes.set(instanceId, scope);
    return scope;
  }

  return {
    workspaces,
    activeId,
    active,
    activeWidgets,
    autoOpen,
    chatChannelKey,
    setActive,
    createWorkspace,
    closeWorkspace,
    renameWorkspace,
    addWidget,
    removeWidget,
    navigateWidget,
    historyGo,
    panelScopeFor,
    updateWidgetGeometry,
    toggleCollapse,
    bringToFront,
    setAutoOpen,
    save,
  };
}
