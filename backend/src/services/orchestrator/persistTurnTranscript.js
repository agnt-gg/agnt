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
 * How much the client's already-saved copy actually says.
 *
 * A row whose content will not parse scores 0, so a good projection replaces
 * it. That is the right direction: unparseable content renders as nothing at
 * all, and there is no reading in which keeping it beats replacing it.
 */
function storedSubstance(rawContent) {
  try {
    const parsed = JSON.parse(rawContent);
    return transcriptSubstance(Array.isArray(parsed?.messages) ? parsed.messages : []);
  } catch {
    return 0;
  }
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
 * @param {object} args
 * @param {string} args.conversationId
 * @param {string} args.userId
 * @param {Array}  args.messages   UI-shaped messages, as the client renders them
 * @param {string} [args.logTag]   prefix for log lines, so recovery is
 *                                 distinguishable from the normal path
 * @returns {Promise<{written: boolean, reason?: string, outputId?: string}>}
 */
export async function writeTranscript({ conversationId, userId, messages, logTag = 'TurnTranscript' } = {}) {
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

    // Existing title wins: deriving one here would rename a conversation the
    // user may have named themselves.
    const title = existing.title || deriveTitle(messages);

    if (transcriptSubstance(messages) < storedSubstance(existing.content)) {
      return { written: false, reason: 'saved_copy_is_richer' };
    }

    await ContentOutputModel.createOrUpdate(
      existing.id,
      userId,
      existing.workflow_id,
      existing.tool_id,
      serializeTranscript({ conversationId, title, messages }),
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
