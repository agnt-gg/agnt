import express from 'express';
import LocalApiKeyManager from '../services/auth/LocalApiKeyManager.js';
import { authenticateToken } from './Middleware.js';

const router = express.Router();

const PROVIDER_ID = 'kimi-code';
const BASE_URL = 'https://api.kimi.com/coding/v1';
const DEFAULT_MODEL = 'kimi-for-coding';

router.use(authenticateToken);

router.get('/status', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.json({
        success: false,
        connected: false,
        provider: PROVIDER_ID,
        message: 'Authentication required to check Kimi Code status.',
      });
    }

    const connected = await LocalApiKeyManager.hasApiKey(userId, PROVIDER_ID);
    return res.json({
      success: true,
      connected,
      provider: PROVIDER_ID,
      baseUrl: BASE_URL,
      defaultModel: DEFAULT_MODEL,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[KimiCodeRoutes] Status check failed:', error);
    return res.status(500).json({
      success: false,
      connected: false,
      provider: PROVIDER_ID,
      message: error.message || 'Failed to check Kimi Code status.',
    });
  }
});

router.post('/apikey', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const apiKey = req.body?.apiKey;
    if (!apiKey || !String(apiKey).trim()) {
      return res.status(400).json({ success: false, error: 'API key is required.' });
    }

    await LocalApiKeyManager.saveApiKey(userId, PROVIDER_ID, apiKey);
    return res.json({ success: true });
  } catch (error) {
    console.error('[KimiCodeRoutes] Failed to save API key:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save Kimi Code API key.',
    });
  }
});

router.delete('/apikey', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    await LocalApiKeyManager.deleteApiKey(userId, PROVIDER_ID);
    return res.json({ success: true });
  } catch (error) {
    console.error('[KimiCodeRoutes] Failed to delete API key:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete Kimi Code API key.',
    });
  }
});

export default router;
