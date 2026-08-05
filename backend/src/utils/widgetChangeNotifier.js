/**
 * Widget change notifier.
 *
 * WHY THIS EXISTS
 * ---------------
 * The frontend caches widget `source_code` in the Vuex store for the lifetime
 * of the page (widgetDefinitions/ensureDefinitionLoaded treats "the key exists"
 * as "it is current", by design — re-fetching a body on every render would be
 * wasteful). That cache is correct only if something invalidates it when the
 * row actually changes.
 *
 * Nothing did. A widget edited from chat, from another tab, from a plugin
 * install, or from another device wrote to the DB and the open canvas kept
 * rendering the stale body — permanently, until a full page reload. Every other
 * entity in the app (agents, workflows, content, groups, tools, providers)
 * already broadcasts create/update/delete; widgets were simply never wired up.
 *
 * There are ~10 distinct write sites across the service layer, the orchestrator
 * tools and the plugin asset loader. Rather than duplicate broadcast wiring at
 * each one, they all call through here — one place to get the event name, the
 * payload shape and the failure semantics right.
 *
 * FAILURE SEMANTICS: never throws. A missed notification degrades to the old
 * behaviour (stale until reload); a thrown error would fail the write that
 * already succeeded, which is strictly worse.
 */

import { broadcastToUser, broadcast, RealtimeEvents } from './realtimeSync.js';

const ACTION_EVENTS = {
  created: RealtimeEvents.WIDGET_CREATED,
  updated: RealtimeEvents.WIDGET_UPDATED,
  deleted: RealtimeEvents.WIDGET_DELETED,
};

/**
 * Announce that a widget definition row changed.
 *
 * @param {object}  params
 * @param {string}  params.widgetId  Widget definition id (`cw_…`). Required.
 * @param {string} [params.userId]   Owner. When present the event is scoped to
 *                                   that user's room; otherwise it falls back
 *                                   to a global broadcast (single-user desktop
 *                                   installs and plugin loaders have no req).
 * @param {'created'|'updated'|'deleted'} [params.action='updated']
 * @param {string} [params.source]   Free-text origin for debugging
 *                                   (e.g. 'edit_widget_code', 'plugin-install').
 * @returns {boolean} true if an event was emitted.
 */
export function notifyWidgetChanged({ widgetId, userId, action = 'updated', source } = {}) {
  try {
    if (!widgetId) return false;

    const event = ACTION_EVENTS[action];
    if (!event) {
      console.warn(`[WidgetNotify] Unknown action "${action}" for ${widgetId} — not emitting`);
      return false;
    }

    // `updatedAt` lets the client decide whether its cached copy is stale
    // without a round trip; `source` is purely diagnostic.
    const payload = { id: widgetId, action, updatedAt: new Date().toISOString(), source };

    if (userId && userId !== 'anonymous') {
      broadcastToUser(userId, event, payload);
    } else {
      broadcast(event, payload);
    }
    return true;
  } catch (error) {
    // Deliberately swallowed — see FAILURE SEMANTICS above.
    console.error('[WidgetNotify] Failed to broadcast widget change:', error?.message);
    return false;
  }
}

export default { notifyWidgetChanged };
