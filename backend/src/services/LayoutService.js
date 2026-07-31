import db from '../models/database/index.js';
import { v4 as uuidv4 } from 'uuid';

class LayoutService {
  /**
   * Get the authenticated user's ID from request.
   */
  _getUserId(req) {
    return req.user?.id || req.user?.userId || null;
  }

  /**
   * Get all layout pages for the authenticated user.
   */
  async getAllLayouts(req, res) {
    try {
      const userId = this._getUserId(req);
      const pages = await new Promise((resolve, reject) => {
        // Exclude workspace:* rows — those are owned by WorkspaceService
        // (/api/workspaces). Including them here leaks General/Coding into the
        // left-sidebar custom-page list (CanvasScreen customPages filters only
        // by SECTION_ROUTES, so workspace: routes look "custom").
        db.all(
          `SELECT * FROM widget_layouts
           WHERE user_id = ?
             AND (route IS NULL OR route NOT LIKE 'workspace:%')
           ORDER BY page_order ASC, created_at ASC`,
          [userId],
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
      const userId = this._getUserId(req);
      const { page_id, page_name, page_icon, page_order, route, layout_data } = req.body;

      if (!page_id || !page_name) {
        return res.status(400).json({ error: 'page_id and page_name are required' });
      }

      const id = uuidv4();
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO widget_layouts (id, user_id, page_id, page_name, page_icon, page_order, route, layout_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, userId, page_id, page_name, page_icon || 'fas fa-th', page_order || 0, route || null, layout_data || '[]'],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      res.status(201).json({
        message: 'Layout created',
        id,
        page_id,
      });
    } catch (error) {
      // (user_id, route) is uniquely indexed — see widgetLayoutDedupe.js. A
      // client racing itself into a second page for the same route is not an
      // error condition, it's a question already answered: hand back the page
      // that exists. This keeps a stale or retrying client correct instead of
      // leaving it holding a page id the database refused.
      if (/SQLITE_CONSTRAINT|UNIQUE constraint/i.test(error?.message || '')) {
        try {
          const userId = this._getUserId(req);
          const existing = await new Promise((resolve, reject) => {
            db.get(
              `SELECT * FROM widget_layouts
                WHERE user_id IS ? AND route = ?
                ORDER BY page_order ASC, created_at ASC
                LIMIT 1`,
              [userId, req.body?.route ?? null],
              (err, row) => (err ? reject(err) : resolve(row)),
            );
          });
          if (existing) {
            return res.status(200).json({
              message: 'Layout already exists for this route',
              deduplicated: true,
              id: existing.id,
              page_id: existing.page_id,
            });
          }
        } catch (lookupError) {
          console.error('Error resolving existing layout after constraint:', lookupError);
        }
      }
      console.error('Error creating layout:', error);
      res.status(500).json({ error: 'Failed to create layout', details: error.message });
    }
  }

  /**
   * Update a page layout (scoped to authenticated user).
   */
  async updateLayout(req, res) {
    try {
      const userId = this._getUserId(req);
      const { pageId } = req.params;
      const { page_name, page_icon, page_order, route, layout_data } = req.body;

      // Check if page exists for this user
      const existing = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM widget_layouts WHERE page_id = ? AND user_id = ?', [pageId, userId], (err, row) =>
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
             WHERE page_id = ? AND user_id = ?`,
            [page_name, page_icon, page_order, route, layout_data, pageId, userId],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      } else {
        // Insert new (upsert behavior)
        const id = uuidv4();
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO widget_layouts (id, user_id, page_id, page_name, page_icon, page_order, route, layout_data)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, userId, pageId, page_name || 'Page', page_icon || 'fas fa-th', page_order || 0, route || null, layout_data || '[]'],
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
   * Delete a page layout (scoped to authenticated user).
   */
  async deleteLayout(req, res) {
    try {
      const userId = this._getUserId(req);
      const { pageId } = req.params;

      await new Promise((resolve, reject) => {
        db.run('DELETE FROM widget_layouts WHERE page_id = ? AND user_id = ?', [pageId, userId], (err) =>
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
   * Reset a page to default layout (scoped to authenticated user).
   */
  async resetLayout(req, res) {
    try {
      const userId = this._getUserId(req);
      const { pageId } = req.params;
      const { layout_data } = req.body;

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE widget_layouts SET layout_data = ?, updated_at = CURRENT_TIMESTAMP WHERE page_id = ? AND user_id = ?`,
          [layout_data || '[]', pageId, userId],
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
