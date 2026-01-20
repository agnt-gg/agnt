import express from 'express';
import ToolRegistry from '../tools/ToolRegistry.js';

const router = express.Router();

// Initialize the registry
const toolRegistry = ToolRegistry.getInstance();

// Middleware to ensure registry is initialized
router.use(async (req, res, next) => {
  try {
    if (!toolRegistry.initialized) {
      await toolRegistry.initialize();
    }
    next();
  } catch (error) {
    console.error('Error initializing ToolRegistry:', error);
    res.status(500).json({ error: 'Failed to initialize tool registry' });
  }
});

// Get all tool schemas organized by category
router.get('/schemas', async (req, res) => {
  try {
    const schemas = toolRegistry.getAllSchemas();
    res.json(schemas);
  } catch (error) {
    console.error('Error fetching tool schemas:', error);
    res.status(500).json({ error: 'Failed to fetch tool schemas' });
  }
});

// Get schema for a specific tool
router.get('/schemas/:toolType', async (req, res) => {
  try {
    const { toolType } = req.params;
    const schema = toolRegistry.getSchema(toolType);

    if (!schema) {
      return res.status(404).json({ error: `Schema not found for tool: ${toolType}` });
    }

    res.json(schema);
  } catch (error) {
    console.error(`Error fetching schema for ${req.params.toolType}:`, error);
    res.status(500).json({ error: 'Failed to fetch tool schema' });
  }
});

// Get schemas by category
router.get('/schemas/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const schemas = toolRegistry.getSchemasByCategory(category);
    res.json(schemas);
  } catch (error) {
    console.error(`Error fetching schemas for category ${req.params.category}:`, error);
    res.status(500).json({ error: 'Failed to fetch schemas by category' });
  }
});

// Get registry statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = toolRegistry.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching registry stats:', error);
    res.status(500).json({ error: 'Failed to fetch registry statistics' });
  }
});

// Get metadata for a specific tool (includes source info)
router.get('/metadata/:toolType', async (req, res) => {
  try {
    const { toolType } = req.params;
    const metadata = toolRegistry.getSchemaMetadata(toolType);

    if (!metadata) {
      return res.status(404).json({ error: `Metadata not found for tool: ${toolType}` });
    }

    res.json(metadata);
  } catch (error) {
    console.error(`Error fetching metadata for ${req.params.toolType}:`, error);
    res.status(500).json({ error: 'Failed to fetch tool metadata' });
  }
});

// Reload the registry (useful for development)
router.post('/reload', async (req, res) => {
  try {
    await toolRegistry.reload();
    const stats = toolRegistry.getStats();
    res.json({
      success: true,
      message: 'Tool registry reloaded successfully',
      stats,
    });
  } catch (error) {
    console.error('Error reloading registry:', error);
    res.status(500).json({ error: 'Failed to reload tool registry' });
  }
});

export default router;
