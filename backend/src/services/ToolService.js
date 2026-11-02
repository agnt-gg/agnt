import CustomToolModel from '../models/CustomToolModel.js';
import generateUUID from '../utils/generateUUID.js';

class CustomToolService {
  healthCheck(req, res) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.status(200).json({ status: 'OK' });
  }

  async saveOrUpdateCustomTool(req, res) {
    try {
      const { tool } = req.body || {};
      const userId = req.user.userId;

      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        return res.status(400).json({
          error: 'Request body must be { tool: { ... } } with a tool object.',
        });
      }

      // title, category, type, icon, description, parameters and outputs are NOT NULL in the tools table: a
      // definition missing one crashed in SQLite (500, reported to the agent as "Invalid JSON"). Fill what has an
      // obvious default; a tool still needs a name.
      tool.title = typeof tool.title === 'string' && tool.title.trim() ? tool.title.trim() : (typeof tool.name === 'string' ? tool.name.trim() : '');
      if (!tool.title) return res.status(400).json({ error: 'tool.title (or tool.name) is required.' });
      tool.type = typeof tool.type === 'string' && tool.type.trim() ? tool.type.trim() : tool.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-tool';
      tool.category = tool.category || 'custom';
      tool.icon = tool.icon || 'custom';
      tool.description = typeof tool.description === 'string' ? tool.description : '';
      if (!tool.parameters || typeof tool.parameters !== 'object') tool.parameters = {};
      if (!tool.outputs || typeof tool.outputs !== 'object') tool.outputs = {};

      console.log('Received tool data:', tool);

      // If the tool doesn't exist, create a new tool
      const existingTool = tool.id ? await CustomToolModel.findOne(tool.id) : null;
      let isNewTool = !existingTool;

      if (isNewTool) {
        tool.id = generateUUID(); // Generate a new UUID for the new tool
      } else if (existingTool.created_by !== userId) {
        // If the user is not the creator, create a new tool with a new ID
        tool.id = generateUUID();
        isNewTool = true;
      }

      const result = await CustomToolModel.createOrUpdate(tool.id, tool, userId);
      res.status(200).json({
        message: isNewTool ? 'New custom tool created' : 'Custom tool updated',
        toolId: tool.id,
      });
    } catch (error) {
      console.error('Error saving/updating custom tool:', error);
      res.status(500).json({ error: 'Failed to save/update custom tool', details: error.message });
    }
  }
  async getAllCustomTools(req, res) {
    try {
      const userId = req.user.userId;
      const tools = await CustomToolModel.findAllByUserId(userId);
      res.json({ tools });
    } catch (error) {
      console.error('Error retrieving custom tools:', error);
      res.status(500).json({ error: 'Error retrieving custom tools' });
    }
  }
  async getCustomTool(req, res) {
    try {
      const { id } = req.params;
      const tool = await CustomToolModel.findOne(id);

      if (!tool) {
        return res.status(404).json({ error: 'Custom tool not found' });
      }

      if (tool.is_shareable || tool.created_by === req.user.userId) {
        res.json(tool);
      } else {
        res.status(403).json({ error: 'You do not have permission to view this tool' });
      }
    } catch (error) {
      console.error('Error retrieving custom tool:', error);
      res.status(500).json({ error: 'Error retrieving custom tool' });
    }
  }
  async deleteCustomTool(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const result = await CustomToolModel.delete(id, userId);
      if (result === 0) {
        return res.status(404).json({ error: 'Custom tool not found' });
      }
      res.json({ message: `Custom tool ${id} deleted successfully.` });
    } catch (error) {
      console.error('Error deleting custom tool:', error);
      res.status(500).json({ error: 'Failed to delete custom tool', details: error.message });
    }
  }
}

console.log(`Custom Tool Service Started...`);

export default new CustomToolService();
