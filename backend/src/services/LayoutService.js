import db from '../models/database/index.js';
import { v4 as uuidv4 } from 'uuid';

class LayoutService {
  /**
   * Get all layout pages.
   */
  async getAllLayouts(req, res) {
    try {
      const pages = await new Promise((resolve, reject) => {
        db.all(
          'SELECT * FROM widget_layouts ORDER BY page_order ASC, created_at ASC',
          [],
          (err, rows) => (err ? reject(err) : resolve(rows || [])),
        );
      });

      res.json({ pages });
    } catch (error) {
      console.error('Error fetching layouts:', error);
      res.status(500).json({ error: 'Failed to fetch layouts' });
    }
  }

  /**
   * Create a new page layout.
   */
  async createLayout(req, res) {
    try {
      const { page_id, page_name, page_icon, page_order, route, layout_data } = req.body;

      if (!page_id || !page_name) {
        return res.status(400).json({ error: 'page_id and page_name are required' });
      }

      const id = uuidv4();
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO widget_layouts (id, page_id, page_name, page_icon, page_order, route, layout_data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, page_id, page_name, page_icon || 'fas fa-th', page_order || 0, route || null, layout_data || '[]'],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      res.status(201).json({
        message: 'Layout created',
        id,
        page_id,
      });
    } catch (error) {
      console.error('Error creating layout:', error);
      res.status(500).json({ error: 'Failed to create layout' });
    }
  }

  /**
   * Update a page layout.
   */
  async updateLayout(req, res) {
    try {
      const { pageId } = req.params;
      const { page_name, page_icon, page_order, route, layout_data } = req.body;

      // Check if page exists
      const existing = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM widget_layouts WHERE page_id = ?', [pageId], (err, row) =>
          err ? reject(err) : resolve(row),
        );
      });

      if (existing) {
        // Update existing
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE widget_layouts
             SET page_name = COALESCE(?, page_name),
                 page_icon = COALESCE(?, page_icon),
                 page_order = COALESCE(?, page_order),
                 route = COALESCE(?, route),
                 layout_data = COALESCE(?, layout_data),
                 updated_at = CURRENT_TIMESTAMP
             WHERE page_id = ?`,
            [page_name, page_icon, page_order, route, layout_data, pageId],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      } else {
        // Insert new (upsert behavior)
        const id = uuidv4();
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO widget_layouts (id, page_id, page_name, page_icon, page_order, route, layout_data)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, pageId, page_name || 'Page', page_icon || 'fas fa-th', page_order || 0, route || null, layout_data || '[]'],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      }

      res.json({ message: 'Layout updated', page_id: pageId });
    } catch (error) {
      console.error('Error updating layout:', error);
      res.status(500).json({ error: 'Failed to update layout' });
    }
  }

  /**
   * Delete a page layout.
   */
  async deleteLayout(req, res) {
    try {
      const { pageId } = req.params;

      await new Promise((resolve, reject) => {
        db.run('DELETE FROM widget_layouts WHERE page_id = ?', [pageId], (err) =>
          err ? reject(err) : resolve(),
        );
      });

      res.json({ message: 'Layout deleted', page_id: pageId });
    } catch (error) {
      console.error('Error deleting layout:', error);
      res.status(500).json({ error: 'Failed to delete layout' });
    }
  }

  /**
   * Reset a page to default layout.
   */
  async resetLayout(req, res) {
    try {
      const { pageId } = req.params;
      const { layout_data } = req.body;

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE widget_layouts SET layout_data = ?, updated_at = CURRENT_TIMESTAMP WHERE page_id = ?`,
          [layout_data || '[]', pageId],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      res.json({ message: 'Layout reset', page_id: pageId });
    } catch (error) {
      console.error('Error resetting layout:', error);
      res.status(500).json({ error: 'Failed to reset layout' });
    }
  }
}

export default new LayoutService();
