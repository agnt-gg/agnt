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

import { API_CONFIG } from '@/tt.config.js';

import { STORAGE_KEY, LEGACY_KEY, CHAT_STORAGE_KEY, RECOVERY_FLAG } from './workspaceStorage.js';

// Cross-device workspace sync. ON: the server (/api/workspaces, backed by
// widget_layouts rows keyed route='workspace:<id>') is the synced store,
// reconciled AFTER mount via hydrateFromServer(). Last-write-wins per
// workspace on an updatedAt epoch carried inside each workspace object.
//
// localStorage remains the offline cache and the instant-paint source, so
// turning this off later degrades to the previous local-only behaviour and
// leaves nothing behind but unread rows.
const SYNC_ENABLED = true;

async function apiFetch(path, opts = {}) {
  // Match the app's auth convention (see chatService.js): JWT from localStorage
  // as a Bearer token, which authenticateToken reads from the Authorization
  // header. Without this the endpoints 401 and sync silently no-ops.
  const token = localStorage.getItem('token');
  // API_CONFIG.BASE_URL, not a bare '/api/...': there is no vite dev proxy, so
  // a relative URL resolves against the dev server (5173) and every request
  // silently 404s. Same absolute base as every other service in the app.
  const res = await fetch(`${API_CONFIG.BASE_URL}/workspaces${path}`, {
    credentials: 'same-origin',
    // opts BEFORE headers: spreading it after would let any caller passing its
    // own headers drop the Authorization header entirely.
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
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

const blankWorkspace = (name = 'Workspace', { bootShell = false } = {}) => ({
  id: newId('ws'),
  name,
  // The name we MINTED it with, so a later rename is detectable without
  // pattern-matching the user's own text. See isStockBlank.
  defaultName: name,
  // True only for the shell auto-minted because localStorage was empty. A tab
  // the user asked for is never a boot shell, however empty it looks.
  ...(bootShell ? { bootShell: true } : {}),
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
  // channelKey → conversationId for server-backed chat history sync.
  channelConversations: {},
});

/**
 * Stock boot shell: the untouched tab auto-minted when localStorage was empty.
 * Such a shell must NOT re-push after the server already has real tabs, or
 * every device adds one.
 *
 * Identified by PROVENANCE, never by a name-shaped regex. Matching
 * /^Workspace \d+$/ meant a user who named a tab "Workspace 2" and left it
 * empty had it silently deleted on the next hydrate. Deleting a tab the user
 * made is unrecoverable; keeping a stray empty one costs a click.
 */
function isStockBlank(ws) {
  if (!ws || ws.bootShell !== true) return false;
  // Renamed => the user adopted it. Legacy rows carry no defaultName and are
  // never auto-deleted.
  if (typeof ws.name !== 'string' || typeof ws.defaultName !== 'string') return false;
  if (ws.name.trim() !== ws.defaultName.trim()) return false;
  // A conversation id is only recorded once a turn actually ran here
  // (Workspace.vue -> setChannelConversation), so this is "has real content".
  if (Object.keys(ws.channelConversations || {}).length > 0) return false;
  const widgets = Array.isArray(ws.widgets) ? ws.widgets : [];
  if (widgets.length > 1) return false;
  if (widgets.length === 1 && widgets[0]?.widgetId !== 'workspace-chat') return false;
  return true;
}

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
 *
 * `max` caps the footprint. defaultSize is what a widget wants when the USER
 * asks for it; an auto-opened window was not asked for, and every screen
 * widget declares 12x8 — exactly the whole grid — so on an otherwise empty
 * canvas an auto-open covered the entire workspace. Capping at the call site
 * keeps "screens are big" true for a deliberate open and false for a reflex.
 */
function placeInstance(existing, widgetId, at = null, max = null) {
  const declared = defaultSizeFor(widgetId);
  const want = max
    ? {
      cols: Math.max(1, Math.min(declared.cols, max.cols ?? GRID_COLS)),
      rows: Math.max(1, Math.min(declared.rows, max.rows ?? GRID_ROWS)),
    }
    : declared;
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

const workspaces = ref(persisted?.workspaces || [blankWorkspace('Workspace 1', { bootShell: true })]);
const activeId = ref(
  persisted?.activeId && workspaces.value.some((w) => w.id === persisted.activeId)
    ? persisted.activeId
    : workspaces.value[0].id,
);
const autoOpen = ref(persisted?.autoOpen !== false);

/**
 * Per-workspace memory of auto-opened widgets the user closed.
 *
 * Auto-open is a convenience, not an instruction. Closing a window Annie put
 * there is the user saying "not in this workspace" — and until this existed
 * the next matching tool call simply put it back, which at the glass is
 * indistinguishable from "my delete did not save".
 *
 * DEVICE-LOCAL on purpose. It sits beside the `autoOpen` toggle that governs
 * the same feature and is also local: this is a preference about how this
 * canvas behaves here, not content that belongs to the workspace everywhere.
 * (It is therefore absent from shapeForSync/pushAll by design — adding it
 * there would need the server allowlist and LWW semantics for a preference.)
 *
 * workspaceId -> Set<widgetId>
 */
const dismissedAutoOpen = new Map(
  Object.entries(persisted?.autoOpenDismissed || {})
    .filter(([, ids]) => Array.isArray(ids))
    .map(([wsId, ids]) => [wsId, new Set(ids.filter((id) => typeof id === 'string'))])
    .filter(([, set]) => set.size > 0),
);

function isAutoOpenDismissed(wsId, widgetId) {
  const set = dismissedAutoOpen.get(wsId);
  return !!set && set.has(widgetId);
}

/** Remember that the user closed this widget here. */
function noteAutoOpenDismissed(wsId, widgetId) {
  if (!wsId || !widgetId) return;
  let set = dismissedAutoOpen.get(wsId);
  if (!set) {
    set = new Set();
    dismissedAutoOpen.set(wsId, set);
  }
  set.add(widgetId);
}

/** Opening it deliberately re-arms auto-open for it. */
function clearAutoOpenDismissed(wsId, widgetId) {
  const set = dismissedAutoOpen.get(wsId);
  if (!set || !set.delete(widgetId)) return;
  if (set.size === 0) dismissedAutoOpen.delete(wsId);
}

function serializeDismissedAutoOpen() {
  const out = {};
  for (const [wsId, set] of dismissedAutoOpen) if (set.size) out[wsId] = [...set];
  return out;
}

/**
 * How big an auto-opened window may be, whatever its registry defaultSize.
 * Half the canvas: Annie's output lands BESIDE your work, never on top of it.
 */
const AUTO_OPEN_MAX = { cols: Math.floor(GRID_COLS / 2), rows: GRID_ROWS };

let saveTimer = null;

// Ids deleted locally that must be removed server-side on next push, so a
// tab closed on one device does not resurrect from another on next sync.
const deletedIds = new Set();
// Ids the server is known to have (populated on hydrate / push, PERSISTED so
// a reload can still apply remote deletions). A local workspace in this set
// but ABSENT from a later server response was deleted on another device —
// distinct from a freshly-created local tab the server has never seen.
const syncedIds = new Set(
  Array.isArray(persisted?.syncedIds) ? persisted.syncedIds.filter((id) => typeof id === 'string') : [],
);

/**
 * The fields that actually travel to the server, as a comparable string.
 *
 * updatedAt is deliberately EXCLUDED: it is DERIVED from this shape, so
 * including it would make every persist look like a change and re-stamp
 * forever.
 */
function shapeForSync(ws, index) {
  return JSON.stringify({
    name: ws.name,
    // Tab order is POSITIONAL (the array index is what pushAll sends as
    // `order`), so it is not a field on the object and change detection has to
    // be told about it explicitly. Without this a reorder mutates no
    // workspace's own fields, nothing is stamped, and last-write-wins silently
    // discards it.
    order: index,
    widgets: ws.widgets || [],
    ai: ws.ai || null,
    channelConversations: ws.channelConversations || {},
  });
}

/** id -> shape at last persist. The baseline change detection compares against. */
const lastShape = new Map();

/** Record current shapes as the new baseline WITHOUT stamping anything. */
function resyncShapes() {
  lastShape.clear();
  workspaces.value.forEach((ws, i) => lastShape.set(ws.id, shapeForSync(ws, i)));
}

/**
 * Advance updatedAt on every workspace whose synced shape changed.
 *
 * ONE chokepoint, not one line per mutator. Of the 15 functions that persist,
 * only 3 used to stamp; the other 12 included the entire widget layout, which
 * IS the synced payload. A tab rearranged on device A kept its old stamp, so a
 * later edit to a STALE copy on device B won last-write-wins and overwrote the
 * live layout. Detecting the change here means a 16th mutator cannot
 * reintroduce that by forgetting a line.
 */
function stampChangedWorkspaces() {
  const now = Date.now();
  workspaces.value.forEach((ws, i) => {
    const shape = shapeForSync(ws, i);
    if (lastShape.get(ws.id) !== shape) {
      ws.updatedAt = now;
      lastShape.set(ws.id, shape);
    }
  });
  const live = new Set(workspaces.value.map((w) => w.id));
  for (const id of [...lastShape.keys()]) if (!live.has(id)) lastShape.delete(id);
}

// Seed the baseline BEFORE anything can persist. Without this the first save
// would see every workspace as changed, stamp them all with now(), and local
// would beat every remote copy forever — sync would silently become one-way.
// A workspace with no stamp yet falls back to createdAt (0 if unknown), so a
// server copy wins the tie rather than being clobbered by an unknown local.
workspaces.value.forEach((ws, i) => {
  if (typeof ws.updatedAt !== 'number') ws.updatedAt = ws.createdAt || 0;
  lastShape.set(ws.id, shapeForSync(ws, i));
});

let pushTimer = null;
// With sync on, hold the first push until hydrate finishes so a boot-time
// "Workspace 1" shell cannot race ahead of the remote set and re-upload.
let allowPush = !SYNC_ENABLED;

/** Debounced best-effort push of the whole set (+ deletions) to the server. */
function pushAll() {
  if (!SYNC_ENABLED || !allowPush) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    const stamp = Date.now();
    const payload = {
      workspaces: workspaces.value.map((w, i) => ({
        id: w.id, name: w.name, order: i,
        widgets: w.widgets, ai: w.ai || null,
        channelConversations: w.channelConversations || {},
        updatedAt: w.updatedAt || stamp,
      })),
      deletedIds: [...deletedIds],
    };
    try {
      await apiFetch('', { method: 'PUT', body: JSON.stringify(payload) });
      deletedIds.clear();
      for (const w of workspaces.value) syncedIds.add(w.id);
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
  catch (e) {
    console.warn('[useWorkspaces] hydrate skipped:', e.message);
    allowPush = true; // offline: allow later local saves to push
    return;
  }
  if (!remote || !Array.isArray(remote.workspaces)) {
    allowPush = true;
    return;
  }
  const remoteIds = new Set(remote.workspaces.map((r) => r.id));
  const byId = new Map(workspaces.value.map((w) => [w.id, w]));

  // Apply remote deletions: a local workspace known to the server (synced) but
  // now missing from the server set was deleted on another device. Locally
  // created tabs the server has never seen (not in syncedIds) are preserved —
  // EXCEPT stock "Workspace 1" boot shells (single default chat), which must
  // not resurrect after an intentional server delete / multi-device hydrate.
  // Also drop empty local shells that duplicate a remote tab name.
  for (const [id, local] of byId) {
    if (remoteIds.has(id)) continue;
    const knownSynced = syncedIds.has(id);
    const emptyDup = (!local.widgets || local.widgets.length === 0)
      && remote.workspaces.some((r) => r.name === local.name);
    const stockBlank = isStockBlank(local) && remote.workspaces.length > 0;
    if (knownSynced || emptyDup || stockBlank) {
      byId.delete(id);
      syncedIds.delete(id);
      deletedIds.add(id); // ensure pushAll tells the server to keep them gone
    }
  }

  for (const r of remote.workspaces) {
    const local = byId.get(r.id);
    if (!local) {
      byId.set(r.id, {
        id: r.id, name: r.name, widgets: r.widgets || [],
        ai: r.ai || null,
        channelConversations: r.channelConversations || {},
        createdAt: r.updatedAt || Date.now(), updatedAt: r.updatedAt,
      });
    } else if ((r.updatedAt || 0) > (local.updatedAt || 0)) {
      local.name = r.name; local.widgets = r.widgets || local.widgets;
      local.ai = r.ai || null;
      local.channelConversations = r.channelConversations || local.channelConversations || {};
      local.updatedAt = r.updatedAt;
    } else {
      // Even on a stale remote write, merge any conversation ids we don't have
      // yet so a new device can still hydrate chat history.
      if (r.channelConversations && typeof r.channelConversations === 'object') {
        local.channelConversations = {
          ...(local.channelConversations || {}),
          ...r.channelConversations,
        };
      }
    }
    syncedIds.add(r.id);
  }

  // Never leave zero tabs.
  if (byId.size === 0) {
    allowPush = true;
    return;
  }

  const merged = [...byId.values()];

  // Apply the server's tab order.
  //
  // Order is a property of the COLLECTION, not of any one workspace, so the
  // per-workspace LWW above cannot resolve it — moving one tab changes the
  // position of every tab after it. Use the newest stamp on each side as a
  // collection-level clock: whichever side holds the most recent edit owns the
  // order. Without the comparison, a reorder made while offline would be
  // silently reverted by the next hydrate; without applying remote order at
  // all (the original behaviour) the server stored and returned `order` and
  // the client threw it away, so tab order never crossed devices.
  const newestLocal = merged.reduce((m, w) => Math.max(m, w.updatedAt || 0), 0);
  const newestRemote = remote.workspaces.reduce((m, r) => Math.max(m, r.updatedAt || 0), 0);
  if (newestRemote >= newestLocal) {
    const pos = new Map(
      remote.workspaces.map((r, i) => [r.id, Number.isFinite(r.order) ? r.order : i]),
    );
    // Tabs the server has never seen sort last, keeping their relative order
    // (Array#sort is stable), rather than colliding at position 0.
    const key = (w) => (pos.has(w.id) ? pos.get(w.id) : Number.MAX_SAFE_INTEGER);
    merged.sort((a, b) => key(a) - key(b));
  }

  workspaces.value = merged;
  if (!workspaces.value.some((w) => w.id === activeId.value)) {
    activeId.value = workspaces.value[0]?.id;
  }
  // Persist reconciled set + syncedIds, then push. First push only after
  // hydrate so boot shells never race ahead of the remote set.
  //
  // Re-baseline FIRST: what we just applied came FROM the server, and stamping
  // it as a local edit would make this device newer than the server on every
  // hydrate — the same one-way-sync failure the boot seed prevents.
  resyncShapes();
  allowPush = true;
  saveNow();
  // Chat widgets mount before this async hydrate finishes, so they often miss
  // channelConversations on first try. Tell them the map is ready so they can
  // re-load transcripts from conversation_logs.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agnt:workspace-sync-ready', {
      detail: { workspaceIds: workspaces.value.map((w) => w.id) },
    }));
  }
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  stampChangedWorkspaces();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspaces: workspaces.value,
      activeId: activeId.value,
      autoOpen: autoOpen.value,
      autoOpenDismissed: serializeDismissedAutoOpen(),
      syncedIds: [...syncedIds],
    }));
    // localStorage stays the offline cache + instant-paint source; the server
    // is updated best-effort. Failures never block local save. With sync on,
    // allowPush stays false until hydrate finishes (or fails).
    if (SYNC_ENABLED && allowPush) pushAll();
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
    // Ids are minted per tab and never reused, so a surviving entry would just
    // leak. Drop it with the tab.
    dismissedAutoOpen.delete(id);
    workspaces.value.splice(idx, 1);
    if (activeId.value === id) {
      activeId.value = workspaces.value[Math.min(idx, workspaces.value.length - 1)].id;
    }
    save();
  }

  /**
   * Move a workspace tab to a new index.
   *
   * Order is the array position, so this is a splice — and because
   * shapeForSync carries the index, every tab whose position changed is
   * stamped and the whole reorder travels as one last-write-wins generation.
   */
  function moveWorkspace(id, toIndex) {
    const from = workspaces.value.findIndex((w) => w.id === id);
    if (from === -1) return;
    const to = Math.max(0, Math.min(toIndex, workspaces.value.length - 1));
    if (from === to) return;
    const [ws] = workspaces.value.splice(from, 1);
    workspaces.value.splice(to, 0, ws);
    save();
  }

  function renameWorkspace(id, name) {
    const ws = workspaces.value.find((w) => w.id === id);
    if (!ws || !name) return;
    ws.name = name;
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
    save();
  }

  /**
   * Remember the server conversationId for a workspace chat channel so other
   * devices can reload the transcript from conversation_logs.
   * channelKey is e.g. 'workspace:ws_xxx' or 'workspace:ws_xxx:w_yyy'.
   */
  function setChannelConversation(channelKey, conversationId) {
    if (!channelKey || typeof channelKey !== 'string' || !channelKey.startsWith('workspace:')) return;
    if (!conversationId) return;
    const rest = channelKey.slice('workspace:'.length);
    const colon = rest.indexOf(':');
    const wsId = colon === -1 ? rest : rest.slice(0, colon);
    const ws = workspaces.value.find((w) => w.id === wsId);
    if (!ws) return;
    if (!ws.channelConversations) ws.channelConversations = {};
    if (ws.channelConversations[channelKey] === conversationId) return;
    ws.channelConversations[channelKey] = conversationId;
    save();
  }

  /** Look up a synced conversationId for a workspace channel (any device). */
  function getChannelConversation(channelKey) {
    if (!channelKey || typeof channelKey !== 'string' || !channelKey.startsWith('workspace:')) return null;
    const rest = channelKey.slice('workspace:'.length);
    const colon = rest.indexOf(':');
    const wsId = colon === -1 ? rest : rest.slice(0, colon);
    const ws = workspaces.value.find((w) => w.id === wsId);
    return ws?.channelConversations?.[channelKey] || null;
  }

  /**
   * Add a widget instance to the active workspace.
   *
   * Most tool surfaces are singletons because auto-open firing twice should
   * focus the existing window, not stack duplicates. Chat and Browser are the
   * deliberate exceptions: each chat is a separate conversation, and each
   * browser is a separate live page/agent target with its own instance id.
   */
  function addWidget(widgetId, at = null, { workspaceId, allowDuplicate = false, auto = false } = {}) {
    if (!widgetId) return null;
    const ws = resolveWorkspace(workspaceId);
    if (!ws) return null;
    // `auto` is the single chokepoint for "Annie placed this, the user did
    // not". Both directions live here so no caller can forget one: a reflex
    // never overrides a close, and a deliberate open re-arms the reflex.
    if (auto) {
      if (isAutoOpenDismissed(ws.id, widgetId)) return null;
    } else {
      clearAutoOpenDismissed(ws.id, widgetId);
    }
    // Chat is always user-created and plural. Browser is plural only for an
    // explicit user add; tool auto-open must focus the workspace browser it
    // just targeted instead of creating a fresh blank one on every call.
    const plural = widgetId === 'workspace-chat' || (widgetId === 'browser' && allowDuplicate);
    if (!plural) {
      // For a plural-capable Browser, tool auto-open focuses the browser that
      // was already front-most — the same one workspacePageState captured for
      // the chat turn. Array-first would visually raise browser A while the
      // backend correctly drove browser B by id.
      const matching = ws.widgets.filter((w) => w.widgetId === widgetId);
      const existing = widgetId === 'browser'
        ? matching.sort((a, b) => (b.zIndex || 1) - (a.zIndex || 1))[0]
        : matching[0];
      if (existing) {
        existing.visible = true;
        // Dragging an already-open widget onto the canvas MOVES it. The
        // instance is a singleton, so a drop can only mean "put it here".
        if (at) Object.assign(existing, clampInstance({ ...existing, col: at.col, row: at.row }));
        bringToFront(existing.instanceId, { workspaceId: ws.id });
        return existing.instanceId;
      }
    }
    const geom = placeInstance(ws.widgets, widgetId, at, auto ? AUTO_OPEN_MAX : null);
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

  /**
   * Close a window.
   *
   * Closing is also an ANSWER to auto-open: this widget is not wanted on this
   * canvas. Recorded for every widget, not just the auto-opened ones, because
   * the user's intent is the same either way and a rule with an exception is a
   * rule people have to remember.
   */
  function removeWidget(instanceId, { workspaceId } = {}) {
    const ws = resolveWorkspace(workspaceId);
    if (!ws) return;
    const idx = ws.widgets.findIndex((w) => w.instanceId === instanceId);
    if (idx === -1) return;
    const [closed] = ws.widgets.splice(idx, 1);
    noteAutoOpenDismissed(ws.id, closed.widgetId);
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

  /**
   * Turning auto-open back ON is an explicit "do this again", so it forgets
   * every past dismissal. Without that, the toggle could be on and still open
   * nothing — a switch that visibly does nothing is worse than no switch.
   */
  function setAutoOpen(v) {
    const on = !!v;
    if (on && !autoOpen.value) dismissedAutoOpen.clear();
    autoOpen.value = on;
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
    moveWorkspace,
    renameWorkspace,
    setWorkspaceAi,
    setChannelConversation,
    getChannelConversation,
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
