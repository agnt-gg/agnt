/**
 * clientId.js — who "this client" is, for the lifetime of this page load.
 *
 * WHY THIS EXISTS
 * ---------------
 * The server announces `run:started` to every one of a user's connected
 * clients so an already-open browser can attach to a turn begun somewhere else
 * (see RealtimeEvents.RUN_STARTED). The client that STARTED the run is in that
 * audience too, and it must ignore its own announcement — it is already
 * streaming the turn over its own SSE connection.
 *
 * Recognising your own run by conversation id does NOT work, and the failure is
 * not theoretical. For a NEW conversation the sender has no server id yet: its
 * local slot is keyed by a temporary one until `conversation_started` arrives
 * over SSE. The announcement travels on the socket, a different transport, so
 * the two are unordered. When the announcement wins that race the sender does
 * not recognise the id, reattaches to itself, and `MIGRATE_CONVERSATION_ID`
 * then overwrites the slot it just created — leaving two live streams writing
 * into a conversation that is only partly attached to the UI.
 *
 * So identity is carried explicitly instead of inferred from delivery order.
 *
 * WHY PER PAGE LOAD, AND NOT PERSISTED
 * ------------------------------------
 * A module-level value is deliberate. sessionStorage would survive a reload,
 * and a reloaded tab would then recognise the still-running turn as "mine" and
 * skip attaching to it — which is precisely the case resume exists to handle.
 * A fresh page load is a fresh client, and should behave like one.
 */

/**
 * Stable for this page load, unique across tabs, windows and browsers.
 * crypto.randomUUID is available in every browser this app supports; the
 * fallback keeps non-secure-context and older test environments working rather
 * than throwing during module init.
 */
const CLIENT_ID = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

/** The id sent as X-AGNT-Client-Id, and compared against announcements. */
export function getClientId() {
  return CLIENT_ID;
}

/**
 * Did THIS client start the run being announced?
 *
 * A missing origin means the request predates the header (or came from
 * somewhere that does not send it). That is treated as "not mine": the cost of
 * ignoring an announcement that was ours is a duplicate attach, while the cost
 * of claiming one that was not is never picking the run up at all — and the
 * latter is the bug this whole path exists to fix.
 */
export function isOwnAnnouncement(originClientId) {
  return !!originClientId && originClientId === CLIENT_ID;
}

export default getClientId;
