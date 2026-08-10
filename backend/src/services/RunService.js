import ContentOutputModel from '../models/ContentOutputModel.js';
import ExecutionModel from '../models/ExecutionModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';
import generateUUID from '../utils/generateUUID.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';

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
      const { id, content, workflowId, toolId, isShareable, contentType, conversationId, title, channelKey } = req.body;
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

      // Ownership is checked BEFORE adopting: a row belonging to someone else
      // is not a row we may write to, and falling through to the conversation
      // lookup with another user's id would be a second chance to get that
      // wrong. Scoped by userId, so it can only ever adopt the caller's row.
      if (existingOutput && existingOutput.user_id !== userId) existingOutput = null;
      else if (!existingOutput && conversationId) {
        existingOutput = await ContentOutputModel.findMetaByConversationId(conversationId, userId);
      }

      const isNewOutput = !existingOutput;
      const outputId = isNewOutput ? generateUUID() : existingOutput.id;

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
        { channelKey: channelKey || null }
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
