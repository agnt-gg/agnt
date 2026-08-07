import express from 'express';
import WebhookModel from '../models/WebhookModel.js';
import { authenticateToken } from './Middleware.js';

const WebhookRoutes = express.Router();

// Get all webhooks for the authenticated user
WebhookRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const webhooks = await WebhookModel.findByUserId(userId);
    res.json({ success: true, webhooks });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch webhooks' });
  }
});

// Get webhook by workflow ID
WebhookRoutes.get('/workflow/:workflowId', authenticateToken, async (req, res) => {
  try {
    const { workflowId } = req.params;
    // Scoped to the caller: a bare workflow id is a guessable handle.
    const webhook = await WebhookModel.findByWorkflowId(workflowId, req.user.id);

    if (!webhook) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    res.json({ success: true, webhook });
  } catch (error) {
    console.error('Error fetching webhook:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch webhook' });
  }
});

// Delete webhook by workflow ID
WebhookRoutes.delete('/workflow/:workflowId', authenticateToken, async (req, res) => {
  try {
    const { workflowId } = req.params;
    // Returns { deleted: false } — and therefore a 404 — when the row exists but
    // belongs to somebody else, so ids cannot be enumerated through this route.
    const result = await WebhookModel.deleteByWorkflowId(workflowId, req.user.id);

    if (!result.deleted) {
      return res.status(404).json({ success: false, error: 'Webhook not found' });
    }

    res.json({ success: true, message: 'Webhook deleted successfully' });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ success: false, error: 'Failed to delete webhook' });
  }
});

export default WebhookRoutes;
