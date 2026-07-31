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

import { STORAGE_KEY, LEGACY_KEY, CHAT_STORAGE_KEY, RECOVERY_FLAG } from './workspaceStorage.js';

// Cross-device workspace sync. OFF by default: localStorage stays the source
// of truth and boot is unchanged. When true, the server (/api/workspaces,
// backed by widget_layouts rows keyed route='workspace:<id>') becomes the
// synced store, reconciled AFTER mount via hydrateFromServer(). Last-write-wins
// per workspace on an updatedAt epoch carried inside each workspace object.
const SYNC_ENABLED = false;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`/api/workspaces${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`workspaces api ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// Re-exported for existing importers; new callers that want a key WITHOUT
// booting this singleton should import from './workspaceStorage.js' directly.
export { STORAGE_KEY };

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
  // Per-workspace AI provider override. null = inherit global default.
  // Rides sync (lives inside the workspace object). See workspace-sync package.
  ai: null,
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

/**
 * How much of the empty-space prompt fits in a gap this size?
 *
 * Measured in PIXELS, deliberately. A gap's cell count says nothing about
 * whether "Empty canvas" fits inside it — cellWidth is (containerWidth +
 * GAP) / 12, so the same 3x2 gap is 90px wide in a narrow window and 400px
 * wide on a monitor. Pixels are the thing the text actually has to fit into.
 *
 * Thresholds are the rendered sizes of the tiers themselves: the hint line is
 * ~240px unwrapped, icon + label stack ~140px, and below ~64x52 an icon is
 * just noise in a sliver.
 *
 * @returns {'full'|'compact'|'mark'|null} null = leave the gap alone.
 */
export function emptyTierFor(width, height) {
  if (width >= 260 && height >= 148) return 'full';
  if (width >= 148 && height >= 84) return 'compact';
  if (width >= 64 && height >= 52) return 'mark';
  return null;
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

/* ═══════════ recovering conversations orphaned by id churn ═══════════
 *
 * A workspace's id IS its conversation address (`workspace:<id>`). Until this
 * module persisted at creation, a workspace minted at load and never mutated
 * was never written down — so the next load minted a DIFFERENT id and the
 * previous thread became unaddressable while still occupying storage. Every
 * such thread is still on disk; it just has no workspace pointing at it.
 *
 * This pass re-attaches them: an orphaned conversation IS a lost workspace, so
 * recovering one means re-creating the workspace with its original id. It runs
 * ONCE (flag-guarded) — after that, closing a workspace is a deliberate act and
 * must stay closed rather than resurrecting itself on the next reload.
 */
export const MAX_RECOVERED_WORKSPACES = 12;

/** Welcome banners are injected per mount and are not user content. */
const isWelcomeMessage = (m) => typeof m?.id === 'string' && m.id.includes('-welcome-');

/**
 * Every persisted chat channel, from the live store AND from the abandoned
 * per-channel split keys. Reading both removes any dependency on which module
 * initialised first — chatUnified folds the split keys back in at boot, but
 * this must be correct even if it hasn't yet.
 */
export function readChatChannels() {
  const out = {};
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) Object.assign(out, JSON.parse(raw) || {});
  } catch { /* unreadable store — recovery is best-effort by design */ }
  try {
    const prefix = 'conv:unified:workspace:';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const channel = k.slice('conv:unified:'.length);
      if (out[channel]) continue;
      const conv = JSON.parse(localStorage.getItem(k) || 'null');
      if (conv) out[channel] = conv;
    }
  } catch { /* ditto */ }
  return out;
}

/**
 * Group orphaned `workspace:*` channels into recoverable workspaces.
 *
 * Channel shape is `workspace:<wsId>` (primary) or `workspace:<wsId>:<chatKey>`
 * (a chat added later). Ids never contain ':', so the first separator splits
 * them unambiguously. Only groups carrying real user messages are offered —
 * a workspace that only ever showed a welcome banner is not a lost thread.
 *
 * @param {object} channels channelKey → conversation
 * @param {Set<string>} knownIds workspace ids already present
 */
export function findRecoverableWorkspaces(channels, knownIds) {
  const groups = new Map();
  for (const [channel, conv] of Object.entries(channels || {})) {
    if (!channel.startsWith('workspace:')) continue;
    const rest = channel.slice('workspace:'.length);
    const sep = rest.indexOf(':');
    const wsId = sep === -1 ? rest : rest.slice(0, sep);
    const chatKey = sep === -1 ? '' : rest.slice(sep + 1);
    if (!wsId || knownIds.has(wsId)) continue;

    const real = (Array.isArray(conv?.messages) ? conv.messages : []).filter((m) => !isWelcomeMessage(m));
    if (!real.length) continue;

    let group = groups.get(wsId);
    if (!group) {
      group = { id: wsId, chatKeys: [], messageCount: 0, lastUpdate: 0, title: '' };
      groups.set(wsId, group);
    }
    group.chatKeys.push(chatKey);
    group.messageCount += real.length;
    group.lastUpdate = Math.max(group.lastUpdate, Number(conv?.lastUpdate) || 0);
    if (!group.title) {
      const firstUser = real.find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim());
      if (firstUser) group.title = firstUser.content.trim().replace(/\s+/g, ' ').slice(0, 40).trim();
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.lastUpdate - a.lastUpdate)
    .slice(0, MAX_RECOVERED_WORKSPACES);
}

/** Rebuild a workspace around the chats that actually hold content. */
function workspaceFromRecovered(group) {
  // Primary chat first so the tab opens on the workspace's own conversation.
  const chatKeys = [...new Set(group.chatKeys)].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const widgets = [];
  for (const chatKey of chatKeys) {
    const geom = placeInstance(widgets, 'workspace-chat');
    widgets.push(clampInstance({
      instanceId: chatKey || newId('w'),
      widgetId: 'workspace-chat',
      chatKey,
      col: geom.col, row: geom.row, cols: geom.cols, rows: geom.rows,
      collapsed: false, visible: true, zIndex: widgets.length + 1,
    }));
  }
  return {
    id: group.id,
    name: group.title || `Recovered ${group.id.slice(-4)}`,
    widgets,
    createdAt: group.lastUpdate || Date.now(),
    recovered: true,
  };
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

// Ids deleted locally that must be removed server-side on next push, so a
// tab closed on one device does not resurrect from another on next sync.
const deletedIds = new Set();
let pushTimer = null;

/** Debounced best-effort push of the whole set (+ deletions) to the server. */
function pushAll() {
  if (!SYNC_ENABLED) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    const stamp = Date.now();
    const payload = {
      workspaces: workspaces.value.map((w, i) => ({
        id: w.id, name: w.name, order: i,
        widgets: w.widgets, ai: w.ai || null,
        updatedAt: w.updatedAt || stamp,
      })),
      deletedIds: [...deletedIds],
    };
    try {
      await apiFetch('', { method: 'PUT', body: JSON.stringify(payload) });
      deletedIds.clear();
    } catch (e) {
      // Offline / server down: keep local state; retry on next save.
      console.warn('[useWorkspaces] sync push failed:', e.message);
    }
  }, 400);
}

/**
 * Reconcile local workspaces with the server AFTER mount (never at import —
 * the sync boot mints the conversation id and must stay synchronous).
 * Last-write-wins per workspace on updatedAt.
 */
async function hydrateFromServer() {
  if (!SYNC_ENABLED) return;
  let remote;
  try { remote = await apiFetch('', { method: 'GET' }); }
  catch (e) { console.warn('[useWorkspaces] hydrate skipped:', e.message); return; }
  if (!remote || !Array.isArray(remote.workspaces)) return;
  const byId = new Map(workspaces.value.map((w) => [w.id, w]));
  for (const r of remote.workspaces) {
    const local = byId.get(r.id);
    if (!local) {
      byId.set(r.id, { id: r.id, name: r.name, widgets: r.widgets || [],
        ai: r.ai || null, createdAt: r.updatedAt || Date.now(), updatedAt: r.updatedAt });
    } else if ((r.updatedAt || 0) > (local.updatedAt || 0)) {
      local.name = r.name; local.widgets = r.widgets || local.widgets;
      local.ai = r.ai || null; local.updatedAt = r.updatedAt;
    }
  }
  workspaces.value = [...byId.values()];
  if (!workspaces.value.some((w) => w.id === activeId.value)) {
    activeId.value = workspaces.value[0]?.id;
  }
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspaces: workspaces.value,
      activeId: activeId.value,
      autoOpen: autoOpen.value,
    }));
    // localStorage stays the offline cache + instant-paint source; the server
    // is updated best-effort. Failures never block local save.
    if (SYNC_ENABLED) pushAll();
    return true;
  } catch (e) {
    console.warn('[useWorkspaces] failed to persist:', e);
    return false;
  }
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 250);
}

if (typeof window !== 'undefined') {
  // A debounced write is lost if the window closes inside the window. pagehide
  // is the reliable unload signal (tab close, navigation, Electron window
  // close); beforeunload is the belt-and-braces fallback. Mirrors chatUnified.
  window.addEventListener('pagehide', saveNow);
  window.addEventListener('beforeunload', saveNow);
}

/**
 * Make workspace identity durable, and repair the historical churn once.
 *
 * A workspace's id is minted at construction and is the address of its
 * conversation, so it must be written down THEN — not on the first widget
 * mutation. Chatting is not a mutation, which is precisely why conversations
 * were being orphaned: the most common session (open the page, talk, reload)
 * never triggered a save.
 */
(function bootstrapPersistence() {
  if (typeof localStorage === 'undefined') return;
  let dirty = !persisted;

  try {
    if (!localStorage.getItem(RECOVERY_FLAG)) {
      const known = new Set(workspaces.value.map((w) => w.id));
      const found = findRecoverableWorkspaces(readChatChannels(), known);
      for (const group of found) workspaces.value.push(workspaceFromRecovered(group));
      localStorage.setItem(RECOVERY_FLAG, String(Date.now()));
      if (found.length) {
        dirty = true;
        console.info(`[useWorkspaces] recovered ${found.length} orphaned workspace conversation(s)`);
      }
    }
  } catch (e) {
    console.warn('[useWorkspaces] conversation recovery failed (non-fatal):', e);
  }

  if (dirty) saveNow();
})();

export function useWorkspaces() {
  const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) || workspaces.value[0]);
  const activeWidgets = computed(() => active.value.widgets.filter((w) => w.visible !== false));

  /**
   * Which workspace does this mutation belong to?
   *
   * The UI always means "the one on screen", so omitting the id keeps every
   * existing call site correct. Annie does NOT: a tool call is issued by a
   * conversation that lives in a specific workspace, and it may execute
   * seconds later — by which time the user may have switched tabs. Resolving
   * against `active` at EXECUTION time is what let widgets asked for in one
   * workspace land in another.
   *
   * An id that no longer exists returns null rather than silently falling
   * back to the active workspace: writing to the wrong workspace is the bug,
   * so the honest answer is to refuse and say so.
   *
   * @param {string} [workspaceId] omit for "the active one".
   * @returns {object|null}
   */
  function resolveWorkspace(workspaceId) {
    if (!workspaceId) return active.value;
    return workspaces.value.find((w) => w.id === workspaceId) || null;
  }

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
    // Record for server-side removal so it does not resurrect from another device.
    if (SYNC_ENABLED) deletedIds.add(id);
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
    ws.updatedAt = Date.now();
    save();
  }

  /**
   * Set (or clear) the per-workspace AI provider override.
   * Pass ai = { provider, model } to override; ai = null to inherit the
   * global default. Persisted with the workspace, so it also rides sync.
   */
  function setWorkspaceAi(id, ai) {
    const ws = workspaces.value.find((w) => w.id === id);
    if (!ws) return;
    ws.ai = ai && ai.provider ? { provider: ai.provider, model: ai.model || null } : null;
    ws.updatedAt = Date.now();
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
  function addWidget(widgetId, at = null, { workspaceId } = {}) {
    if (!widgetId) return null;
    const ws = resolveWorkspace(workspaceId);
    if (!ws) return null;
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
        bringToFront(existing.instanceId, { workspaceId: ws.id });
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

  function removeWidget(instanceId, { workspaceId } = {}) {
    const ws = resolveWorkspace(workspaceId);
    if (!ws) return;
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
  function updateWidgetGeometry(instanceId, updates, { workspaceId } = {}) {
    const ws = resolveWorkspace(workspaceId);
    const w = ws?.widgets.find((x) => x.instanceId === instanceId);
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

  function bringToFront(instanceId, { workspaceId } = {}) {
    const ws = resolveWorkspace(workspaceId);
    if (!ws) return;
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
    setWorkspaceAi,
    hydrateFromServer,
    resolveWorkspace,
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
    saveNow,
  };
}
