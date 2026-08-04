// surfaceFederation — how ONE canvas chat sees, and acts on, MANY widget windows.
//
// THE PROBLEM
// -----------
// AGNT grew five chats (workflow / tool / widget / agent / artifact) that are
// already the SAME chat: CHAT_CONFIGS maps every type to one unifiedConfig, and
// every panel renders one UnifiedChatContainer. What actually differs is two
// things per surface:
//
//   1. WHAT IT SENDS   — `pageState` ({ workflowState }, { codeContext }, …),
//                        which the backend turns into a guidance block.
//   2. WHAT IT RECEIVES — a window CustomEvent the editing screen listens for.
//
// Both were single-valued because a sidebar holds exactly one screen. A canvas
// holds many, so both become PLURAL. This module is that pluralisation, and
// nothing else: surfaces publish what they are, the canvas takes the union,
// and events are addressed back to the window that should apply them.
//
// WHY PUBLISH INSTEAD OF READ
// ---------------------------
// The existing use*ChatContext composables mostly read GLOBAL sources (a Vuex
// slice, localStorage, `document.querySelector('#template-form')`). That is
// fine for a sidebar — there is one screen — but a canvas can hold two Widget
// Forge windows whose `form` is component-local state. A registry-declared
// reader cannot tell them apart; only the component itself can. So screens
// PUBLISH (`useSurfaceContribution`) rather than the canvas READING. One line
// per screen, correct for N windows, and it composes with whatever injections
// the screen already relies on because it runs inside that screen's setup().
//
// WHY EVENTS ARE ADDRESSED
// ------------------------
// This is the same lesson workflowBroadcast.js already paid for: a broadcast is
// a fan-out, not a delivery. With one Widget Forge on screen, a global
// `chat-sse-event` is harmless. With two, an `update` meant for one window
// rewrites both. Producers stamp the target instanceId; consumers refuse
// anything not addressed to them. An UNSTAMPED event is accepted by everyone,
// so every pre-existing standalone producer keeps working untouched.

import { inject, provide, watch, onScopeDispose, reactive } from 'vue';

/** Injection keys — a window's identity, provided once per window. */
export const SURFACE_INSTANCE_KEY = 'canvasSurfaceInstanceId';
export const SURFACE_WIDGET_KEY = 'canvasSurfaceWidgetId';

/** The addressing stamp on an addressed CustomEvent's detail. */
export const SURFACE_TAG = '__surface';

// instanceId -> { instanceId, widgetId, state }
// Module-scoped because exactly one canvas is rendered at a time (Workspace
// renders `activeWidgets`, the active tab only), and windows retract on
// unmount — including on tab switch.
const surfaces = reactive(new Map());

/** Give a window its identity. Called once per window, by the canvas. */
export function provideSurfaceIdentity(instanceId, widgetId) {
  provide(SURFACE_INSTANCE_KEY, instanceId);
  provide(SURFACE_WIDGET_KEY, widgetId);
}

export function publishSurfaceState(instanceId, widgetId, state) {
  if (!instanceId) return false;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    surfaces.delete(instanceId);
    return false;
  }
  surfaces.set(instanceId, { instanceId, widgetId: widgetId || null, state });
  return true;
}

export function retractSurface(instanceId) {
  return surfaces.delete(instanceId);
}

export function listSurfaces() {
  return Array.from(surfaces.values());
}

/** Test seam / canvas teardown. */
export function clearSurfaces() {
  surfaces.clear();
}

/**
 * Publish this screen's chat contribution for as long as it is mounted.
 *
 * INERT OUTSIDE THE CANVAS. A standalone screen injects no instanceId, so this
 * returns false having done nothing — which is why every screen can call it
 * unconditionally and no sidebar behaviour changes.
 *
 * @param {Function|import('vue').Ref} source getter/ref returning the pageState
 *        fragment this surface contributes, e.g. () => ({ widgetState: {...} }).
 * @returns {boolean} true when federated (i.e. running inside a canvas window).
 */
export function useSurfaceContribution(source) {
  const instanceId = inject(SURFACE_INSTANCE_KEY, null);
  if (!instanceId) return false;
  const widgetId = inject(SURFACE_WIDGET_KEY, null);

  // No `deep`. `source` is a getter that builds a fresh object, so it fires on
  // identity change whenever its own reactive dependencies move — deep-walking
  // a whole workflow graph or a file's contents on every tick would cost real
  // time for an answer we already have.
  watch(source, (value) => publishSurfaceState(instanceId, widgetId, value), { immediate: true });
  onScopeDispose(() => retractSurface(instanceId));
  return true;
}

/**
 * Merge many surfaces into ONE pageState, bounded.
 *
 * THE BUDGET RULE: at most one blob per state key. `workflowState` is a whole
 * node graph and `codeContext.openFileContent` is a whole file; three windows
 * of the same kind would put three of them in the system prompt EVERY turn.
 * So the highest-priority window that offers a key wins it outright, and every
 * other window is still ANNOUNCED in the manifest with `stateIncluded: false`
 * — the model can see it exists and call inspect_canvas_widget for detail.
 * Bounded context, nothing hidden.
 *
 * Priority is the caller's order (the canvas passes windows by descending
 * zIndex, i.e. most recently focused first), which is also the answer to
 * "which window did the user mean by 'save it'".
 *
 * @param {Array<{instanceId, widgetId, state}>} surfaceList priority-ordered.
 * @param {Map<string, string>|object} [names] instanceId -> display name.
 * @returns {{ merged: object, manifest: Array<object> }}
 */
export function buildFederatedPageState(surfaceList, names) {
  const merged = {};
  const manifest = [];
  const claimed = new Set();
  const lookup = (id) => (names instanceof Map ? names.get(id) : names?.[id]) || null;

  for (let i = 0; i < (surfaceList?.length || 0); i++) {
    const surface = surfaceList[i];
    if (!surface?.instanceId || !surface.state) continue;

    const keys = Object.keys(surface.state);
    const included = [];
    for (const key of keys) {
      if (claimed.has(key)) continue;
      claimed.add(key);
      merged[key] = surface.state[key];
      included.push(key);
    }

    manifest.push({
      instanceId: surface.instanceId,
      widgetId: surface.widgetId || null,
      name: lookup(surface.instanceId) || surface.widgetId || null,
      // Derived from what the window PUBLISHED, never from the route query.
      // There is one `?id=` for the whole page, so asking the URL would claim
      // two Workflow Forge windows are editing the same workflow. The screen
      // is the only honest source for what the screen is showing.
      bound: describeSurfaceBinding(surface.state),
      focused: i === 0,
      stateIncluded: included.length > 0,
      // Only meaningful when something WAS dropped — a window whose every key
      // was already claimed is the ambiguous "second Workflow Forge" case, and
      // saying so is what stops the model guessing.
      supersededKeys: included.length === keys.length ? [] : keys.filter((k) => !included.includes(k)),
    });
  }

  return { merged, manifest };
}

/**
 * A one-line "what is this window showing?", read off its own contribution.
 * Returns null when the surface publishes nothing identifying — an unsaved
 * Widget Forge, an Artifacts window with no file open.
 */
export function describeSurfaceBinding(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.workflowState?.id) return `workflow ${state.workflowState.id}`;
  if (state.widgetState?.id && state.widgetState.id !== 'widget-forge') return `widget ${state.widgetState.id}`;
  if (state.codeContext?.openFilePath) return `file ${state.codeContext.openFilePath}`;
  if (state.toolState?.id && state.toolState.id !== 'default') return `tool ${state.toolState.id}`;
  if (state.agentState?.id && state.agentState.id !== 'agent-chat') return `agent ${state.agentState.id}`;
  return null;
}

// ── addressed delivery ────────────────────────────────────────────────────
//
// Backend tools emit `frontendEvents: [{ type, data }]`. Each type belongs to
// exactly one editing surface, and each surface listens on one window event
// with one payload shape. This table is the whole mapping; it is prefix-driven
// so a new `widget-*` / `agent-*` / `tool-*` event routes correctly the day it
// is added, with no edit here.

const PREFIX_ROUTES = [
  { prefix: 'widget-', widgetId: 'widget-forge', eventName: 'chat-sse-event', wrap: 'sse' },
  { prefix: 'agent-', widgetId: 'agent-forge', eventName: 'chat-sse-event', wrap: 'sse' },
  { prefix: 'tool-', widgetId: 'tool-forge', eventName: 'chat-sse-event', wrap: 'sse' },
];

// DELIBERATELY ABSENT: `workflow-`. Workflow edits do not travel as frontend
// events at all — update_workflow broadcasts over socket.io, useRealtimeSync
// re-emits `workflow-updated`, and WorkflowForge already refuses payloads for
// a workflow it is not showing (workflowBroadcast.isAddressedToWorkflow). That
// path is addressed by workflow id, which is strictly better than addressing
// by window. Adding a prefix route here would wrap those events into
// `chat-sse-event`, which WorkflowForge does not listen for — i.e. it would
// break a working path to look symmetrical.

const EXACT_ROUTES = {
  file_written: { widgetId: 'artifacts', eventName: 'code-file-written', wrap: 'raw' },
};

/**
 * Which window should apply this backend event, and as what?
 * @returns {{widgetId, eventName, wrap}|null} null when nothing consumes it.
 */
export function resolveSurfaceDelivery(eventType) {
  if (!eventType || typeof eventType !== 'string') return null;
  if (EXACT_ROUTES[eventType]) return EXACT_ROUTES[eventType];
  for (const route of PREFIX_ROUTES) {
    if (eventType.startsWith(route.prefix)) return route;
  }
  return null;
}

/**
 * Emit a window event ADDRESSED to one canvas window.
 *
 * `instanceId` null means "unaddressed" — every consumer accepts it, which is
 * exactly how every existing standalone producer already behaves.
 */
export function dispatchSurfaceEvent(instanceId, eventName, detail) {
  if (!eventName || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return false;
  }
  const payload = { ...(detail && typeof detail === 'object' ? detail : {}) };
  if (instanceId) payload[SURFACE_TAG] = instanceId;
  window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  return true;
}

/**
 * Should this window apply the incoming event?
 *
 *   1. No stamp        -> ACCEPT. Legacy/standalone producer; preserves every
 *                         pre-existing path unchanged.
 *   2. Stamp matches   -> ACCEPT.
 *   3. Stamp differs   -> REFUSE. It is meant for a sibling window.
 */
export function isAddressedToSurface(detail, myInstanceId) {
  if (!detail || typeof detail !== 'object') return true;
  const tag = detail[SURFACE_TAG];
  if (tag === undefined || tag === null) return true;
  return tag === myInstanceId;
}

/**
 * Consumer-side helper for a screen: `accepts(event.detail)` before applying.
 * Outside a canvas, instanceId is null and only unstamped events are accepted
 * — an event addressed to canvas window X must not also hit the standalone
 * screen behind it.
 */
export function useSurfaceAddressing() {
  const instanceId = inject(SURFACE_INSTANCE_KEY, null);
  return {
    instanceId,
    accepts: (detail) => isAddressedToSurface(detail, instanceId),
  };
}
