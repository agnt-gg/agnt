/**
 * runJournal.js — the replay log, on disk, so a backend restart does not
 * destroy a turn that was still generating.
 *
 * WHAT THIS DOES AND DOES NOT BUY — READ THIS FIRST
 * ────────────────────────────────────────────────
 * activeRuns keeps its replay log in a `new Map()`. That is the right shape
 * for what it was built for: a run outliving its SOCKET. It is the wrong shape
 * for a run outliving its PROCESS, and the difference had a real cost — kill
 * the backend mid-turn and the answer was not merely unreachable, it was gone,
 * because conversation_logs is written at turn END and that end never came.
 *
 * This module makes the WORK ALREADY DONE durable. It does NOT, and cannot,
 * make generation resume. The turn's abort controller is handed to the LLM
 * adapter as `abortSignal` (OrchestratorService, the `streamAbortController`),
 * so the connection to the provider lives in this process's memory. When the
 * process dies that connection dies with it, and no amount of journalling
 * brings it back — the tokens that were never generated do not exist anywhere
 * to be recovered from.
 *
 * So the honest promise is: after a restart you get everything that had been
 * produced up to the moment of death, saved into the conversation where you
 * expect to find it, marked as interrupted. Not a turn that carries on.
 *
 * WHY SNAPSHOTS RATHER THAN AN APPEND-ONLY LOG
 * ────────────────────────────────────────────
 * The in-memory log is not append-only: appendToLog COALESCES consecutive text
 * deltas by mutating the previous entry, which is exactly what keeps it
 * O(answer) instead of O(chunks). An append-only journal would have to write
 * every raw delta and would throw that property away. So each write is a whole
 * snapshot, throttled, and the snapshot inherits the log's existing 8MB
 * ceiling rather than needing one of its own.
 *
 * DURABILITY OF THE JOURNAL ITSELF
 * ────────────────────────────────
 * Written to a temp file and rename()d into place. rename is atomic, so a
 * crash mid-write leaves either the previous good snapshot or the new one,
 * never a half-file that would poison recovery on the next boot — which would
 * turn a crash-recovery feature into a crash-loop.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import PathManager from '../../utils/PathManager.js';

/** Journals live under the AGNT data dir, so test isolation redirects them for free. */
const JOURNAL_DIR = () => PathManager.getDataPath('run-journal');

/** Snapshot cadence for an ordinary run. */
const INTERVAL_MS = 3000;

/**
 * Cadence once a run's log is large. The ceiling in activeRuns is 8MB; writing
 * that every 3s would be megabytes per second of I/O on the same disk the
 * database is on, to insure a case that is already pathological.
 */
const LARGE_RUN_BYTES = 512 * 1024;
const SLOW_INTERVAL_MS = 15000;

/** A journal older than this is junk — a bug, or a run nobody will ever want. */
export const MAX_JOURNAL_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How often the heartbeat looks for a run whose journal is behind.
 *
 * NOT the primary mechanism, and deliberately much slower than the throttle:
 * the event-driven path above already guarantees every published event reaches
 * disk within INTERVAL_MS. Measured, not assumed — a run that publishes and
 * then falls silent for twelve seconds still has its last event on disk three
 * seconds in.
 *
 * What the throttle CANNOT do is retry. `pending` is cleared before the write
 * is attempted, so a write that fails leaves nothing scheduled, and the next
 * attempt only happens when the next event arrives. During a long synchronous
 * tool call no event arrives for minutes — so a transient EACCES/ENOSPC at
 * exactly the wrong moment left the run uninsured for the whole tool call.
 * That is the gap this closes, and it is why the heartbeat is dirty-checked
 * rather than periodic: when nothing has changed there is nothing to write.
 */
const HEARTBEAT_MS = 30000;

/** Per-conversation throttle state: { timer }. */
const pending = new Map();

/**
 * Dirty tracking.
 *
 * `revisions` counts how many times a run's log has moved; `written` records
 * the revision of the last SUCCESSFUL write. A run is dirty when they differ,
 * which makes retry fall out for free: a failed write never updates `written`,
 * so the run stays dirty and the next heartbeat picks it up.
 */
const revisions = new Map();
const written = new Map();

/** Consecutive write failures per conversation — used only to keep logs quiet. */
const failures = new Map();

/** Monotonic, so two concurrent writes can never share a temp path. */
let writeSeq = 0;

/** The heartbeat interval handle, or null when not running. */
let heartbeatTimer = null;

/**
 * Filename for a conversation.
 *
 * Sanitised for the filesystem AND suffixed with a hash of the raw id, because
 * sanitising alone is not injective — two different conversation ids could
 * sanitise to the same name and silently overwrite each other's insurance.
 */
function journalPath(conversationId) {
  const safe = String(conversationId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  const hash = crypto.createHash('sha1').update(String(conversationId)).digest('hex').slice(0, 8);
  return path.join(JOURNAL_DIR(), `${safe}-${hash}.json`);
}

/** The serialisable shape of a run. `latest` is a Map, so it rides as entries. */
function snapshot(run) {
  return {
    version: 1,
    conversationId: run.conversationId,
    userId: run.userId ?? null,
    chatType: run.chatType || 'orchestrator',
    startedAt: run.startedAt,
    userMessage: run.userMessage ?? null,
    truncated: !!run.truncated,
    events: run.events,
    latest: [...run.latest.entries()],
    journaledAt: Date.now(),
  };
}

/**
 * Is there anything worth insuring yet?
 *
 * `conversation_started` alone carries no answer, and writing a file for every
 * turn the instant it opens would be a lot of I/O for nothing. The first
 * snapshot therefore waits for real output.
 */
function worthJournalling(run) {
  return run?.events?.some((e) => e.eventName !== 'conversation_started');
}

/**
 * A temp path no other write can be using.
 *
 * Was `${target}.${pid}.tmp`, which is unique per PROCESS but not per WRITE —
 * so a throttled async write and the synchronous shutdown flush, both for the
 * same run in the same process, targeted the same file. I could not get that
 * to corrupt a journal in practice (the writes are far too quick to overlap at
 * realistic sizes), so this is a latent hazard rather than an observed bug.
 * The sequence number costs nothing and removes the question.
 */
function tempPath(target) {
  writeSeq += 1;
  return `${target}.${process.pid}.${writeSeq}.tmp`;
}

/** Record that the run's log, as of `revision`, is now safely on disk. */
function markWritten(conversationId, revision) {
  written.set(conversationId, revision);
  failures.delete(conversationId);
}

/**
 * Report a failed write without flooding the log.
 *
 * A full disk during an hour-long tool call would otherwise produce a warning
 * every 30 seconds. The first failure is always reported, then every tenth, so
 * a persistent problem stays visible without burying everything else.
 */
function noteFailure(conversationId, err) {
  const n = (failures.get(conversationId) || 0) + 1;
  failures.set(conversationId, n);
  if (n === 1 || n % 10 === 0) {
    console.warn(`[RunJournal] Could not journal ${conversationId} (attempt ${n}):`, err?.message || err);
  }
}

function writeSnapshotSync(run) {
  const revision = revisions.get(run.conversationId) || 0;
  const dir = JOURNAL_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const target = journalPath(run.conversationId);
  const tmp = tempPath(target);
  fs.writeFileSync(tmp, JSON.stringify(snapshot(run)));
  fs.renameSync(tmp, target); // atomic
  markWritten(run.conversationId, revision);
}

async function writeSnapshot(run) {
  // Captured BEFORE serialising: events that arrive while this write is in
  // flight belong to a later revision, and must leave the run dirty so the
  // next pass picks them up.
  const revision = revisions.get(run.conversationId) || 0;
  const dir = JOURNAL_DIR();
  await fsp.mkdir(dir, { recursive: true });
  const target = journalPath(run.conversationId);
  const tmp = tempPath(target);
  await fsp.writeFile(tmp, JSON.stringify(snapshot(run)));
  await fsp.rename(tmp, target); // atomic
  markWritten(run.conversationId, revision);
}

/**
 * Note that a run has produced output. Throttled — safe to call on every event.
 *
 * Never throws and never rejects: journalling is insurance layered on top of a
 * working turn, and insurance that can break the thing it insures is worse than
 * no insurance.
 */
export function journalRun(run) {
  if (!run || run.ended || !run.conversationId) return;

  // Bumped before the worth-journalling gate, so the very first real event
  // makes the run dirty even though nothing has been written yet.
  revisions.set(run.conversationId, (revisions.get(run.conversationId) || 0) + 1);

  if (!worthJournalling(run)) return;

  const state = pending.get(run.conversationId);
  if (state?.timer) return; // a write is already scheduled; it will pick up the latest

  const delay = run.bytes > LARGE_RUN_BYTES ? SLOW_INTERVAL_MS : INTERVAL_MS;
  const timer = setTimeout(() => {
    pending.delete(run.conversationId);
    // Re-check: the run may have ended (and been discarded) while we waited.
    if (run.ended) return;
    writeSnapshot(run).catch((err) => noteFailure(run.conversationId, err));
  }, delay);
  // A pending journal write must never hold the process open at exit.
  if (typeof timer.unref === 'function') timer.unref();
  pending.set(run.conversationId, { timer });
}

/** Has this run's log moved since the last successful write? */
function isDirty(run) {
  const id = run.conversationId;
  return (revisions.get(id) || 0) !== (written.get(id) || 0);
}

/**
 * Periodically write any run whose journal has fallen behind.
 *
 * A SAFETY NET, not the main mechanism — see HEARTBEAT_MS for the measurement
 * that says so. On a healthy system this finds nothing to do, every time,
 * because the throttle got there first. It earns its place in exactly two
 * situations, both of which are invisible to the event-driven path:
 *
 *   1. A write FAILED and no further event will arrive to trigger another.
 *      This is precisely what a long synchronous tool call looks like, and it
 *      was measured: a run whose write failed stayed absent from disk
 *      indefinitely, healing only when the next event happened to arrive.
 *
 *   2. Staleness is bounded by the clock rather than by traffic. If the
 *      throttle is ever changed, or a future code path mutates a run without
 *      going through publish(), the journal still converges.
 *
 * Dirty-checked on purpose. An unconditional periodic flush would rewrite
 * byte-identical files — for an 8MB run on a 30s timer that is megabytes of
 * pointless I/O per minute, on the same disk as the database, to save data
 * that is already saved.
 *
 * @param {() => Iterable<object>} getLiveRuns  supplied by the caller because
 *        activeRuns imports THIS module; importing it back would be circular.
 * @returns {object|null} the interval handle, or null if it could not start.
 */
export function startJournalHeartbeat(getLiveRuns, { intervalMs = HEARTBEAT_MS } = {}) {
  if (heartbeatTimer) return heartbeatTimer; // idempotent: two intervals would double every write
  if (typeof getLiveRuns !== 'function') {
    console.warn('[RunJournal] Heartbeat not started: no run source supplied');
    return null;
  }

  heartbeatTimer = setInterval(() => {
    let runs;
    try {
      runs = getLiveRuns() || [];
    } catch (err) {
      console.warn('[RunJournal] Heartbeat could not list runs:', err?.message || err);
      return;
    }

    for (const run of runs) {
      if (!run || run.ended || !run.conversationId) continue;
      if (!worthJournalling(run)) continue;
      // A scheduled write already owns this run; racing it would be the very
      // double-write the temp-path sequence exists to make harmless, and there
      // is no reason to cause it.
      if (pending.has(run.conversationId)) continue;
      if (!isDirty(run)) continue;

      writeSnapshot(run)
        .then(() => {
          console.log(`[RunJournal] Heartbeat checkpointed ${run.conversationId} (a write had not landed)`);
        })
        .catch((err) => noteFailure(run.conversationId, err));
    }
  }, intervalMs);

  // Must never hold the process open at exit.
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  return heartbeatTimer;
}

/** Stop the heartbeat. Safe to call when it was never started. */
export function stopJournalHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/**
 * Write every live run's journal RIGHT NOW, synchronously.
 *
 * Called from the shutdown drain. `launchctl kickstart -k`, systemd, Ctrl-C and
 * an app quit all arrive as SIGTERM/SIGINT, which means the common restart is
 * not a crash at all — it is a moment where the process still exists and can
 * save what it has. Sync on purpose: the shutdown path has a hard deadline and
 * an awaited write can lose the race to process.exit.
 */
export function flushAllSync(runsIterable) {
  let flushed = 0;
  for (const run of runsIterable) {
    if (!run || run.ended || !worthJournalling(run)) continue;
    try {
      writeSnapshotSync(run);
      flushed += 1;
    } catch (err) {
      console.warn(`[RunJournal] Shutdown flush failed for ${run.conversationId}:`, err?.message || err);
    }
  }
  if (flushed > 0) console.log(`[RunJournal] Flushed ${flushed} in-flight run(s) to disk before shutdown`);
  return flushed;
}

/**
 * The turn is over and its answer is durable elsewhere — drop the insurance.
 *
 * Called from finalizeRun. By then OrchestratorService has already written
 * conversation_logs AND the saved transcript (both happen before endRun), so a
 * journal surviving past this point would only ever cause a pointless recovery
 * pass on the next boot.
 */
export function discardJournal(conversationId) {
  if (!conversationId) return;
  const state = pending.get(conversationId);
  if (state?.timer) clearTimeout(state.timer);
  pending.delete(conversationId);
  // Without this the tracking Maps grow for the life of the process — one
  // entry per conversation ever run, never released.
  revisions.delete(conversationId);
  written.delete(conversationId);
  failures.delete(conversationId);
  fsp.rm(journalPath(conversationId), { force: true }).catch(() => {
    /* best effort — a stale journal is recovered idempotently anyway */
  });
}

/** Every journal on disk, newest first. Unreadable files are reported, not thrown. */
export async function listJournals() {
  const dir = JOURNAL_DIR();
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return []; // no directory yet = nothing has ever been journalled
  }

  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      // Orphaned temp files: a write that died between open and rename. They
      // were self-limiting when every write shared one temp path; now that each
      // write has its own, they would accumulate. Only old ones are removed, so
      // a write in flight right now is never pulled out from under itself.
      if (name.includes('.tmp')) {
        try {
          const stat = await fsp.stat(path.join(dir, name));
          if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
            await fsp.rm(path.join(dir, name), { force: true });
          }
        } catch {
          /* already gone */
        }
      }
      continue;
    }
    const file = path.join(dir, name);
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (!parsed?.conversationId || !Array.isArray(parsed.events)) {
        console.warn(`[RunJournal] Ignoring malformed journal ${name}`);
        await fsp.rm(file, { force: true });
        continue;
      }
      out.push({ file, ...parsed });
    } catch (err) {
      console.warn(`[RunJournal] Ignoring unreadable journal ${name}:`, err?.message || err);
      await fsp.rm(file, { force: true }).catch(() => {});
    }
  }
  return out.sort((a, b) => (b.journaledAt || 0) - (a.journaledAt || 0));
}

/** Remove a journal file by its own path (used by recovery). */
export async function removeJournalFile(file) {
  await fsp.rm(file, { force: true }).catch(() => {});
}

/** Test seam. */
export function _resetForTests() {
  for (const { timer } of pending.values()) if (timer) clearTimeout(timer);
  pending.clear();
  revisions.clear();
  written.clear();
  failures.clear();
  stopJournalHeartbeat();
}

export default {
  journalRun,
  flushAllSync,
  discardJournal,
  listJournals,
  removeJournalFile,
  startJournalHeartbeat,
  stopJournalHeartbeat,
};
