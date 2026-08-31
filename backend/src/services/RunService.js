import ContentOutputModel from '../models/ContentOutputModel.js';
import ExecutionModel from '../models/ExecutionModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';
import generateUUID from '../utils/generateUUID.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import { serializeParticipants } from '../utils/transcriptParticipants.js';

/**
 * How many messages an INCOMING conversation payload carries.
 *
 * Returns null for "I cannot tell" — not a number. Every caller must treat
 * null as unknown and decline to judge, because the one thing worse than
 * failing to spot a truncation is inventing a count of 0 for a payload we
 * merely failed to parse and calling every save a truncation.
 *
 * The payload is the serializeTranscript() shape: an object with `messages`.
 * A bare array is accepted too — older clients sent that, and refusing to
 * count a shape we can plainly see would leave those saves unguarded.
 */
function countTranscriptMessages(content) {
  if (typeof content !== 'string' || content.length === 0) return null;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && Array.isArray(parsed.messages)) return parsed.messages.length;
    return null;
  } catch {
    return null;
  }
}

class RunService {
  // Health check method
  healthCheck(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.status(200).json({ status: 'OK' });
  }

  // Content Output Methods
  async getAllContentOutputs(req, res) {
    try {
      const userId = req.user.userId;
      const limit = req.query.limit ? parseInt(req.query.limit) : null;
      const offset = req.query.offset ? parseInt(req.query.offset) : null;
      const groupId = req.query.group_id || undefined;

      const result = await ContentOutputModel.findAllByUserId(userId, limit, offset, groupId);

      // Handle both old format (array) and new format (object with outputs and totalCount)
      if (Array.isArray(result)) {
        res.json({ outputs: result, totalCount: result.length });
      } else {
        res.json({ outputs: result.outputs, totalCount: result.totalCount });
      }
    } catch (error) {
      console.error('Error retrieving all content outputs:', error);
      res.status(500).json({ error: 'Error retrieving all content outputs' });
    }
  }
  async getContentOutput(req, res) {
    try {
      const { id } = req.params;
      const output = await ContentOutputModel.findOne(id);

      if (!output) {
        return res.status(404).json({ error: 'Content output not found' });
      }

      // Check if the content is shareable or if the user is the owner
      if (output.is_shareable || output.user_id === req.user.userId) {
        res.json(output);
      } else {
        res.status(403).json({ error: 'You do not have permission to view this content' });
      }
    } catch (error) {
      console.error('Error retrieving content output:', error);
      res.status(500).json({ error: 'Error retrieving content output' });
    }
  }
  async saveOrUpdateContentOutput(req, res) {
    try {
      // Saves never mark read — the read watermark moves only via the
      // explicit read PATCH (the email model). See ContentOutputModel.
      const { id, content, workflowId, toolId, isShareable, contentType, conversationId, title, channelKey, allowTruncate } = req.body;
      const userId = req.user.userId;

      // WHICH ROW DOES THIS SAVE BELONG TO?
      //
      // Identity was the output `id` alone. That id is minted on a
      // conversation's FIRST save and then remembered in the saving tab's
      // memory (`savedOutputId` in the chat store) — nowhere else. A second
      // browser, or the Mac app, holding the same conversation has no id to
      // send, so this method saw `id: undefined`, concluded "new", and minted
      // another row. Same conversation, three clients, three sidebar entries.
      //
      // A conversation is the durable identity here, so it is what we key on:
      // when the caller names a conversation but no row, adopt the row that
      // conversation already has. `conversationId` is set only for chat
      // transcripts, so nothing else changes behaviour.
      //
      // Identity lookups only — neither read the content column (see
      // ContentOutputModel.findIdentityById).
      let existingOutput = id ? await ContentOutputModel.findIdentityById(id) : null;
      let adoptedByConversation = false;

      // Ownership is checked BEFORE adopting: a row belonging to someone else
      // is not a row we may write to, and falling through to the conversation
      // lookup with another user's id would be a second chance to get that
      // wrong. Scoped by userId, so it can only ever adopt the caller's row.
      if (existingOutput && existingOutput.user_id !== userId) existingOutput = null;
      else if (!existingOutput && conversationId) {
        existingOutput = await ContentOutputModel.findMetaByConversationId(conversationId, userId);
        // Remember HOW we found it. Adoption is the dangerous provenance:
        // see the truncation guard below.
        if (existingOutput) adoptedByConversation = true;
      }

      const isNewOutput = !existingOutput;
      const outputId = isNewOutput ? generateUUID() : existingOutput.id;

      // ── BLIND-ADOPT TRUNCATION GUARD ──────────────────────────────────
      //
      // THE INCIDENT THIS PREVENTS (measured, 2026-08-14): a 404-message
      // conversation was replaced on disk by a 4-message one. The user
      // reloaded and his afternoon's work was gone from the UI.
      //
      // The mechanism is adoption above, which is otherwise correct — keying
      // on the conversation is what stopped three clients minting three
      // sidebar rows for one chat. But it hands WRITE access to a row the
      // caller has never READ. A client that reloads with an empty transcript
      // still knows its conversationId, so its first autosave adopts the full
      // row and overwrites it with whatever little it happens to hold.
      //
      // Naming the row by `id` is the client's proof it loaded that row:
      // savedOutputId is only ever set by a save it made or a load it did.
      // So the rule is narrow and mechanical:
      //
      //     a caller that did NOT name the row may not SHRINK it.
      //
      // Shrinking on purpose (clearing, editing an earlier message and
      // re-running from there) is still allowed — those callers hold the id,
      // and anything else can pass allowTruncate explicitly.
      //
      // Unknown counts (non-JSON content, legacy rows) do NOT trigger the
      // guard: it must never block a save it cannot actually reason about.
      if (adoptedByConversation && !allowTruncate && contentType === 'conversation') {
        const stored = await ContentOutputModel.transcriptStatsById(outputId);
        const incoming = countTranscriptMessages(content);

        if (stored && stored.messageCount !== null && incoming !== null && incoming < stored.messageCount) {
          console.error(
            `[ContentOutput] REFUSED a truncating blind write to ${outputId} `
            + `(conversation ${conversationId}): stored ${stored.messageCount} messages, `
            + `incoming ${incoming}. The caller never loaded this row. Content left intact.`
          );
          // 409, not 500: the request is well-formed, the state says no. The
          // stored row is returned so the client can reconcile to the truth
          // instead of retrying the same destructive write forever.
          return res.status(409).json({
            error: 'transcript_truncation_refused',
            message:
              'This save would have shortened a conversation the client has not loaded. '
              + 'The stored transcript was kept. Reload the conversation before saving it.',
            id: outputId,
            storedMessageCount: stored.messageCount,
            incomingMessageCount: incoming,
            output: await ContentOutputModel.findMetaById(outputId),
          });
        }
      }

      // WHO IS IN THIS CONVERSATION, derived from the transcript we are about
      // to store rather than accepted from the client. The sidebar needs a
      // roster to draw avatars against, and it cannot read the transcript —
      // the list query excludes `content` because rows average ~0.5MB. This
      // is the same JSON.parse the truncation guard above performs, so the
      // roster cannot describe a different transcript than the one saved.
      //
      // Only conversations have a roster. An HTML artifact has no messages,
      // and the deriver returning null for it means COALESCE leaves the
      // column untouched — see ContentOutputModel.createOrUpdate.
      const participants = contentType === 'conversation' ? serializeParticipants(content) : null;

      await ContentOutputModel.createOrUpdate(
        outputId,
        userId,
        workflowId,
        toolId,
        content,
        isShareable,
        contentType || 'html',
        conversationId || null,
        title || null,
        { channelKey: channelKey || null, participants }
      );

      // The row's list metadata (no content column) rides on BOTH the
      // response and the broadcast. Event-carried state: clients patch this
      // one row in place instead of refetching the whole list. Before this, a
      // streaming conversation's ~5s autosaves each triggered full-list
      // refetches in every tab — with a long history that is a constant
      // refetch storm, and it is what made OTHER conversations slow to open
      // while agents were running.
      const output = await ContentOutputModel.findMetaById(outputId);

      broadcastToUser(userId, isNewOutput ? RealtimeEvents.CONTENT_CREATED : RealtimeEvents.CONTENT_UPDATED, {
        id: outputId,
        title: title,
        contentType: contentType || 'html',
        userId: userId,
        output,
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: isNewOutput ? 'New content output created' : 'Content output updated',
        id: outputId,
        output,
      });
    } catch (error) {
      console.error('Error saving/updating content output:', error);
      res.status(500).json({ error: 'Error saving/updating content output' });
    }
  }
  async getContentOutputsByWorkflow(req, res) {
    try {
      const { workflowId } = req.params;
      const userId = req.user.userId;
      const outputs = await ContentOutputModel.findByWorkflowId(workflowId, userId);
      res.json({ outputs });
    } catch (error) {
      console.error('Error retrieving content outputs:', error);
      res.status(500).json({ error: 'Error retrieving content outputs' });
    }
  }
  /**
   * Find the saved transcript for a conversation.
   *
   * ContentOutputModel.findByConversationId existed but no route reached it,
   * so a client that knew its conversationId had no way to ask for the
   * transcript it had saved. Only the workspace/unified chats need this: the
   * main chat opens conversations from the sidebar list and already holds the
   * output id. They persisted to localStorage instead and rebuilt themselves
   * from the raw provider log, which is not a UI transcript and cost two
   * user-visible rendering bugs before this route existed.
   *
   * 404 (not 500) when nothing is saved yet: "this conversation has no saved
   * transcript" is a normal answer, and the caller falls back to the log.
   */
  /**
   * Assign a saved row to the chat channel that owns it.
   *
   * PATCH rather than a re-save: the only thing changing is ownership, and a
   * re-save would ship the whole transcript back (megabytes, per row) purely
   * to write one string. Used by the client's one-time repair sweep for rows
   * written before channel scope existed.
   */
  async setContentOutputChannel(req, res) {
    try {
      const { id } = req.params;
      const { channelKey } = req.body;
      const userId = req.user.userId || req.user.id;

      if (channelKey !== null && typeof channelKey !== 'string') {
        return res.status(400).json({ error: 'channelKey must be a string or null' });
      }

      const changes = await ContentOutputModel.setChannelKey(id, userId, channelKey || null);
      if (changes === 0) {
        // Not found OR not theirs — indistinguishable on purpose.
        return res.status(404).json({ error: 'Content output not found' });
      }
      res.json({ id, channelKey: channelKey || null });
    } catch (error) {
      console.error('Error setting content output channel:', error);
      res.status(500).json({ error: 'Error setting content output channel' });
    }
  }
  async getContentOutputByConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId || req.user.id;
      if (!conversationId) {
        return res.status(400).json({ error: 'conversationId is required' });
      }
      const output = await ContentOutputModel.findByConversationId(conversationId, userId);
      if (!output) {
        return res.status(404).json({ error: 'No saved transcript for this conversation' });
      }
      res.json(output);
    } catch (error) {
      console.error('Error retrieving content output by conversation:', error);
      res.status(500).json({ error: 'Error retrieving content output' });
    }
  }
  async getContentOutputsByTool(req, res) {
    try {
      const { toolId } = req.params;
      const userId = req.user.userId;
      const outputs = await ContentOutputModel.findByToolId(toolId, userId);
      res.json({ outputs });
    } catch (error) {
      console.error('Error retrieving content outputs:', error);
      res.status(500).json({ error: 'Error retrieving content outputs' });
    }
  }
  async deleteContentOutput(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const result = await ContentOutputModel.delete(id, userId);
      if (result === 0) {
        return res.status(404).json({ error: 'Content output not found' });
      }

      // Broadcast real-time deletion to user's connected clients (all tabs)
      broadcastToUser(userId, RealtimeEvents.CONTENT_DELETED, {
        id: id,
        userId: userId,
        timestamp: new Date().toISOString(),
      });

      res.json({ message: `Content output ${id} deleted successfully.` });
    } catch (error) {
      console.error('Error deleting content output:', error);
      res.status(500).json({
        error: 'Failed to delete content output',
        details: error.message,
      });
    }
  }
  async renameContentOutput(req, res) {
    try {
      const { id } = req.params;
      const { title } = req.body;
      const userId = req.user.userId;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Valid title is required' });
      }

      // Verify the output exists and belongs to the user
      const output = await ContentOutputModel.findOne(id);
      if (!output) {
        return res.status(404).json({ error: 'Content output not found' });
      }
      if (output.user_id !== userId) {
        return res.status(403).json({ error: 'You do not have permission to rename this output' });
      }

      const result = await ContentOutputModel.updateTitle(id, userId, title.trim());
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Content output not found' });
      }

      res.json({
        success: true,
        message: 'Content output renamed successfully',
        id: id,
        title: title.trim(),
      });
    } catch (error) {
      console.error('Error renaming content output:', error);
      res.status(500).json({
        error: 'Failed to rename content output',
        details: error.message,
      });
    }
  }

  /**
   * PATCH /content-outputs/:id/read  { read: boolean }
   * Sets or clears the read watermark (last_read_at). Unread is derived
   * client-side as updated_at > last_read_at, so this is the only write the
   * "mark read / mark unread" flows ever need.
   *
   * Marking UNREAD also moves updated_at — see ContentOutputModel.setReadState.
   * That makes the response/broadcast row genuinely worth carrying: two
   * columns changed, and every other tab needs both to sort the conversation
   * where its owner just put it.
   */
  async setContentOutputReadState(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const read = req.body?.read;

      if (typeof read !== 'boolean') {
        return res.status(400).json({ error: 'Body must include { read: boolean }' });
      }

      const result = await ContentOutputModel.setReadState(id, userId, read);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Content output not found' });
      }

      // Carry the changed row so the user's other devices/tabs merge it in
      // place. Without `output` the client falls back to refetching the ENTIRE
      // list, and this endpoint fires on every conversation OPEN — that
      // fallback would put a full-history fetch behind every click.
      const output = await ContentOutputModel.findMetaById(id);

      broadcastToUser(userId, RealtimeEvents.CONTENT_UPDATED, {
        id,
        userId,
        readState: read,
        output,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, id, read, output });
    } catch (error) {
      console.error('Error setting content output read state:', error);
      res.status(500).json({ error: 'Failed to set read state' });
    }
  }

  /**
   * PATCH /content-outputs/read-all  { ids?: string[] }
   * Clears the unread state of many conversations in one write — the
   * "mark everything in the Needs-you rail as read" button.
   *
   * `ids` scopes the clear to exactly what the user was looking at; omitting
   * it clears every unread conversation they own. An empty array is honoured
   * as "nothing", never widened to "everything".
   */
  async markAllContentOutputsRead(req, res) {
    try {
      const userId = req.user.userId;
      const ids = req.body?.ids;

      if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) {
        return res.status(400).json({ error: 'Body ids must be an array of strings when provided' });
      }

      const result = await ContentOutputModel.markAllRead(userId, ids === undefined ? null : ids);

      // No 404: clearing an already-clear rail is a success, not an error.
      broadcastToUser(userId, RealtimeEvents.CONTENT_UPDATED, {
        userId,
        readState: true,
        ids: ids === undefined ? null : ids,
        cleared: result.changes,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, cleared: result.changes });
    } catch (error) {
      console.error('Error marking content outputs read:', error);
      res.status(500).json({ error: 'Failed to mark conversations read' });
    }
  }

  /**
   * PATCH /content-outputs/:id/archive  { archived: boolean }
   * Archives the conversation out of the main sidebar list (or restores it).
   * updated_at is intentionally untouched so unarchiving restores position.
   */
  async setContentOutputArchived(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const archived = req.body?.archived;

      if (typeof archived !== 'boolean') {
        return res.status(400).json({ error: 'Body must include { archived: boolean }' });
      }

      const result = await ContentOutputModel.setArchived(id, userId, archived);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Content output not found' });
      }

      broadcastToUser(userId, RealtimeEvents.CONTENT_UPDATED, {
        id,
        userId,
        archived,
        timestamp: new Date().toISOString(),
      });

      res.json({ success: true, id, archived });
    } catch (error) {
      console.error('Error setting content output archived state:', error);
      res.status(500).json({ error: 'Failed to set archived state' });
    }
  }

  // Execution Methods
  async getExecutions(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const dateRange = startDate && endDate ? { startDate, endDate } : {};
      const executions = await ExecutionModel.getExecutions(req.user.userId, dateRange);
      res.json(executions);
    } catch (error) {
      console.error('Error fetching executions:', error);
      res.status(500).json({ error: 'Error fetching executions' });
    }
  }
  async getExecutionDetails(req, res) {
    try {
      const execution = await ExecutionModel.getExecutionDetails(req.params.id);
      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }
      res.json(execution);
    } catch (error) {
      console.error('Error fetching execution details:', error);
      res.status(500).json({ error: 'Error fetching execution details' });
    }
  }
  async getAgentActivityData(req, res) {
    try {
      const { startDate, endDate } = req.body;
      const userId = req.user.id;
      const activityData = await ExecutionModel.getAgentActivityData(userId, startDate, endDate);
      res.json(activityData);
    } catch (error) {
      console.error('Error in getAgentActivityData:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // The activity streak is deliberately its own endpoint rather than a field on
  // /activity: it spans all of history, so it must not inherit that route's
  // date window. A failure here degrades to "no streak" rather than 500 — the
  // badge is decoration on a dashboard, and must never take the page with it.
  async getActivityStreak(req, res) {
    try {
      const streak = await ExecutionModel.getActivityStreak(req.user.id);
      res.json(streak);
    } catch (error) {
      console.error('Error in getActivityStreak:', error);
      res.json({ streak: 0, lastActiveDate: null, asOf: null, error: true });
    }
  }

  // Agent Execution Methods
  async getAgentExecutions(req, res) {
    try {
      const userId = req.user.userId || req.user.id;
      const { startDate, endDate } = req.query;
      const dateRange = startDate && endDate ? { startDate, endDate } : {};
      const executions = await AgentExecutionModel.getExecutions(userId, dateRange);
      res.json(executions);
    } catch (error) {
      console.error('Error fetching agent executions:', error);
      res.status(500).json({ error: 'Error fetching agent executions' });
    }
  }

  async getAgentExecutionDetails(req, res) {
    try {
      const execution = await AgentExecutionModel.getExecutionDetails(req.params.id);
      if (!execution) {
        return res.status(404).json({ error: 'Agent execution not found' });
      }
      res.json(execution);
    } catch (error) {
      console.error('Error fetching agent execution details:', error);
      res.status(500).json({ error: 'Error fetching agent execution details' });
    }
  }

  async deleteAgentExecution(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId || req.user.id;
      const result = await AgentExecutionModel.delete(id, userId);
      if (result === 0) {
        return res.status(404).json({ error: 'Agent execution not found' });
      }
      res.json({ message: `Agent execution ${id} deleted successfully.` });
    } catch (error) {
      console.error('Error deleting agent execution:', error);
      res.status(500).json({
        error: 'Failed to delete agent execution',
        details: error.message,
      });
    }
  }

  async getConversationSummary(req, res) {
    try {
      const userId = req.user.userId || req.user.id;
      const { conversationId } = req.params;
      if (!conversationId) {
        return res.status(400).json({ error: 'conversationId is required' });
      }
      const summary = await AgentExecutionModel.getConversationSummary(conversationId, userId);
      if (!summary) {
        return res.json({ conversationId, executionsCount: 0, cumulative: null, latest: null });
      }
      res.json(summary);
    } catch (error) {
      console.error('Error fetching conversation summary:', error);
      res.status(500).json({ error: 'Error fetching conversation summary' });
    }
  }

  async clearCompletedAgentExecutions(req, res) {
    try {
      const userId = req.user.userId || req.user.id;
      const count = await AgentExecutionModel.clearCompleted(userId);
      res.json({ message: `Cleared ${count} completed agent execution(s).`, count });
    } catch (error) {
      console.error('Error clearing completed agent executions:', error);
      res.status(500).json({ error: 'Error clearing completed agent executions' });
    }
  }
}

console.log(`Run Service Started...`);

export default new RunService();
