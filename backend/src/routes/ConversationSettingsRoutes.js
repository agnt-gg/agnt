import express from 'express';
import { authenticateToken } from './Middleware.js';
import ConversationSettingsModel from '../models/ConversationSettingsModel.js';

const router = express.Router();

/**
 * GET /api/conversations/:id/settings
 * Returns the conversation's bound skill/goal IDs and AI override (null if unset).
 */
router.get('/:id/settings', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const row = await ConversationSettingsModel.get(conversationId);
    res.json({
      conversationId,
      activeSkillId: row?.active_skill_id || null,
      activeGoalId: row?.active_goal_id || null,
      provider: row?.provider || null,
      model: row?.model || null,
    });
  } catch (error) {
    console.error('[ConversationSettings] GET failed:', error);
    res.status(500).json({ error: 'Failed to load conversation settings' });
  }
});

/**
 * PATCH /api/conversations/:id/settings
 * Body: { activeSkillId?: string|null, activeGoalId?: string|null,
 *         provider?: string|null, model?: string|null }
 * Pass `null` to detach/clear. Omit a field to leave it unchanged.
 */
router.patch('/:id/settings', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user?.userId || null;
    const { activeSkillId, activeGoalId, provider, model } = req.body || {};

    // Guard field types: an AI override is a non-empty string or an explicit
    // null (clear). Anything else (objects, numbers, '') is a caller bug —
    // treat as "unchanged" rather than corrupting the row.
    const normalizeOverride = (v) =>
      v === null ? null : (typeof v === 'string' && v.trim() ? v.trim() : undefined);

    const updated = await ConversationSettingsModel.upsert({
      conversationId,
      userId,
      activeSkillId,
      activeGoalId,
      provider: provider === undefined ? undefined : normalizeOverride(provider),
      model: model === undefined ? undefined : normalizeOverride(model),
    });

    res.json({
      conversationId,
      activeSkillId: updated.activeSkillId,
      activeGoalId: updated.activeGoalId,
      provider: updated.provider,
      model: updated.model,
    });
  } catch (error) {
    console.error('[ConversationSettings] PATCH failed:', error);
    res.status(500).json({ error: 'Failed to update conversation settings' });
  }
});

export default router;
