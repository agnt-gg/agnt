import express from 'express';
import CustomOpenAIProviderService from '../services/ai/CustomOpenAIProviderService.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

/**
 * Helper function to extract user ID from auth token
 */
function getUserIdFromToken(req) {
  const authToken = req.headers.authorization;
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authToken.split(' ')[1];
    const payload = jwt.decode(token);
    return payload?.id || payload?.userId || payload?.sub;
  } catch (e) {
    return null;
  }
}

/**
 * GET /custom-providers
 * Get all custom providers for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const providers = await CustomOpenAIProviderService.getProvidersByUserId(userId);

    res.json({
      success: true,
      providers,
      count: providers.length,
    });
  } catch (error) {
    console.error('Error fetching custom providers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch custom providers',
      details: error.message,
    });
  }
});

/**
 * POST /custom-providers
 * Create a new custom provider
 */
router.post('/', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { provider_name, base_url, api_key } = req.body;

    if (!provider_name || !base_url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: provider_name, base_url',
      });
    }

    const provider = await CustomOpenAIProviderService.createProvider(userId, {
      provider_name,
      base_url,
      api_key,
    });

    res.status(201).json({
      success: true,
      provider,
      message: 'Custom provider created successfully',
    });
  } catch (error) {
    console.error('Error creating custom provider:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create custom provider',
      details: error.message,
    });
  }
});

/**
 * GET /custom-providers/:id
 * Get a specific custom provider
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { id } = req.params;
    const provider = await CustomOpenAIProviderService.getProviderById(id, userId);

    if (!provider) {
      return res.status(404).json({
        success: false,
        error: 'Provider not found',
      });
    }

    res.json({
      success: true,
      provider,
    });
  } catch (error) {
    console.error('Error fetching custom provider:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch custom provider',
      details: error.message,
    });
  }
});

/**
 * PUT /custom-providers/:id
 * Update a custom provider
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { id } = req.params;
    const updates = req.body;

    const provider = await CustomOpenAIProviderService.updateProvider(id, userId, updates);

    res.json({
      success: true,
      provider,
      message: 'Custom provider updated successfully',
    });
  } catch (error) {
    console.error('Error updating custom provider:', error);
    const statusCode = error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to update custom provider',
      details: error.message,
    });
  }
});

/**
 * DELETE /custom-providers/:id
 * Delete a custom provider
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { id } = req.params;
    await CustomOpenAIProviderService.deleteProvider(id, userId);

    res.json({
      success: true,
      message: 'Custom provider deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting custom provider:', error);
    const statusCode = error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to delete custom provider',
      details: error.message,
    });
  }
});

/**
 * POST /custom-providers/test
 * Test connection to a custom provider (without saving)
 */
router.post('/test', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { base_url, api_key } = req.body;

    if (!base_url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: base_url',
      });
    }

    const result = await CustomOpenAIProviderService.testConnection(base_url, api_key);

    res.json({
      success: result.success,
      ...result,
    });
  } catch (error) {
    console.error('Error testing custom provider connection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test connection',
      details: error.message,
    });
  }
});

/**
 * GET /custom-providers/:id/models
 * Fetch available models from a custom provider
 */
router.get('/:id/models', async (req, res) => {
  try {
    const userId = getUserIdFromToken(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { id } = req.params;
    const models = await CustomOpenAIProviderService.fetchModels(id, userId);

    res.json({
      success: true,
      models,
      count: models.length,
    });
  } catch (error) {
    console.error('Error fetching models from custom provider:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch models',
      details: error.message,
    });
  }
});

export default router;
