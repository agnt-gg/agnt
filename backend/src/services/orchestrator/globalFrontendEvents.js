// Which tool `frontendEvents` are WINDOW-scoped rather than chat-channel-scoped.
//
// Every frontend event is written to the SSE stream of the turn that produced
// it. That is enough for a channel-scoped event (a widget save belongs to the
// Widget Forge channel that asked for it). It is NOT enough for an event whose
// effect belongs to the whole window — a guided tour, the app background —
// because the user may be looking at a DIFFERENT TAB than the one holding the
// SSE. Those are additionally mirrored over socket.io to every tab the user has
// open.
//
// This list is the backend half of a contract; the frontend half is
// frontend/src/services/globalFrontendEvents.js, which maps the same types to
// window CustomEvent names. Keep them in step — adding a type here without a
// mapping there means the broadcast arrives and nothing listens.
//
// It exists as its own module because the predicate used to be an inline
// `type === 'tutorial:start' || type === 'tutorial:end'` in OrchestratorService,
// which is exactly the kind of hand-maintained list a later feature forgets to
// extend. `appearance:background` did get forgotten, and the app background
// silently failed to reach any tab but one.

export const GLOBAL_FRONTEND_EVENT_TYPES = Object.freeze([
  'tutorial:start',
  'tutorial:end',
  'appearance:background',
]);

const GLOBAL_SET = new Set(GLOBAL_FRONTEND_EVENT_TYPES);

/** True when this event type must be mirrored to every connected tab. */
export function isGlobalFrontendEvent(eventType) {
  return typeof eventType === 'string' && GLOBAL_SET.has(eventType);
}
