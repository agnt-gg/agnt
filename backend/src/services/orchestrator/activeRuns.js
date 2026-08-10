/**
 * activeRuns.js — registry of in-flight chat runs.
 *
 * THE INVARIANT THIS FILE EXISTS TO ENFORCE:
 *
 *   A chat turn's lifetime is a property of the CONVERSATION,
 *   not of the HTTP response socket that happened to start it.
 *
 * Before this registry existed, `res.on('close')` aborted the LLM stream, so a
 * browser refresh mid-turn *cancelled the generation outright*. The partial
 * answer was written to `conversation_logs` — a table with no read path — and
 * the client's only copy lived in a buffer that streaming deltas never marked
 * dirty. Every layer failed in the same direction, so a refresh mid-answer meant
 * the user never saw that message again. There was no layer at which a refresh
 * degraded gracefully.
 *
 * With this registry the socket closing is just a transport event. The run keeps
 * generating, keeps appending to a bounded replay log, and any client may
 * reattach by conversation id to receive (a) everything already emitted, then
 * (b) the remainder of the turn live, on the same SSE event shape it already
 * knows how to parse.
 *
 * Cancellation is now something a client must ASK for (`cancelRun`) rather than
 * something it causes by looking away.
 *
 * MEMORY DISCIPLINE: a replay log is an unbounded buffer unless something bounds
 * it. Three mechanisms do:
 *   1. consecutive text deltas coalesce into one entry (growth is O(answer), not
 *      O(chunks) — a 20k-token answer is ~1 entry, not ~20k);
 *   2. per-round telemetry keeps only its latest instance;
 *   3. a hard byte ceiling stops new non-text payloads and sets `truncated`, so
 *      an oversized run degrades into "you get the prose, not the blobs" rather
 *      than into an OOM.
 * The whole buffer is freed when the run ends and its retention window lapses.
 */

// The ONLY import in this file, and it earns its place: the replay log below
// is the sole record of a turn until conversation_logs is written at turn END,
// so a process that dies mid-turn used to destroy the answer outright rather
// than merely losing the socket. runJournal mirrors the log to disk. It cannot
// resume generation — the provider connection lives in this process — and its
// header is explicit about that.
import { journalRun, discardJournal } from './runJournal.js';

/** Live runs, keyed by conversationId. */
const runs = new Map();

/**
 * How long a finished run stays readable after it ends. A refresh that lands in
 * the instant between the last token and the socket closing must still find the
 * tail — otherwise the exact race this module exists to fix reopens at the end
 * of every turn.
 */
const RETAIN_ENDED_MS = 60_000;

/** Hard ceiling on a single run's replay log. */
const MAX_RUN_BYTES = 8 * 1024 * 1024;

/** Absolute cap on entries, independent of size (defends against many tiny events). */
const MAX_RUN_ENTRIES = 5000;

/**
 * Events whose payload is a text fragment that should be concatenated with the
 * previous entry when it targets the same message. Maps event name -> payload
 * field holding the fragment.
 */
const COALESCE_FIELD = {
  content_delta: 'delta',
  reasoning_delta: 'delta',
};

/**
 * Events that describe "state right now" rather than "a thing that happened".
 * Only the most recent instance is worth replaying; older ones are superseded.
 */
const REPLACE_LATEST = new Set(['context_status', 'context_manifest']);

/** Events that must never be dropped by the byte ceiling — they carry the answer. */
const NEVER_DROP = new Set([
  'conversation_started',
  'assistant_message',
  'content_delta',
  'reasoning_delta',
  'final_content',
  'error',
  'done',
]);

const byteLen = (value) => {
  try {
    return JSON.stringify(value)?.length || 0;
  } catch {
    return 0;
  }
};

/**
 * Register a new in-flight run.
 *
 * If a run already exists for this conversation it is cancelled first: the user
 * sending a new turn is unambiguous evidence they are done with the previous
 * one, and leaving it alive would let two generations write to one conversation
 * concurrently. This matters more now that runs outlive their sockets — without
 * it, a refresh-and-resend loop would stack generations.
 */
export function startRun({ conversationId, userId, chatType, abortController, userMessage = null }) {
  if (!conversationId) return null;

  const existing = runs.get(conversationId);
  if (existing && !existing.ended) {
    console.log(`[ActiveRuns] Superseding in-flight run for conversation ${conversationId}`);
    try {
      existing.abortController?.abort();
    } catch {
      /* already aborted */
    }
    finalizeRun(existing, 'superseded');
  }

  const run = {
    conversationId,
    userId: userId ?? null,
    chatType: chatType || 'orchestrator',
    abortController: abortController || null,
    startedAt: Date.now(),
    endedAt: null,
    ended: false,
    endStatus: null,
    cancelled: false,
    truncated: false,
    bytes: 0,
    /** Replay log: [{ eventName, data }] in emission order. */
    events: [],
    /** Latest instance of each REPLACE_LATEST event, by name. */
    latest: new Map(),
    /** Reattached SSE responses (never includes the originating response). */
    subscribers: new Set(),
    /** The user turn that started this run, so a reattaching client can rebuild the bubble. */
    userMessage: typeof userMessage === 'string' ? userMessage.slice(0, 20_000) : null,
    gcTimer: null,
  };

  runs.set(conversationId, run);
  return run;
}

/**
 * Append an event to the replay log and fan it out to every reattached client.
 * Called for every event the orchestrator emits, whether or not the originating
 * socket is still open.
 */
export function publish(run, eventName, data) {
  if (!run || run.ended) return;

  appendToLog(run, eventName, data);

  // Throttled, best-effort, never throws. Deliberately after appendToLog so a
  // snapshot can only ever describe a log the in-memory copy already has.
  journalRun(run);

  if (run.subscribers.size === 0) return;
  const frame = `event: ${eventName}\ndata: ${safeStringify(data)}\n\n`;
  for (const res of run.subscribers) {
    try {
      res.write(frame);
    } catch {
      run.subscribers.delete(res);
    }
  }
}

function safeStringify(data) {
  try {
    return JSON.stringify(data);
  } catch (e) {
    return JSON.stringify({ error: `unserializable payload: ${e.message}` });
  }
}

function appendToLog(run, eventName, data) {
  // 1. Superseding telemetry — keep only the newest.
  if (REPLACE_LATEST.has(eventName)) {
    run.latest.set(eventName, data);
    return;
  }

  // 2. Text fragments — concatenate onto the previous entry when it targets the
  //    same message. This is what keeps the log O(answer length).
  const field = COALESCE_FIELD[eventName];
  if (field) {
    const prev = run.events[run.events.length - 1];
    const sameTarget =
      prev &&
      prev.eventName === eventName &&
      prev.data?.assistantMessageId === data?.assistantMessageId;
    if (sameTarget && typeof prev.data[field] === 'string' && typeof data?.[field] === 'string') {
      prev.data[field] += data[field];
      run.bytes += data[field].length;
      return;
    }
  }

  // 3. Byte / entry ceiling. Text always wins; blobs are what get dropped.
  const size = byteLen(data);
  const overflow =
    run.bytes + size > MAX_RUN_BYTES || run.events.length >= MAX_RUN_ENTRIES;
  if (overflow && !NEVER_DROP.has(eventName)) {
    if (!run.truncated) {
      run.truncated = true;
      console.warn(
        `[ActiveRuns] Replay log ceiling reached for ${run.conversationId} — dropping non-text payloads from here on`,
      );
    }
    return;
  }

  run.events.push({ eventName, data });
  run.bytes += size;
}

/**
 * Attach a reattaching client. Replays everything emitted so far, then leaves
 * the response open so the rest of the turn streams live.
 *
 * @returns {'attached'|'not_found'|'forbidden'|'ended'}
 */
export function attachSubscriber(conversationId, res, userId) {
  const run = runs.get(conversationId);
  if (!run) return 'not_found';
  if (run.userId != null && userId != null && String(run.userId) !== String(userId)) {
    return 'forbidden';
  }

  // Head frame. Two jobs:
  //
  //   1. Let the client rebuild the user bubble when its own snapshot predates
  //      the turn.
  //   2. Name every assistant message this replay is about to re-emit, so the
  //      client can drop its own partial copies first.
  //
  // (2) matters because the client now persists streamed text as it arrives. A
  // reattaching tab therefore already holds a half-written version of the very
  // message we are about to replay, and without this it would render the answer
  // twice. Identifying the overlap by SERVER-ASSIGNED ID keeps the rule exact:
  // no timestamp comparison, no clock-skew assumptions, no content matching.
  writeFrame(res, 'run_resumed', {
    conversationId,
    chatType: run.chatType,
    startedAt: run.startedAt,
    userMessage: run.userMessage,
    truncated: run.truncated,
    ended: run.ended,
    replayedMessageIds: collectReplayedMessageIds(run),
  });

  for (const { eventName, data } of run.events) {
    writeFrame(res, eventName, data);
  }
  for (const [eventName, data] of run.latest) {
    writeFrame(res, eventName, data);
  }

  if (run.ended) {
    // Nothing more is coming — tell the client the turn is over and close.
    writeFrame(res, 'run_ended', { conversationId, status: run.endStatus });
    try {
      res.end();
    } catch {
      /* already closed */
    }
    return 'ended';
  }

  run.subscribers.add(res);
  res.on('close', () => run.subscribers.delete(res));
  return 'attached';
}

/**
 * Ids of every assistant message this run has emitted, in order. Derived from
 * the replay log rather than tracked separately — one source of truth means the
 * two can never disagree.
 */
function collectReplayedMessageIds(run) {
  const ids = [];
  for (const { eventName, data } of run.events) {
    if (eventName === 'assistant_message' && data?.id) ids.push(data.id);
  }
  return ids;
}

function writeFrame(res, eventName, data) {
  try {
    res.write(`event: ${eventName}\ndata: ${safeStringify(data)}\n\n`);
  } catch {
    /* client vanished mid-replay — its own close handler cleans up */
  }
}

/**
 * Cancel a run on explicit request. This is the ONLY path that aborts
 * generation; losing a socket no longer does.
 *
 * @returns {'cancelled'|'not_found'|'forbidden'|'already_ended'}
 */
export function cancelRun(conversationId, userId) {
  const run = runs.get(conversationId);
  if (!run) return 'not_found';
  if (run.userId != null && userId != null && String(run.userId) !== String(userId)) {
    return 'forbidden';
  }
  if (run.ended) return 'already_ended';

  run.cancelled = true;
  try {
    run.abortController?.abort();
  } catch {
    /* already aborted */
  }
  console.log(`[ActiveRuns] Run cancelled by client for conversation ${conversationId}`);
  return 'cancelled';
}

/** Mark a run finished, flush subscribers, and schedule its buffer for release. */
export function endRun(conversationId, status = 'completed') {
  const run = runs.get(conversationId);
  if (!run || run.ended) return;
  finalizeRun(run, status);
}

function finalizeRun(run, status) {
  run.ended = true;
  run.endedAt = Date.now();
  run.endStatus = run.cancelled ? 'cancelled' : status;

  // The turn is over, so its answer is already durable somewhere better:
  // OrchestratorService writes conversation_logs AND the saved transcript
  // before it calls endRun. Keeping the journal past this point would only buy
  // a pointless recovery pass on the next boot. (Recovery is idempotent, so
  // losing this race is harmless either way.)
  discardJournal(run.conversationId);

  for (const res of run.subscribers) {
    try {
      writeFrame(res, 'run_ended', { conversationId: run.conversationId, status: run.endStatus });
      res.end();
    } catch {
      /* already closed */
    }
  }
  run.subscribers.clear();

  if (run.gcTimer) clearTimeout(run.gcTimer);
  run.gcTimer = setTimeout(() => {
    // Only evict if this exact run still owns the slot — a superseding run may
    // have taken the conversation over in the meantime.
    if (runs.get(run.conversationId) === run) runs.delete(run.conversationId);
  }, RETAIN_ENDED_MS);
  if (typeof run.gcTimer.unref === 'function') run.gcTimer.unref();
}

/** Lightweight status probe — no replay, no subscription. */
export function getRunStatus(conversationId, userId) {
  const run = runs.get(conversationId);
  if (!run) return { active: false, known: false };
  if (run.userId != null && userId != null && String(run.userId) !== String(userId)) {
    return { active: false, known: false };
  }
  return {
    known: true,
    active: !run.ended,
    ended: run.ended,
    status: run.endStatus,
    chatType: run.chatType,
    startedAt: run.startedAt,
    truncated: run.truncated,
  };
}

/**
 * Every run this user currently owns.
 *
 * WHY A LIST ENDPOINT HAS TO EXIST:
 *
 * Every other function here is keyed by conversationId — you can only ask
 * about a run whose id you already hold. The only place that id was recorded
 * is `inflightRuns.js`, which writes it to localStorage. localStorage is
 * per-browser-profile, so the tab that STARTED a run could find it again, and
 * nothing else could: not a second browser, not the Mac app. The run itself
 * was alive and reattachable the whole time (that is the invariant at the top
 * of this file) — it was simply undiscoverable from anywhere else.
 *
 * This is the missing question: "what is running for ME?", asked with no prior
 * knowledge. Ended-but-retained runs are included and flagged rather than
 * hidden, because a client that arrives inside RETAIN_ENDED_MS still wants the
 * tail — the same reason the retention window exists at all.
 *
 * Deliberately NOT included: the replay log, the abort controller, the
 * subscriber set. This answers "which conversations are live", and reattaching
 * to one is a separate, explicit request.
 */
export function listRunsForUser(userId) {
  if (userId == null) return [];
  const out = [];
  for (const run of runs.values()) {
    if (run.userId == null || String(run.userId) !== String(userId)) continue;
    out.push({
      conversationId: run.conversationId,
      chatType: run.chatType,
      active: !run.ended,
      ended: run.ended,
      status: run.endStatus,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      truncated: run.truncated,
      userMessage: run.userMessage,
    });
  }
  // Newest first: when a client shows "still running", the most recent turn is
  // the one the user is most likely looking for.
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/**
 * Every live run, for the shutdown flush.
 *
 * SIGTERM is the COMMON restart — `launchctl kickstart -k`, systemd, Ctrl-C, an
 * app quit — and it is not a crash: the process still exists and can save what
 * it has. Handing the runs out lets the shutdown path journal them in full
 * rather than leaving whatever the last throttled snapshot caught.
 */
export function liveRuns() {
  return [...runs.values()].filter((run) => !run.ended);
}

/** Test/introspection helper. */
export function _runCount() {
  return runs.size;
}

/** Test helper — drops all state. Never called by production code. */
export function _resetForTests() {
  for (const run of runs.values()) {
    if (run.gcTimer) clearTimeout(run.gcTimer);
  }
  runs.clear();
}

export default {
  startRun,
  publish,
  attachSubscriber,
  cancelRun,
  endRun,
  getRunStatus,
  listRunsForUser,
  liveRuns,
};
