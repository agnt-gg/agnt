/**
 * persistTurnTranscript.js — write the conversation's saved row at turn end,
 * with no client involved.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * A run's lifetime stopped depending on a browser socket when activeRuns.js
 * landed: generation continues, conversation_logs keeps growing, and any
 * client may reattach. The SAVED row did not get the same treatment.
 * content_outputs has exactly one writer — an HTTP handler a client must call
 * — so the conversation list only ever shows what some browser was awake to
 * report. Close the laptop on a long task and the answer is complete on disk
 * and truncated on screen.
 *
 * That is a strictly worse failure than losing the work, because it looks
 * exactly like losing the work.
 *
 * THE RULES, AND WHY EACH ONE IS NARROW
 * -------------------------------------
 * 1. UPDATE ONLY — never create.
 *    A row exists because some client decided this conversation belongs in the
 *    list. Creating one here would enrol conversations that no client ever
 *    chose to save: agent chats (the main store deliberately skips autosave
 *    when agentId is set), suggestion calls, and every embedded surface that
 *    has its own persistence rules. Getting that wrong fills the user's
 *    sidebar with entries they never asked for, which is a worse bug than the
 *    one being fixed. The reported case — a row saved early, then abandoned
 *    mid-answer — is entirely covered by updating.
 *
 * 2. NEVER SHRINK what a client saved.
 *    Compared by SUBSTANCE, not length or row count, for the reason
 *    transcriptSubstance() documents: "[object Object]" repeated is longer
 *    than real prose. `>=` matches the client's own reconcile in
 *    recoverInterruptedStream, so both paths resolve a tie the same way.
 *
 * 2b. A MERGED FRAGMENT NEVER DROPS A USER TURN — a separate rule, and not
 *    implied by (2). Substance is ONE number for the whole transcript, so it
 *    cannot tell a long conversation from one long answer: a 16KB interrupted
 *    answer scores higher than five short earlier turns and takes the row.
 *    Shape is therefore checked on its own, stored's user turns having to be a
 *    PREFIX of what is written — but only on the fragment path, because there
 *    the input is a guess about where a turn belongs. On the turn-end path the
 *    caller holds the authoritative history and a false refusal would freeze
 *    the sidebar, i.e. re-create the bug in (1)'s paragraph.
 *
 * 2c. A CALLER SAYS WHAT IT IS HANDING OVER — see `mode` on writeTranscript.
 *    A whole conversation and a single recovered turn are both "an array of
 *    messages", and nothing in the array says which one it is. Guessing is
 *    what made (2b) necessary.
 *
 * 3. EVERY OTHER COLUMN IS CARRIED OVER, NOT DEFAULTED.
 *    ContentOutputModel.createOrUpdate is a full-row upsert: workflow_id,
 *    tool_id, is_shareable and title are assigned from `excluded`, so passing
 *    a null for any of them WIPES it. title especially — that is where a
 *    user's rename lives, and a background write must never rename their
 *    conversation. (channel_key is COALESCEd by the model and so is sticky on
 *    its own; it is passed anyway rather than relying on that from a distance.)
 *
 * 4. IT CANNOT BREAK THE TURN.
 *    Fire-and-forget at the call site, and every path here resolves rather
 *    than throws. The turn is already finished and its answer is already in
 *    conversation_logs; a failure to mirror it into the sidebar is a log line,
 *    not an error the user should ever meet.
 */

import ContentOutputModel from '../../models/ContentOutputModel.js';
import { broadcastToUser, RealtimeEvents } from '../../utils/realtimeSync.js';
import { deriveTitle, serializeTranscript, transcriptSubstance } from './transcriptProjection.js';
import { serverMessagesToUi } from './chatStreamReducer.mirror.js';

/**
 * The messages the client has already saved, or [] when the column will not
 * parse.
 *
 * Treating unparseable content as empty is the right direction: it renders as
 * nothing at all, and there is no reading in which keeping it beats replacing
 * it. It also scores 0 substance, exactly as before.
 */
function parseStoredMessages(rawContent) {
  try {
    const parsed = JSON.parse(rawContent);
    return Array.isArray(parsed?.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

/**
 * The sequence of things the USER said — a conversation's skeleton.
 *
 * Assistant turns are legitimately rewritten on every pass: merged across
 * provider rows, compacted, re-projected. User turns are not. They are
 * therefore the one part of a transcript a write can be held against.
 */
function userTurnKeys(messages) {
  return (messages || [])
    .filter((m) => m && m.role === 'user' && typeof m.content === 'string')
    .map((m) => m.content.trim());
}

/**
 * May `incoming` replace `stored` without losing anything the user said?
 *
 * The never-shrink rule below compares SUBSTANCE, which is one number for the
 * whole transcript and therefore cannot tell "a longer conversation" from "one
 * longer answer". A 16KB interrupted answer outscores five short earlier turns
 * and takes the row — measured, not hypothesised. So substance alone is not
 * enough: the SHAPE has to hold too, and the invariant is that stored's user
 * turns are a PREFIX of incoming's.
 *
 * Exported because it is the invariant, not an implementation detail — a test
 * that cannot state it cannot defend it.
 */
export function preservesUserTurns(stored, incoming) {
  const before = userTurnKeys(stored);
  const after = userTurnKeys(incoming);
  if (before.length > after.length) return false;
  return before.every((key, i) => key === after[i]);
}

/**
 * Merge a recovered TURN into the transcript that is already saved.
 *
 * Recovery replays ONE turn out of a journal — the user's message and the
 * answer that was in flight when the process died. That is a fragment, not a
 * conversation, and a full-row write handed a fragment replaces everything
 * else with it.
 *
 * Returns null when there is nothing worth adding, i.e. the saved copy already
 * holds a better version of this same turn.
 */
export function mergeRecoveredTurn(stored, turn) {
  if (!Array.isArray(turn) || turn.length === 0) return null;

  const turnUser = turn.find((m) => m && m.role === 'user' && typeof m.content === 'string');
  // Answer-only journal — nothing to anchor on, so it can only be appended.
  if (!turnUser) return [...stored, ...turn];

  // Match on what the user said. The journal's own message id is minted during
  // recovery (`msg-user-recovered-<now>`) and so can never match a stored one.
  const key = turnUser.content.trim();
  let at = -1;
  for (let i = stored.length - 1; i >= 0; i--) {
    const m = stored[i];
    if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim() === key) {
      at = i;
      break;
    }
  }

  // The row never saw this turn — the client died before it autosaved.
  if (at === -1) return [...stored, ...turn];

  // The row has this turn already. Generation carried on after the client
  // stopped listening, so the journal's copy is normally the longer one — but
  // not always, and the TAIL is the only part the two disagree about, so the
  // tail is what gets compared.
  const storedTail = stored.slice(at);
  if (transcriptSubstance(turn) < transcriptSubstance(storedTail)) return null;
  return [...stored.slice(0, at), ...turn];
}

/**
 * Write UI messages into a conversation's saved row, under every rule above.
 *
 * Extracted so there is exactly ONE implementation of "how a transcript is
 * safely written", because there are now two callers with different inputs:
 * the end of a turn (provider messages) and journal recovery after a restart
 * (a reduced replay log). Two copies of the update-only / never-shrink /
 * carry-every-column reasoning would drift, and the failure mode of drift here
 * is silently deleting somebody's conversation.
 *
 * A caller must say WHICH of those two it is handing over, because they are
 * not interchangeable and the difference is invisible from the array alone.
 * Turn-end passes the whole conversation, which is always a superset of what
 * is stored. Recovery passes one turn. The never-shrink rule was derived for
 * the first case, and inheriting it silently for the second is what let a
 * fragment take the row.
 *
 * @param {object} args
 * @param {string} args.conversationId
 * @param {string} args.userId
 * @param {Array}  args.messages   UI-shaped messages, as the client renders them
 * @param {'whole'|'appendTurn'} [args.mode]
 *                                 'whole' — `messages` IS the conversation.
 *                                 'appendTurn' — `messages` is a single turn to
 *                                 be merged into what is already saved.
 * @param {string} [args.logTag]   prefix for log lines, so recovery is
 *                                 distinguishable from the normal path
 * @returns {Promise<{written: boolean, reason?: string, outputId?: string}>}
 */
export async function writeTranscript({ conversationId, userId, messages, mode = 'whole', logTag = 'TurnTranscript' } = {}) {
  if (!conversationId || !userId) return { written: false, reason: 'not_identified' };
  if (!Array.isArray(messages) || messages.length === 0) return { written: false, reason: 'empty_projection' };

  try {
    // The canonical row for this conversation (longest content wins — see
    // ContentOutputModel.findByConversationId). Content is needed here, not
    // just metadata, because the never-shrink rule compares against what it
    // actually says.
    const existing = await ContentOutputModel.findByConversationId(conversationId, userId);
    if (!existing) return { written: false, reason: 'no_saved_row' };
    if (existing.content_type !== 'conversation') return { written: false, reason: 'not_a_transcript' };

    const stored = parseStoredMessages(existing.content);

    // A fragment is merged onto what is already saved; a whole transcript
    // stands on its own.
    let incoming = messages;
    if (mode === 'appendTurn') {
      incoming = mergeRecoveredTurn(stored, messages);
      if (!incoming) return { written: false, reason: 'saved_copy_is_richer' };

      // Anchoring can still lose ground: when the journal's turn matches
      // part-way UP a conversation that has since moved on, everything after
      // the anchor is replaced by it. Reachable in practice — a journal whose
      // write throws is deliberately kept and retried on a LATER boot, by
      // which time the user may have carried on talking.
      //
      // Scoped to this path deliberately. In 'whole' mode the caller is the
      // turn itself, holding the authoritative history, and a false refusal
      // there would freeze the sidebar mid-answer — which is the very bug this
      // file exists to fix. A guard whose failure mode is the original bug does
      // not belong on that path.
      if (!preservesUserTurns(stored, incoming)) {
        return { written: false, reason: 'would_drop_user_turns' };
      }
    }

    // Existing title wins: deriving one here would rename a conversation the
    // user may have named themselves. Derived from the MERGED transcript, never
    // from a fragment — a title is the first thing the user said in the
    // conversation, not the first thing they said in the recovered turn.
    const title = existing.title || deriveTitle(incoming);

    if (transcriptSubstance(incoming) < transcriptSubstance(stored)) {
      return { written: false, reason: 'saved_copy_is_richer' };
    }

    await ContentOutputModel.createOrUpdate(
      existing.id,
      userId,
      existing.workflow_id,
      existing.tool_id,
      serializeTranscript({ conversationId, title, messages: incoming }),
      !!existing.is_shareable,
      'conversation',
      conversationId,
      title,
      { channelKey: existing.channel_key || null },
    );

    // Same event-carried-state contract as the HTTP save: hand back the row's
    // metadata so open clients patch this one row instead of refetching the
    // whole list. Without it, a tab that is open elsewhere shows the stale
    // preview until something else makes it refetch.
    try {
      const output = await ContentOutputModel.findMetaById(existing.id);
      broadcastToUser(userId, RealtimeEvents.CONTENT_UPDATED, {
        id: existing.id,
        title,
        contentType: 'conversation',
        userId,
        output,
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      // The row is already correct on disk; failing to announce it is not a
      // reason to report the write as failed.
      console.warn(`[${logTag}] Saved, but could not broadcast:`, broadcastError?.message || broadcastError);
    }

    return { written: true, outputId: existing.id };
  } catch (error) {
    console.warn(`[${logTag}] Could not persist ${conversationId}:`, error?.message || error);
    return { written: false, reason: 'error' };
  }
}

/**
 * Mirror the completed turn into the conversation's saved row.
 *
 * @param {object} args
 * @param {string} args.conversationId
 * @param {string} args.userId
 * @param {Array}  args.providerMessages  the sanitized provider history — the
 *                                        same array written to
 *                                        conversation_logs.full_history
 * @returns {Promise<{written: boolean, reason?: string, outputId?: string}>}
 *          Always resolves. `reason` names the skip, so the common no-ops are
 *          distinguishable from failures in a log.
 */
export async function persistTurnTranscript({ conversationId, userId, providerMessages } = {}) {
  if (!conversationId || !userId) return { written: false, reason: 'not_identified' };
  if (!Array.isArray(providerMessages) || providerMessages.length === 0) {
    return { written: false, reason: 'no_history' };
  }
  return writeTranscript({
    conversationId,
    userId,
    messages: serverMessagesToUi(providerMessages),
  });
}

export default persistTurnTranscript;
