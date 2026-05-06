import express from 'express';
import { authenticateToken } from './Middleware.js';
import ConversationSettingsModel from '../models/ConversationSettingsModel.js';

const router = express.Router();

/**
 * GET /api/conversations/:id/settings
 * Returns the conversation's bound skill/goal IDs (null if unset).
 */
router.get('/:id/settings', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const row = await ConversationSettingsModel.get(conversationId);
    res.json({
      conversationId,
      activeSkillId: row?.active_skill_id || null,
      activeGoalId: row?.active_goal_id || null,
    });
  } catch (error) {
    console.error('[ConversationSettings] GET failed:', error);
    res.status(500).json({ error: 'Failed to load conversation settings' });
  }
});

/**
 * PATCH /api/conversations/:id/settings
 * Body: { activeSkillId?: string|null, activeGoalId?: string|null }
 * Pass `null` to detach. Omit a field to leave it unchanged.
 */
router.patch('/:id/settings', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user?.userId || null;
    const { activeSkillId, activeGoalId } = req.body || {};

    const updated = await ConversationSettingsModel.upsert({
      conversationId,
      userId,
      activeSkillId,
      activeGoalId,
    });

    res.json({
      conversationId,
      activeSkillId: updated.activeSkillId,
      activeGoalId: updated.activeGoalId,
    });
  } catch (error) {
    console.error('[ConversationSettings] PATCH failed:', error);
    res.status(500).json({ error: 'Failed to update conversation settings' });
  }
});

export default router;
