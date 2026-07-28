/**
 * Canvas bridge — the browser side of the canvas awareness tools.
 *
 * The backend's canvasTools.js broadcasts `canvas:request { requestId,
 * action, args }` to every tab in the user's socket room;
 * useRealtimeSync.js forwards the request here and emits whatever this
 * returns as `canvas:response`. First response wins server-side.
 *
 * ACTIONS
 *   state    — snapshot of every workspace tab + widget window. Answers from
 *              localStorage (shared across same-origin tabs), so ANY tab can
 *              answer truthfully even when the canvas isn't the visible
 *              screen. Read-only.
 *   inspect  — one window's visible text + interactive elements, scoped to
 *              its DOM subtree. Needs the canvas actually rendered.
 *   open / close / move — mutate the workspace through the SAME functions the
 *              UI uses (useWorkspaces.addWidget / removeWidget /
 *              updateWidgetGeometry), so every invariant those enforce —
 *              grid clamping, occupancy-checked placement, largest-free-rect
 *              shrinking, chat dedupe exemption — applies identically to the
 *              agent. No parallel mutation path.
 *
 * WHICH WORKSPACE: writes are addressed to `workspaceId`, captured from the
 * asking conversation's own page state when the turn was SENT, not resolved
 * against whatever workspace tab is selected when the tool finally executes.
 * A turn can take tens of seconds, and the user is free to switch tabs while
 * it runs — resolving at execution time is what made widgets requested in one
 * workspace appear in another. Absent (a request from the main chat screen,
 * which has no workspace) it still falls back to the active workspace, which
 * is the only sensible meaning there.
 *
 * WRITE SAFETY: useRealtimeSync only routes write actions to the VISIBLE tab.
 * Every tab shares localStorage, so if hidden tabs executed too, one
 * open_canvas_widget would add N widgets. Reads are idempotent; writes go
 * through exactly one executor.
 */

import { STORAGE_KEY } from './useWorkspaces.js';
import { getWidget } from '@/canvas/widgetRegistry.js';

const MAX_TEXT_CHARS = 4000;
const MAX_ELEMENTS = 60;

/** The instanceIds of chat windows, so state can mark "this conversation". */
const isChatWidget = (w) => w.widgetId === 'workspace-chat';

/**
 * Objects a window is bound to, recovered from the route query the target
 * screens already read (Workflow Forge ?id=, Tool Forge ?tool-id=). Only the
 * tab actually sitting on /workspace can see these; other tabs return null
 * and the field is simply absent.
 */
function boundObjectFor(widgetId, search) {
  try {
    const q = new URLSearchParams(search);
    if (widgetId === 'workflow-forge' && q.get('id')) return { type: 'workflow', id: q.get('id') };
    if (widgetId === 'tool-forge' && q.get('tool-id')) return { type: 'tool', id: q.get('tool-id') };
  } catch { /* ignore */ }
  return null;
}

/** ── state ─────────────────────────────────────────────────────────── */
export function readCanvasState(callerWorkspaceId = null) {
  let parsed;
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) {
    return {
      success: true,
      open: false,
      summary: 'The Workspaces page has never been used — no workspaces exist yet.',
    };
  }

  const onCanvas = typeof location !== 'undefined' && location.pathname === '/workspace';
  const search = typeof location !== 'undefined' ? location.search : '';

  const workspaces = parsed.workspaces.map((ws) => ({
    id: ws.id,
    name: ws.name,
    active: ws.id === parsed.activeId,
    // The workspace this conversation lives in — the only one it can write to.
    // Distinct from `active`, which is merely what the user is looking at now.
    ...(callerWorkspaceId && ws.id === callerWorkspaceId ? { thisConversation: true } : {}),
    widgets: (ws.widgets || []).map((w) => {
      const def = getWidget(w.widgetId);
      const entry = {
        instanceId: w.instanceId,
        widgetId: w.widgetId,
        name: def?.name || w.widgetId,
        grid: { col: w.col, row: w.row, cols: w.cols, rows: w.rows },
        collapsed: !!w.collapsed,
      };
      if (def?.isCustomWidget) entry.custom = true;
      if (isChatWidget(w)) entry.chat = true;
      const bound = boundObjectFor(w.widgetId, search);
      if (bound) entry.boundObject = bound;
      return entry;
    }),
  }));

  return {
    success: true,
    open: true,
    canvasVisibleInThisTab: onCanvas,
    grid: { cols: 12, rows: 8 },
    activeWorkspaceId: parsed.activeId,
    workspaces,
    hint:
      'Widget windows marked chat:true are conversations (possibly this one). Use inspect_canvas_widget with an instanceId to read what a window shows; open/close/move_canvas_widget to arrange the canvas. '
      + (callerWorkspaceId
        ? 'Writes always apply to the workspace marked thisConversation:true — the one you live in — regardless of which tab the user is currently viewing.'
        : 'This conversation is not inside a workspace, so writes apply to the active workspace.'),
  };
}

/** ── inspect ───────────────────────────────────────────────────────── */
export async function inspectCanvasWidget(instanceId) {
  if (!instanceId) return { success: false, error: 'instanceId is required.' };
  // Legitimate instanceIds are w_<alnum> (see useWorkspaces.newId). Validating
  // the shape both replaces CSS.escape (absent in jsdom) and rejects selector
  // injection outright instead of escaping it.
  if (!/^[\w-]+$/.test(instanceId)) {
    return { success: false, error: `Malformed instanceId "${String(instanceId).slice(0, 40)}".` };
  }

  const frame = document.querySelector(`.widget-frame[data-instance-id="${instanceId}"]`);
  if (!frame) {
    return {
      success: false,
      found: false,
      error: `No rendered window with instanceId "${instanceId}" in this tab. The canvas must be the visible screen, and the id must come from get_canvas_state.`,
    };
  }

  const title = frame.querySelector('.wf-title')?.textContent?.trim() || null;

  // A chat window's transcript is the conversation itself — echoing it back
  // into the conversation is recursion, not information.
  const state = readCanvasState();
  const meta = state.workspaces
    ?.flatMap((ws) => ws.widgets)
    .find((w) => w.instanceId === instanceId);
  if (meta?.chat) {
    return {
      success: true,
      found: true,
      title,
      chat: true,
      note: 'This is a chat window — its content is a conversation transcript (possibly this very conversation), so it is not echoed back.',
    };
  }

  const body = frame.querySelector('.wf-body') || frame;
  // innerText reflects layout (skips hidden nodes) but does not exist in
  // every environment (jsdom); textContent is the lossless fallback.
  const rawText = body.innerText ?? body.textContent ?? '';
  const text = rawText
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  let elements = [];
  try {
    const { scanInteractiveElements } = await import('@/views/_components/utility/domScanner.js');
    elements = scanInteractiveElements({ root: frame }).slice(0, MAX_ELEMENTS);
  } catch { /* scanner unavailable — text alone is still useful */ }

  return {
    success: true,
    found: true,
    title,
    visibleText: text,
    truncated: rawText.length > MAX_TEXT_CHARS,
    elements,
    hint: 'elements[].selector values work with highlight_element for pointing at things.',
  };
}

/** ── open / close / move ───────────────────────────────────────────── */
export async function executeCanvasCommand(action, args = {}, workspaceId = null) {
  // Lazy import: useWorkspaces is a module-level singleton, so this reaches
  // the SAME reactive state the rendered canvas uses — a mutation here
  // updates the visible page live.
  const { useWorkspaces } = await import('./useWorkspaces.js');
  const ws = useWorkspaces();

  // The workspace this conversation belongs to. Refusing outright when it has
  // been closed is deliberate: silently retargeting the active workspace is
  // precisely the cross-workspace write this addressing exists to prevent.
  const target = ws.resolveWorkspace(workspaceId);
  if (!target) {
    return {
      success: false,
      error: `The workspace this conversation belongs to (${workspaceId}) no longer exists — it was closed. Ask the user which workspace to use, or call get_canvas_state to see what is open.`,
    };
  }
  const scope = { workspaceId: target.id };

  if (action === 'open') {
    const { widgetId, col, row } = args;
    if (!widgetId) return { success: false, error: 'widgetId is required.' };
    if (!getWidget(widgetId)) {
      // Self-heal for custom widgets created THIS conversation: the definition
      // exists server-side (generate_widget auto-saves) but this tab's
      // registry only knows what its last fetchDefinitions returned. Re-list
      // — SET_DEFINITIONS syncs every row into the registry — then re-check.
      // Without this, "forge a widget, put it on the canvas" dead-ended on
      // 'Unknown widget' for the very id the agent had just created.
      if (/^cw_/.test(widgetId)) {
        try {
          const { default: store } = await import('@/store/state');
          await store.dispatch('widgetDefinitions/fetchDefinitions');
        } catch { /* fall through to the honest error */ }
      }
      if (!getWidget(widgetId)) {
        return {
          success: false,
          error: `Unknown widget "${widgetId}". Built-ins include traces, goals, workflow-forge, artifacts, memory, dashboard; custom widgets use their cw_… id (list_widgets shows the library). If it was just created, it may not have saved — check save_widget's result.`,
        };
      }
    }
    const at = Number.isInteger(col) && Number.isInteger(row) ? { col, row } : null;
    const instanceId = ws.addWidget(widgetId, at, scope);
    const placed = target.widgets.find((w) => w.instanceId === instanceId);
    return {
      success: true,
      instanceId,
      workspace: { id: target.id, name: target.name },
      placed: placed ? { col: placed.col, row: placed.row, cols: placed.cols, rows: placed.rows } : null,
    };
  }

  // A stale or cross-tab instanceId is common (the user can switch workspace
  // tabs between the agent's read and its write). Naming the owning workspace
  // turns a dead-end error into an actionable one.
  const locateInstance = (instanceId) => {
    for (const w of ws.workspaces.value) {
      if ((w.widgets || []).some((x) => x.instanceId === instanceId)) return w;
    }
    return null;
  };
  const missingError = (instanceId) => {
    const owner = locateInstance(instanceId);
    if (owner && owner.id !== target.id) {
      return `Window "${instanceId}" is in workspace "${owner.name}", but this conversation belongs to "${target.name}" and can only modify its own workspace. Use a window from this workspace, or ask the user to move it.`;
    }
    return `No window with instanceId "${instanceId}" in any workspace. Get a current id from get_canvas_state — ids change when windows are closed and reopened.`;
  };

  if (action === 'close') {
    const { instanceId } = args;
    if (!instanceId) return { success: false, error: 'instanceId is required.' };
    const exists = target.widgets.some((w) => w.instanceId === instanceId);
    if (!exists) return { success: false, error: missingError(instanceId) };
    ws.removeWidget(instanceId, scope);
    return { success: true, closed: instanceId, workspace: { id: target.id, name: target.name } };
  }

  if (action === 'move') {
    const { instanceId, col, row, cols, rows } = args;
    if (!instanceId) return { success: false, error: 'instanceId is required.' };
    const win = target.widgets.find((w) => w.instanceId === instanceId);
    if (!win) return { success: false, error: missingError(instanceId) };

    const updates = {};
    if (Number.isInteger(col)) updates.col = col;
    if (Number.isInteger(row)) updates.row = row;
    if (Number.isInteger(cols)) updates.cols = cols;
    if (Number.isInteger(rows)) updates.rows = rows;
    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'Provide at least one of col/row/cols/rows.' };
    }
    // updateWidgetGeometry clamps to the 12x8 grid, same as a user drag.
    ws.updateWidgetGeometry(instanceId, updates, scope);
    const after = target.widgets.find((w) => w.instanceId === instanceId);
    return {
      success: true,
      workspace: { id: target.id, name: target.name },
      geometry: { col: after.col, row: after.row, cols: after.cols, rows: after.rows },
    };
  }

  return { success: false, error: `Unknown canvas command: ${action}` };
}

/**
 * Single entry point for useRealtimeSync.
 * Returns null when THIS tab must stay silent (write request in a hidden tab)
 * so another tab — or the server timeout — answers instead.
 */
export async function handleCanvasRequest(action, args, workspaceId = null) {
  try {
    if (action === 'state') return readCanvasState(workspaceId);
    if (action === 'inspect') return await inspectCanvasWidget(args?.instanceId);
    if (action === 'open' || action === 'close' || action === 'move') {
      if (document.visibilityState !== 'visible') return null; // writes: visible tab only
      return await executeCanvasCommand(action, args, workspaceId);
    }
    return { success: false, error: `Unknown canvas action: ${action}` };
  } catch (e) {
    return { success: false, error: `Canvas bridge error: ${e.message}` };
  }
}
