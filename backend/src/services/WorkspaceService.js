import db from '../models/database/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * WorkspaceService — cross-device persistence for the Workspaces page (canvas
 * tabs). Reuses the existing widget_layouts table (NO schema migration) by
 * namespacing workspace rows with route = 'workspace:<workspaceId>':
 *
 *   page_id     → workspace id
 *   page_name   → tab name
 *   page_order  → tab order
 *   layout_data → JSON { widgets: [...], ai: {...}|null, updatedAt: <epoch ms> }
 *
 * Conflict resolution is last-write-wins per workspace on updatedAt (carried
 * inside layout_data). The (user_id, route) unique index (widgetLayoutDedupe.js)
 * gives us idempotent upserts for free.
 *
 * This is dormant until the frontend opts in (SYNC_ENABLED in useWorkspaces.js);
 * mounting the route changes no behaviour on its own.
 */
class WorkspaceService {
  _getUserId(req) {
    return req.user?.id || req.user?.userId || null;
  }

  _route(id) {
    return `workspace:${id}`;
  }

  /** GET /api/workspaces — all of the user's synced workspaces. */
  async getWorkspaces(req, res) {
    try {
      const userId = this._getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });
      const rows = await new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM widget_layouts
             WHERE user_id = ? AND route LIKE 'workspace:%'
             ORDER BY page_order ASC, created_at ASC`,
          [userId],
          (err, r) => (err ? reject(err) : resolve(r || [])),
        );
      });

      const workspaces = rows.map((row) => {
        let parsed = {};
        try { parsed = JSON.parse(row.layout_data || '{}'); } catch { parsed = {}; }
        return {
          id: row.page_id,
          name: row.page_name,
          order: row.page_order,
          widgets: Array.isArray(parsed.widgets) ? parsed.widgets : [],
          ai: parsed.ai || null,
          updatedAt: parsed.updatedAt || 0,
        };
      });

      res.json({ workspaces });
    } catch (error) {
      console.error('Error fetching workspaces:', error);
      res.status(500).json({ error: 'Failed to fetch workspaces' });
    }
  }

  /**
   * PUT /api/workspaces — whole-set upsert (mirrors how the client persists the
   * entire blob) plus an optional deletedIds[] so a tab closed on one device is
   * removed rather than resurrected from another on next sync.
   *
   * Body: { workspaces: [{ id, name, order, widgets, ai, updatedAt }], deletedIds: [id] }
   */
  async putWorkspaces(req, res) {
    try {
      const userId = this._getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });
      const { workspaces = [], deletedIds = [] } = req.body || {};

      if (!Array.isArray(workspaces)) {
        return res.status(400).json({ error: 'workspaces must be an array' });
      }
      if (!Array.isArray(deletedIds)) {
        return res.status(400).json({ error: 'deletedIds must be an array' });
      }

      // Deletions first (user-scoped).
      for (const id of deletedIds) {
        await new Promise((resolve, reject) => {
          db.run(
            'DELETE FROM widget_layouts WHERE user_id = ? AND route = ?',
            [userId, this._route(id)],
            (err) => (err ? reject(err) : resolve()),
          );
        });
      }

      // Upserts with last-write-wins on updatedAt.
      for (const ws of workspaces) {
        if (!ws || !ws.id) continue;
        const route = this._route(ws.id);
        const incomingStamp = Number(ws.updatedAt) || 0;
        const layoutData = JSON.stringify({
          widgets: Array.isArray(ws.widgets) ? ws.widgets : [],
          ai: ws.ai && ws.ai.provider ? { provider: ws.ai.provider, model: ws.ai.model || null } : null,
          updatedAt: incomingStamp,
        });

        const existing = await new Promise((resolve, reject) => {
          db.get(
            'SELECT id, page_id, layout_data FROM widget_layouts WHERE user_id = ? AND route = ?',
            [userId, route],
            (err, row) => (err ? reject(err) : resolve(row)),
          );
        });

        if (existing) {
          // Last-write-wins: ignore a stale write.
          let existingStamp = 0;
          try { existingStamp = Number(JSON.parse(existing.layout_data || '{}').updatedAt) || 0; } catch { existingStamp = 0; }
          if (incomingStamp < existingStamp) continue;

          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE widget_layouts
                 SET page_name = ?, page_order = ?, layout_data = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = ? AND route = ?`,
              [ws.name || 'Workspace', Number(ws.order) || 0, layoutData, userId, route],
              (err) => (err ? reject(err) : resolve()),
            );
          });
        } else {
          const id = uuidv4();
          try {
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO widget_layouts (id, user_id, page_id, page_name, page_icon, page_order, route, layout_data)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, userId, ws.id, ws.name || 'Workspace', 'fas fa-th', Number(ws.order) || 0, route, layoutData],
                (err) => (err ? reject(err) : resolve()),
              );
            });
          } catch (insertErr) {
            // Racing INSERT on the (user_id, route) unique index → fall through
            // to an UPDATE instead of failing (mirrors LayoutService).
            if (/SQLITE_CONSTRAINT|UNIQUE constraint/i.test(insertErr?.message || '')) {
              // Re-read the row that won the INSERT race and honour LWW: only
              // overwrite if our write is not older than what is already there.
              const winner = await new Promise((resolve, reject) => {
                db.get(
                  'SELECT layout_data FROM widget_layouts WHERE user_id = ? AND route = ?',
                  [userId, route],
                  (err, row) => (err ? reject(err) : resolve(row)),
                );
              });
              let winnerStamp = 0;
              try { winnerStamp = Number(JSON.parse(winner?.layout_data || '{}').updatedAt) || 0; } catch { winnerStamp = 0; }
              if (incomingStamp < winnerStamp) continue; // stale racer: leave the newer winner
              await new Promise((resolve, reject) => {
                db.run(
                  `UPDATE widget_layouts
                     SET page_name = ?, page_order = ?, layout_data = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = ? AND route = ?`,
                  [ws.name || 'Workspace', Number(ws.order) || 0, layoutData, userId, route],
                  (err) => (err ? reject(err) : resolve()),
                );
              });
            } else {
              throw insertErr;
            }
          }
        }
      }

      res.json({ message: 'Workspaces synced', count: workspaces.length, deleted: deletedIds.length });
    } catch (error) {
      console.error('Error syncing workspaces:', error);
      res.status(500).json({ error: 'Failed to sync workspaces', details: error.message });
    }
  }

  /** DELETE /api/workspaces/:id — remove a single workspace (user-scoped). */
  async deleteWorkspace(req, res) {
    try {
      const userId = this._getUserId(req);
      if (!userId) return res.status(401).json({ error: 'Authentication required' });
      const { id } = req.params;
      await new Promise((resolve, reject) => {
        db.run(
          'DELETE FROM widget_layouts WHERE user_id = ? AND route = ?',
          [userId, this._route(id)],
          (err) => (err ? reject(err) : resolve()),
        );
      });
      res.json({ message: 'Workspace deleted', id });
    } catch (error) {
      console.error('Error deleting workspace:', error);
      res.status(500).json({ error: 'Failed to delete workspace' });
    }
  }
}

export default new WorkspaceService();
