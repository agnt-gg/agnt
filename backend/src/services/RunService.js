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

      const result = await ContentOutputModel.findAllByUserId(userId, limit, offset);

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
      const { id, content, workflowId, toolId, isShareable, contentType, conversationId, title } = req.body;
      const userId = req.user.userId;

      // Check if the output already exists
      const existingOutput = id ? await ContentOutputModel.findOne(id) : null;
      let isNewOutput = !existingOutput;

      let outputId;
      if (isNewOutput) {
        outputId = generateUUID(); // Generate a new UUID for the new output
      } else if (existingOutput.user_id !== userId) {
        // If the user is not the creator, create a new output with a new ID
        outputId = generateUUID();
        isNewOutput = true;
      } else {
        outputId = id; // Use the existing ID
      }

      await ContentOutputModel.createOrUpdate(
        outputId,
        userId,
        workflowId,
        toolId,
        content,
        isShareable,
        contentType || 'html',
        conversationId || null,
        title || null
      );

      // Broadcast real-time update to user's connected clients (all tabs)
      broadcastToUser(userId, isNewOutput ? RealtimeEvents.CONTENT_CREATED : RealtimeEvents.CONTENT_UPDATED, {
        id: outputId,
        title: title,
        contentType: contentType || 'html',
        userId: userId,
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: isNewOutput ? 'New content output created' : 'Content output updated',
        id: outputId,
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

  // Execution Methods
  async getExecutions(req, res) {
    try {
      const executions = await ExecutionModel.getExecutions(req.user.userId);
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
    console.log('getAgentActivityData called');
    try {
      const { startDate, endDate } = req.body;
      const userId = req.user.id;

      console.log('Fetching data for user:', userId, 'from', startDate, 'to', endDate);

      const activityData = await ExecutionModel.getAgentActivityData(userId, startDate, endDate);
      console.log('Activity data:', activityData);
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
      const executions = await AgentExecutionModel.getExecutions(userId);
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
