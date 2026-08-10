/**
 * recoverJournaledRuns.js — turn journals left by a dead process back into
 * saved conversations, at boot.
 *
 * A journal exists only for a run that never reached endRun, which means the
 * process died while it was generating. conversation_logs is written at turn
 * END, so for those turns there is no other record anywhere: before this, the
 * work was not merely unreachable, it was gone.
 *
 * WHY THE CLIENT'S OWN REDUCER
 * ────────────────────────────
 * The journal holds SSE events, which is what a browser consumes — not the
 * provider transcript that persistTurnTranscript projects from. Rather than
 * invent a third way to turn a turn into messages, this replays the events
 * through `applyStreamEvent` from chatStreamReducer.mirror.js: the byte-exact
 * copy of the reducer the client itself runs, already pinned to the original by
 * chatStreamReducer.mirror.test.js. A recovered transcript is therefore built
 * the same way the live one was, by the same code, and cannot render
 * differently from what the user was watching when the lights went out.
 *
 * The write goes through writeTranscript, so recovery inherits every rule the
 * turn-end path already has: update-only (never invent a conversation), never
 * shrink a richer saved copy, carry every column, leave the read watermark
 * alone. That also makes recovery IDEMPOTENT — running it twice, or running it
 * on a journal whose turn actually did finish, cannot damage anything.
 */

import { applyStreamEvent, createAssistantMessage } from './chatStreamReducer.mirror.js';
import { writeTranscript } from './persistTurnTranscript.js';
import { listJournals, removeJournalFile, MAX_JOURNAL_AGE_MS } from './runJournal.js';

/** Shown on the recovered turn so a truncated answer is never mistaken for the whole one. */
export const INTERRUPTED_NOTE = 'Interrupted — the backend restarted while this was generating';

/**
 * Replay a journal's events into UI messages.
 *
 * Mirrors the client's own SSE handling: `assistant_message` CREATES a message
 * (the reducer has no case for it — the client adds it to the transcript), and
 * every later event is applied to that message.
 *
 * Exported for tests, and because this is the interesting half.
 */
export function messagesFromJournal({ userMessage, events = [] }) {
  const messages = [];

  if (typeof userMessage === 'string' && userMessage.trim()) {
    messages.push({
      id: `msg-user-recovered-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      metadata: [],
      toolCalls: [],
      contentParts: [],
    });
  }

  let current = null;
  for (const entry of events) {
    const { eventName, data } = entry || {};
    if (!eventName) continue;

    if (eventName === 'assistant_message') {
      // The event payload IS the message, exactly as the client treats it.
      // Seeded from a canonical shape first so a sparse payload still has the
      // mutable fields the reducer writes into.
      current = {
        ...createAssistantMessage({ id: data?.id, timestamp: data?.timestamp }),
        ...(data && typeof data === 'object' ? data : {}),
      };
      if (typeof current.content !== 'string') current.content = '';
      if (!Array.isArray(current.contentParts)) current.contentParts = [];
      if (!Array.isArray(current.toolCalls)) current.toolCalls = [];
      if (typeof current.reasoning !== 'string') current.reasoning = '';
      current.role = 'assistant';
      messages.push(current);
      continue;
    }

    if (!current) continue; // telemetry before any assistant turn — nothing to apply it to
    try {
      applyStreamEvent(current, eventName, data || {});
    } catch {
      // One malformed event must not cost the whole answer.
    }
  }

  // Say so, on the turn itself. A partial answer that looks complete is worse
  // than an obviously partial one.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant) {
    lastAssistant.metadata = [...(lastAssistant.metadata || []), INTERRUPTED_NOTE];
  }

  // Nothing the user would recognise as an answer — drop it rather than write
  // an empty bubble over whatever is already saved.
  const hasSubstance = messages.some(
    (m) => (m.content && m.content.trim()) || (m.toolCalls && m.toolCalls.length),
  );
  return hasSubstance ? messages : [];
}

/**
 * Recover every journal on disk. Safe to call once per boot.
 *
 * Never throws: a failure here must not stop the server starting. Returns a
 * summary so the caller can log one honest line.
 */
export async function recoverJournaledRuns({ now = Date.now() } = {}) {
  const summary = { found: 0, recovered: 0, skipped: 0, expired: 0 };

  let journals;
  try {
    journals = await listJournals();
  } catch (err) {
    console.warn('[RunRecovery] Could not read journals:', err?.message || err);
    return summary;
  }
  summary.found = journals.length;
  if (!journals.length) return summary;

  for (const journal of journals) {
    try {
      // A journal this old is not a turn anybody is still waiting for, and
      // keeping it would mean retrying the same failure on every boot forever.
      if (journal.journaledAt && now - journal.journaledAt > MAX_JOURNAL_AGE_MS) {
        summary.expired += 1;
        await removeJournalFile(journal.file);
        continue;
      }

      const messages = messagesFromJournal(journal);
      if (!messages.length) {
        summary.skipped += 1;
        await removeJournalFile(journal.file);
        continue;
      }

      const result = await writeTranscript({
        conversationId: journal.conversationId,
        userId: journal.userId,
        messages,
        logTag: 'RunRecovery',
      });

      if (result.written) {
        summary.recovered += 1;
        console.log(
          `[RunRecovery] Restored the interrupted turn in ${journal.conversationId} `
          + `(${messages.length} message(s) from a journal written ${new Date(journal.journaledAt).toISOString()})`,
        );
      } else {
        summary.skipped += 1;
        console.log(`[RunRecovery] Nothing to restore for ${journal.conversationId}: ${result.reason}`);
      }

        // Discarded once a DECISION has been reached — written or declined.
        // A journal that declined now will decline on the next boot too: the
        // reasons are all permanent (no_saved_row, not_a_transcript,
        // saved_copy_is_richer), so keeping it would re-decide it forever.
        await removeJournalFile(journal.file);
      } catch (err) {
        // Deliberately NOT deleted here. An exception is not a decision: at boot
        // it is frequently transient — a database still opening, a locked sqlite
        // file, a disk that is briefly unhappy — and this file is the ONLY copy
        // of an interrupted turn. Retrying on the next boot costs one failed
        // write; deleting costs the user their answer.
        //
        // This cannot retry forever: the age check at the top of the loop
        // expires a journal older than MAX_JOURNAL_AGE_MS before any write is
        // attempted, so a permanently poisonous journal is still collected.
        console.warn(
          `[RunRecovery] Failed on ${journal?.conversationId}, keeping the journal to retry at the next boot:`,
          err?.message || err,
        );
        summary.skipped += 1;
      }
  }

  if (summary.recovered > 0 || summary.expired > 0) {
    console.log(
      `[RunRecovery] ${summary.recovered} turn(s) restored, `
      + `${summary.skipped} skipped, ${summary.expired} expired, from ${summary.found} journal(s)`,
    );
  }
  return summary;
}

export default recoverJournaledRuns;
