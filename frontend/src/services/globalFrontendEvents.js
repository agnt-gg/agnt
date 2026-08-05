// The registry of backend `frontendEvents` whose scope is the WINDOW rather
// than the chat channel that produced them.
//
// WHY THIS FILE EXISTS. A tool can return `frontendEvents`; OrchestratorService
// ships each one as a `frontend_event` SSE. Most are channel-scoped — a widget
// save belongs to the Widget Forge channel that asked for it — and the channel's
// own `onFrontendEvent` callback consumes them. A few are not: a guided tour and
// the app background belong to the window. Those must be re-dispatched as window
// CustomEvents so a host component (AIGuidedTourHost, TerminalLayout) can react
// no matter which chat surface made the call.
//
// The bug this prevents: that re-dispatch used to be written inline, by hand, in
// each SSE reducer. There are two reducers (chat.js for the main terminal chat,
// chatUnified.js for every sidebar/forge channel) plus a socket.io mirror, and
// `appearance:background` was only ever added to one of them — so
// set_background_image worked in a Widget Forge chat and silently did nothing in
// the main chat. Anything added here is delivered on every surface at once.
//
// TO ADD AN EVENT: add one line to GLOBAL_FRONTEND_EVENTS. Nothing else.

/**
 * Backend event type -> window CustomEvent name.
 * Frozen: this is a contract shared by three call sites, not scratch state.
 */
export const GLOBAL_FRONTEND_EVENTS = Object.freeze({
  'tutorial:start': 'ai-tour:start',
  'tutorial:end': 'ai-tour:end',
  'appearance:background': 'agnt:appearance-background',
});

/** @returns {string|null} the window event name, or null if not global-scope. */
export function windowEventNameFor(eventType) {
  if (typeof eventType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(GLOBAL_FRONTEND_EVENTS, eventType)
    ? GLOBAL_FRONTEND_EVENTS[eventType]
    : null;
}

export function isGlobalFrontendEvent(eventType) {
  return windowEventNameFor(eventType) !== null;
}

/**
 * Re-dispatch one backend frontend event as a window CustomEvent.
 *
 * Returns true only when the event was global-scope AND actually dispatched, so
 * a caller can fall through to its channel-scoped handling on false. A throwing
 * listener is logged and swallowed: a broken tour host must not kill the stream
 * reducer mid-run.
 *
 * @param {string} eventType  backend event type, e.g. 'appearance:background'
 * @param {any} detail        the event's data payload
 * @param {string} [source]   label for logs (which reducer dispatched it)
 * @returns {boolean}
 */
export function dispatchGlobalFrontendEvent(eventType, detail, source = 'frontendEvents') {
  const windowEventName = windowEventNameFor(eventType);
  if (!windowEventName) return false;
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return false;
  try {
    window.dispatchEvent(new CustomEvent(windowEventName, { detail: detail ?? {} }));
    console.log(`[${source}] dispatched global frontend event ${eventType} -> ${windowEventName}`);
    return true;
  } catch (e) {
    console.error(`[${source}] dispatching ${eventType} failed:`, e);
    return false;
  }
}

/**
 * Convenience for a tool result's `frontendEvents` array. Non-global entries are
 * handed to `onNonGlobal` (the channel-scoped callback) so no event is lost.
 *
 * @param {Array<{type: string, data: any}>} events
 * @param {(type: string, data: any) => void} [onNonGlobal]
 * @param {string} [source]
 */
export function dispatchGlobalFrontendEvents(events, onNonGlobal, source) {
  if (!Array.isArray(events)) return;
  for (const evt of events) {
    if (!evt || typeof evt.type !== 'string') continue;
    if (dispatchGlobalFrontendEvent(evt.type, evt.data, source)) continue;
    if (typeof onNonGlobal === 'function') {
      try {
        onNonGlobal(evt.type, evt.data);
      } catch (e) {
        console.error(`[${source || 'frontendEvents'}] non-global handler threw for ${evt.type}:`, e);
      }
    }
  }
}
