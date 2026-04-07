import express from 'express';
import GroupModel from '../models/GroupModel.js';
import ContentOutputModel from '../models/ContentOutputModel.js';
import generateUUID from '../utils/generateUUID.js';
import { authenticateToken } from './Middleware.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';

const GroupRoutes = express.Router();

// List all groups for user
GroupRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const groups = await GroupModel.findAllByUserId(req.user.userId);
    res.json({ groups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Create a group
GroupRoutes.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, color, sort_order, parent_id } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const id = generateUUID();
    await GroupModel.create(id, req.user.userId, name.trim(), description || null, color || '#6366f1', sort_order || 0, parent_id || null);

    const group = await GroupModel.findOne(id, req.user.userId);

    broadcastToUser(req.user.userId, RealtimeEvents.GROUP_CREATED, group);

    res.status(201).json(group);
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Update a group
GroupRoutes.put('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await GroupModel.update(req.params.id, req.user.userId, req.body);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = await GroupModel.findOne(req.params.id, req.user.userId);
    broadcastToUser(req.user.userId, RealtimeEvents.GROUP_UPDATED, group);

    res.json(group);
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// Delete a group
// Query param: mode=move (move children to parent, default) or mode=delete (delete children too)
GroupRoutes.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const mode = req.query.mode || 'move';
    const group = await GroupModel.findOne(req.params.id, req.user.userId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (mode === 'move') {
      // Move direct children to this group's parent (or root if top-level)
      await GroupModel.reparentChildren(req.params.id, req.user.userId, group.parent_id || null);
    }
    // mode=delete: ON DELETE CASCADE handles child groups automatically

    await GroupModel.delete(req.params.id, req.user.userId);

    broadcastToUser(req.user.userId, RealtimeEvents.GROUP_DELETED, { id: req.params.id, mode });

    res.json({ message: 'Group deleted' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Reorder groups
GroupRoutes.patch('/reorder', authenticateToken, async (req, res) => {
  try {
    const { orders } = req.body; // [{ id, sort_order }]
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders array is required' });
    }

    await GroupModel.updateSortOrder(req.user.userId, orders);
    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering groups:', error);
    res.status(500).json({ error: 'Failed to reorder groups' });
  }
});

// Move a single output to a group
GroupRoutes.patch('/move/:outputId', authenticateToken, async (req, res) => {
  try {
    const { group_id } = req.body; // null to ungroup
    const result = await ContentOutputModel.moveToGroup(req.params.outputId, req.user.userId, group_id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Output not found' });
    }

    broadcastToUser(req.user.userId, RealtimeEvents.CONTENT_UPDATED, {
      id: req.params.outputId,
      group_id: group_id || null,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error moving output:', error);
    res.status(500).json({ error: 'Failed to move output' });
  }
});

// Bulk move outputs to a group
GroupRoutes.patch('/bulk-move', authenticateToken, async (req, res) => {
  try {
    const { output_ids, group_id } = req.body;
    if (!Array.isArray(output_ids) || output_ids.length === 0) {
      return res.status(400).json({ error: 'output_ids array is required' });
    }

    await ContentOutputModel.bulkMoveToGroup(output_ids, req.user.userId, group_id);

    broadcastToUser(req.user.userId, RealtimeEvents.CONTENT_UPDATED, {
      ids: output_ids,
      group_id: group_id || null,
      bulk: true,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error bulk moving outputs:', error);
    res.status(500).json({ error: 'Failed to bulk move outputs' });
  }
});

console.log('Group Routes Started...');

export default GroupRoutes;
