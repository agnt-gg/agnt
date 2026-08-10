/**
 * runResume.js — reattach to turns that were still generating when this client
 * last went away, INCLUDING turns it never started.
 *
 * One call site, every chat surface.
 *
 * TWO SOURCES, AND WHY IT TAKES BOTH:
 *
 *   1. The local marker (inflightRuns.js → localStorage). Written the instant
 *      the server assigns a conversation id, so it covers the turn that has
 *      not been saved anywhere else yet. It is also per-browser-profile, which
 *      is precisely its limit: a run started in Chrome leaves no trace Safari
 *      or the Mac app can read.
 *
 *   2. The server (GET /orchestrator/runs). Authoritative, and the only source
 *      that can answer "what is running for me?" from a client with no prior
 *      knowledge. This is what makes a long task started on one machine
 *      resumable on another.
 *
 * Neither subsumes the other: the marker is faster and survives a server that
 * has already retired the run, the server list is the only one that crosses
 * devices. They are merged by conversationId, and the SERVER wins on conflict
 * because it knows things a stale local marker cannot — chiefly whether the
 * run is still alive and which surface owns it.
 *
 * This deliberately does NOT block app startup: each reattach holds an SSE
 * connection open until its run finishes, which can be minutes.
 */

import { listInflightRuns } from './inflightRuns.js';
import { fetchActiveRuns } from './chatService.js';
import { isOwnAnnouncement } from './clientId.js';

/**
 * Merge local markers with the server's list into one entry per conversation.
 *
 * Exported for tests: the precedence rule is the whole substance of this file,
 * and it deserves to be asserted directly rather than inferred from dispatch
 * side effects.
 */
export function mergeRunSources(localRuns = [], serverRuns = []) {
  const byId = new Map();

  for (const run of localRuns) {
    if (!run?.conversationId) continue;
    byId.set(run.conversationId, { ...run, source: 'local' });
  }

  for (const run of serverRuns) {
    if (!run?.conversationId) continue;
    const local = byId.get(run.conversationId);

    // channelKey decides WHICH STORE handles the reattach, so a wrong value
    // sends a workspace turn into the main chat window. The server derives it
    // from the saved transcript, but returns null for a conversation too young
    // to have been saved yet — and in exactly that case the local marker, if
    // there is one, is the better answer. Prefer the server's value only when
    // it actually has one.
    const channelKey = run.channelKey ?? local?.channelKey ?? null;

    byId.set(run.conversationId, {
      ...local,
      ...run,
      channelKey,
      source: local ? 'both' : 'server',
    });
  }

  return [...byId.values()];
}

/**
 * Which chat surface owns a conversation, from what THIS client already knows.
 *
 * The channel store is keyed by channelKey with the conversation id inside, so
 * ownership is a reverse lookup. Exported for tests, and because getting this
 * wrong is the interesting failure: routing a workspace turn into the main
 * chat window puts an answer somewhere the user was not looking, and leaves the
 * surface they WERE looking at still spinning.
 *
 * @returns {string|null} the owning channelKey, or null for the main chat.
 */
export function findChannelForConversation(store, conversationId) {
  const channels = store?.state?.chatUnified?.conversations;
  if (!channels || !conversationId) return null;
  for (const [channelKey, conv] of Object.entries(channels)) {
    if (conv?.conversationId === conversationId) return channelKey;
  }
  return null;
}

/**
 * Chat types the main chat store is willing to adopt sight-unseen.
 *
 * Same rule the socket delta mirror already applies (isMainChatEvent in
 * useRealtimeSync.js). Anything else — workspace, artifact, widget, tool —
 * belongs to an embedded surface, and adopting it into the main conversation
 * list would invent a conversation the user never opened there.
 */
const MAIN_CHAT_TYPES = new Set(['orchestrator', 'agent']);

/**
 * A run has started somewhere else. Attach to it, here, now.
 *
 * The PUSH half of resume. resumeInflightRuns() covers a client that is
 * starting up; this covers one that is already open and idle, which is the
 * case that previously required a reload: nothing polls, and the chat:* delta
 * mirror is no use to a client that missed the beginning of the turn.
 *
 * Reattaching (rather than consuming the announcement's own payload) is the
 * whole point: the SSE replay hands back the turn from conversation_started
 * onward, so a client that hears about a run ten seconds late still gets all
 * ten seconds.
 *
 * @returns {Promise<boolean>} true when a live run was found and consumed.
 */
export async function adoptAnnouncedRun(store, { conversationId, chatType, originClientId } = {}) {
  if (!store || !conversationId) return false;

  // Never attach to your own run: this client is already streaming it over the
  // SSE connection it opened, and a second attach would fork the conversation
  // in the UI. See clientId.js — for a new conversation the id in this
  // announcement is one this client has not learned yet, so identity is the
  // only reliable discriminator.
  if (isOwnAnnouncement(originClientId)) return false;

  const channelKey = findChannelForConversation(store, conversationId);
  if (channelKey) {
    // Announced HERE, at the moment of the decision — deliberately not from the
    // dispatch's resolved value. Both reattach actions resolve only when the
    // RUN ENDS, because the SSE connection stays open for the whole turn. A log
    // that waits for that says nothing for the entire duration of exactly the
    // long task this feature exists to rescue, and a human watching the console
    // reasonably reads silence as failure.
    console.log(`[Realtime] Attaching to run announced elsewhere: ${conversationId} → ${channelKey}`);
    return store.dispatch('chatUnified/reattachChannel', { channelKey, conversationId });
  }

  // No local channel owns it. Only adopt into the main chat if it is the kind
  // of conversation that lives there; an embedded surface that is not open on
  // this client has nowhere to put the turn, and will pick it up from its own
  // hydration when the user opens it.
  if (!MAIN_CHAT_TYPES.has(chatType || 'orchestrator')) return false;

  console.log(`[Realtime] Attaching to run announced elsewhere: ${conversationId} → main chat`);
  return store.dispatch('chat/reattachConversation', conversationId);
}

/**
 * Kick off a reattach for every run left in flight.
 *
 * @param {import('vuex').Store} store
 * @returns {Promise<{attempted: number, resumed: number}>} Settles when every
 *          reattached run has FINISHED, so tests can await it. Callers in app
 *          code should not.
 */
export async function resumeInflightRuns(store) {
  if (!store) return { attempted: 0, resumed: 0 };

  // No credentials means every reattach would 401 and clear markers that a
  // logged-in session could still have used.
  let token = null;
  try {
    token = localStorage.getItem('token');
  } catch {
    /* storage unavailable */
  }
  if (!token) return { attempted: 0, resumed: 0 };

  const localRuns = listInflightRuns();

  // Asked unconditionally, NOT only when a local marker exists — a client that
  // has never seen this conversation has no marker to trigger on, and that is
  // the entire cross-device case. fetchActiveRuns swallows its own failures,
  // so an unreachable server degrades to "local markers only", which is the
  // behaviour that shipped before this endpoint existed.
  const serverRuns = await fetchActiveRuns();

  const runs = mergeRunSources(localRuns, serverRuns);
  if (runs.length === 0) return { attempted: 0, resumed: 0 };

  console.log(
    `[runResume] ${runs.length} run(s) to reattach ` +
      `(${localRuns.length} local marker(s), ${serverRuns.length} from server)`,
  );

  const results = await Promise.allSettled(
    runs.map((run) => {
      if (run.channelKey) {
        return store.dispatch('chatUnified/reattachChannel', {
          channelKey: run.channelKey,
          conversationId: run.conversationId,
        });
      }
      return store.dispatch('chat/reattachConversation', run.conversationId);
    }),
  );

  const resumed = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  console.log(`[runResume] Reattached ${resumed}/${runs.length} run(s)`);
  return { attempted: runs.length, resumed };
}

export default resumeInflightRuns;
