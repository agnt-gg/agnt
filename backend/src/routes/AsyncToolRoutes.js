/**
 * Async Tool Management Routes
 * API endpoints for managing async tool executions
 */

import express from 'express';
import { authenticateToken } from './Middleware.js';
import asyncToolQueue from '../services/AsyncToolQueue.js';

const router = express.Router();

/**
 * GET /api/async-tools/status
 * Get queue statistics
 */
router.get('/status', authenticateToken, (req, res) => {
  try {
    const stats = asyncToolQueue.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[AsyncToolRoutes] Error getting queue status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/async-tools/executions/:conversationId
 * Get all async tool executions for a conversation
 */
router.get('/executions/:conversationId', authenticateToken, (req, res) => {
  try {
    const { conversationId } = req.params;
    const executions = asyncToolQueue.getExecutionsByConversation(conversationId);
    res.json({ success: true, executions });
  } catch (error) {
    console.error('[AsyncToolRoutes] Error getting executions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/async-tools/executions/:conversationId/running
 * Get running async tool executions for a conversation
 */
router.get('/executions/:conversationId/running', authenticateToken, (req, res) => {
  try {
    const { conversationId } = req.params;
    const executions = asyncToolQueue.getRunningExecutions(conversationId);
    res.json({ success: true, executions });
  } catch (error) {
    console.error('[AsyncToolRoutes] Error getting running executions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/async-tools/cancel/:executionId
 * Cancel a running async tool execution
 */
router.post('/cancel/:executionId', authenticateToken, (req, res) => {
  try {
    const { executionId } = req.params;
    const result = asyncToolQueue.cancel(executionId);

    if (result.success) {
      res.json({ success: true, message: 'Async tool execution cancelled successfully' });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('[AsyncToolRoutes] Error cancelling execution:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/async-tools/execution/:executionId
 * Get details of a specific execution
 */
router.get('/execution/:executionId', authenticateToken, (req, res) => {
  try {
    const { executionId } = req.params;
    const execution = asyncToolQueue.getExecution(executionId);

    if (execution) {
      res.json({ success: true, execution });
    } else {
      res.status(404).json({ success: false, error: 'Execution not found' });
    }
  } catch (error) {
    console.error('[AsyncToolRoutes] Error getting execution:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
