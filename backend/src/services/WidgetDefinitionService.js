import db from '../models/database/index.js';
import { v4 as uuidv4 } from 'uuid';
import { getBestChromePath } from '../utils/chrome-detector.js';

// --- Persistent Puppeteer browser for thumbnail captures ---
// Lazy-launched on first capture, auto-closes after 60s of inactivity.
let _browser = null;
let _browserIdleTimer = null;
const BROWSER_IDLE_MS = 60000;

async function getThumbnailBrowser() {
  // Reset idle timer on every use
  clearTimeout(_browserIdleTimer);
  _browserIdleTimer = setTimeout(closeThumbnailBrowser, BROWSER_IDLE_MS);

  if (_browser && _browser.connected) return _browser;

  const chromePath = getBestChromePath();
  if (!chromePath) throw new Error('No Chrome/Chromium browser found on this system');

  const puppeteer = await import('puppeteer-core');
  _browser = await puppeteer.default.launch({
    headless: 'new',
    executablePath: chromePath,
    protocolTimeout: 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--allow-file-access-from-files',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-experimental-web-platform-features',
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-gpu-rasterization',
    ],
  });

  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

function closeThumbnailBrowser() {
  if (_browser) {
    _browser.close().catch(() => {});
    _browser = null;
  }
}

class WidgetDefinitionService {
  /**
   * Get all widget definitions for a user (+ shared ones).
   */
  async getAllWidgets(req, res) {
    try {
      const userId = req.user?.id || req.user?.userId;
      const rows = await new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM widget_definitions
           WHERE user_id = ? OR is_shared = 1
           ORDER BY updated_at DESC`,
          [userId || ''],
          (err, rows) => (err ? reject(err) : resolve(rows || [])),
        );
      });

      const widgets = rows.map((row) => ({
        ...row,
        config: JSON.parse(row.config || '{}'),
        data_bindings: JSON.parse(row.data_bindings || '[]'),
        default_size: JSON.parse(row.default_size || '{"cols":4,"rows":3}'),
        min_size: JSON.parse(row.min_size || '{"cols":2,"rows":2}'),
        useThemeStyles: row.use_theme_styles !== 0,
      }));

      res.json({ widgets });
    } catch (error) {
      console.error('Error fetching widget definitions:', error);
      res.status(500).json({ error: 'Failed to fetch widget definitions' });
    }
  }

  /**
   * Get a single widget definition by ID.
   */
  async getWidget(req, res) {
    try {
      const { widgetId } = req.params;
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM widget_definitions WHERE id = ?', [widgetId], (err, row) =>
          err ? reject(err) : resolve(row),
        );
      });

      if (!row) {
        return res.status(404).json({ error: 'Widget definition not found' });
      }

      const widget = {
        ...row,
        config: JSON.parse(row.config || '{}'),
        data_bindings: JSON.parse(row.data_bindings || '[]'),
        default_size: JSON.parse(row.default_size || '{"cols":4,"rows":3}'),
        min_size: JSON.parse(row.min_size || '{"cols":2,"rows":2}'),
        useThemeStyles: row.use_theme_styles !== 0,
      };

      res.json({ widget });
    } catch (error) {
      console.error('Error fetching widget definition:', error);
      res.status(500).json({ error: 'Failed to fetch widget definition' });
    }
  }

  /**
   * Create a new widget definition.
   */
  async createWidget(req, res) {
    try {
      const userId = req.user?.id || req.user?.userId;
      const {
        name,
        description,
        icon,
        category,
        widget_type,
        source_code,
        config,
        data_bindings,
        default_size,
        min_size,
        thumbnail,
        useThemeStyles,
      } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }

      const id = 'cw_' + uuidv4().replace(/-/g, '').slice(0, 12);

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO widget_definitions
           (id, user_id, name, description, icon, category, widget_type, source_code, config, data_bindings, default_size, min_size, thumbnail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            userId || 'anonymous',
            name,
            description || '',
            icon || 'fas fa-puzzle-piece',
            category || 'custom',
            widget_type || 'html',
            source_code || '',
            JSON.stringify(config || {}),
            JSON.stringify(data_bindings || []),
            JSON.stringify(default_size || { cols: 4, rows: 3 }),
            JSON.stringify(min_size || { cols: 2, rows: 2 }),
            thumbnail || null,
          ],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      // Set use_theme_styles separately (column may not exist on older DBs)
      if (useThemeStyles !== undefined) {
        await new Promise((resolve) => {
          db.run(
            `UPDATE widget_definitions SET use_theme_styles = ? WHERE id = ?`,
            [useThemeStyles ? 1 : 0, id],
            () => resolve(),
          );
        });
      }

      res.status(201).json({
        message: 'Widget definition created',
        id,
        widget: {
          id,
          user_id: userId || 'anonymous',
          name,
          description: description || '',
          icon: icon || 'fas fa-puzzle-piece',
          category: category || 'custom',
          widget_type: widget_type || 'html',
          source_code: source_code || '',
          config: config || {},
          data_bindings: data_bindings || [],
          default_size: default_size || { cols: 4, rows: 3 },
          min_size: min_size || { cols: 2, rows: 2 },
          useThemeStyles: useThemeStyles !== false,
          is_shared: 0,
          is_published: 0,
          version: '1.0.0',
        },
      });
    } catch (error) {
      console.error('Error creating widget definition:', error);
      res.status(500).json({ error: 'Failed to create widget definition' });
    }
  }

  /**
   * Update a widget definition.
   */
  async updateWidget(req, res) {
    try {
      const { widgetId } = req.params;
      const {
        name,
        description,
        icon,
        category,
        widget_type,
        source_code,
        config,
        data_bindings,
        default_size,
        min_size,
        is_shared,
        thumbnail,
        useThemeStyles,
      } = req.body;

      // Check existence
      const existing = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM widget_definitions WHERE id = ?', [widgetId], (err, row) =>
          err ? reject(err) : resolve(row),
        );
      });

      if (!existing) {
        return res.status(404).json({ error: 'Widget definition not found' });
      }

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE widget_definitions SET
             name = COALESCE(?, name),
             description = COALESCE(?, description),
             icon = COALESCE(?, icon),
             category = COALESCE(?, category),
             widget_type = COALESCE(?, widget_type),
             source_code = COALESCE(?, source_code),
             config = COALESCE(?, config),
             data_bindings = COALESCE(?, data_bindings),
             default_size = COALESCE(?, default_size),
             min_size = COALESCE(?, min_size),
             is_shared = COALESCE(?, is_shared),
             thumbnail = COALESCE(?, thumbnail),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            name || null,
            description !== undefined ? description : null,
            icon || null,
            category || null,
            widget_type || null,
            source_code !== undefined ? source_code : null,
            config ? JSON.stringify(config) : null,
            data_bindings ? JSON.stringify(data_bindings) : null,
            default_size ? JSON.stringify(default_size) : null,
            min_size ? JSON.stringify(min_size) : null,
            is_shared !== undefined ? (is_shared ? 1 : 0) : null,
            thumbnail !== undefined ? thumbnail : null,
            widgetId,
          ],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      // Update use_theme_styles separately (column may not exist on older DBs)
      if (useThemeStyles !== undefined) {
        await new Promise((resolve) => {
          db.run(
            `UPDATE widget_definitions SET use_theme_styles = ? WHERE id = ?`,
            [useThemeStyles ? 1 : 0, widgetId],
            () => resolve(), // Ignore error if column doesn't exist
          );
        });
      }

      res.json({ message: 'Widget definition updated', id: widgetId });
    } catch (error) {
      console.error('Error updating widget definition:', error);
      res.status(500).json({ error: 'Failed to update widget definition' });
    }
  }

  /**
   * Delete a widget definition.
   */
  async deleteWidget(req, res) {
    try {
      const { widgetId } = req.params;

      await new Promise((resolve, reject) => {
        db.run('DELETE FROM widget_definitions WHERE id = ?', [widgetId], (err) =>
          err ? reject(err) : resolve(),
        );
      });

      res.json({ message: 'Widget definition deleted', id: widgetId });
    } catch (error) {
      console.error('Error deleting widget definition:', error);
      res.status(500).json({ error: 'Failed to delete widget definition' });
    }
  }

  /**
   * Duplicate a widget definition.
   */
  async duplicateWidget(req, res) {
    try {
      const { widgetId } = req.params;
      const userId = req.user?.id || req.user?.userId;

      const original = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM widget_definitions WHERE id = ?', [widgetId], (err, row) =>
          err ? reject(err) : resolve(row),
        );
      });

      if (!original) {
        return res.status(404).json({ error: 'Widget definition not found' });
      }

      const newId = 'cw_' + uuidv4().replace(/-/g, '').slice(0, 12);

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO widget_definitions
           (id, user_id, name, description, icon, category, widget_type, source_code, config, data_bindings, default_size, min_size, thumbnail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId,
            userId || original.user_id,
            original.name + ' (copy)',
            original.description,
            original.icon,
            original.category,
            original.widget_type,
            original.source_code,
            original.config,
            original.data_bindings,
            original.default_size,
            original.min_size,
            original.thumbnail,
          ],
          (err) => (err ? reject(err) : resolve()),
        );
      });

      res.status(201).json({ message: 'Widget duplicated', id: newId });
    } catch (error) {
      console.error('Error duplicating widget definition:', error);
      res.status(500).json({ error: 'Failed to duplicate widget definition' });
    }
  }

  /**
   * Export a widget definition as JSON.
   */
  async exportWidget(req, res) {
    try {
      const { widgetId } = req.params;
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM widget_definitions WHERE id = ?', [widgetId], (err, row) =>
          err ? reject(err) : resolve(row),
        );
      });

      if (!row) {
        return res.status(404).json({ error: 'Widget definition not found' });
      }

      const exportData = {
        _format: 'agnt-widget',
        _version: '1.0.0',
        name: row.name,
        description: row.description,
        icon: row.icon,
        category: row.category,
        widget_type: row.widget_type,
        source_code: row.source_code,
        config: JSON.parse(row.config || '{}'),
        data_bindings: JSON.parse(row.data_bindings || '[]'),
        default_size: JSON.parse(row.default_size || '{"cols":4,"rows":3}'),
        min_size: JSON.parse(row.min_size || '{"cols":2,"rows":2}'),
        exported_at: new Date().toISOString(),
      };

      res.json({ export: exportData });
    } catch (error) {
      console.error('Error exporting widget:', error);
      res.status(500).json({ error: 'Failed to export widget' });
    }
  }

  /**
   * Import a widget definition from JSON.
   */
  async importWidget(req, res) {
    try {
      const userId = req.user?.id || req.user?.userId;
      const { widget_data } = req.body;

      if (!widget_data || widget_data._format !== 'agnt-widget') {
        return res.status(400).json({ error: 'Invalid widget import data' });
      }

      // Delegate to createWidget with the parsed data
      req.body = {
        name: widget_data.name,
        description: widget_data.description,
        icon: widget_data.icon,
        category: widget_data.category,
        widget_type: widget_data.widget_type,
        source_code: widget_data.source_code,
        config: widget_data.config,
        data_bindings: widget_data.data_bindings,
        default_size: widget_data.default_size,
        min_size: widget_data.min_size,
      };

      return this.createWidget(req, res);
    } catch (error) {
      console.error('Error importing widget:', error);
      res.status(500).json({ error: 'Failed to import widget' });
    }
  }

  /**
   * Capture a widget thumbnail using Puppeteer (server-side screenshot).
   *
   * Uses a PERSISTENT browser instance (lazy-launched, auto-closes after 60s
   * idle) so we don't pay the Chrome+SwiftShader startup cost on every capture.
   * Auto-dismisses alert/confirm/prompt dialogs so widgets with popups don't block.
   */
  async captureThumbnail(req, res) {
    const { html, storageData } = req.body;
    if (!html) {
      return res.status(400).json({ error: 'html is required' });
    }

    let page = null;

    try {
      const browser = await getThumbnailBrowser();
      page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630 });

      // Auto-dismiss any alert/confirm/prompt dialogs
      page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

      // Navigate to a lightweight endpoint to establish the localhost origin
      const port = process.env.PORT || 3333;
      try {
        await page.goto(`http://localhost:${port}/api/health`, {
          waitUntil: 'load',
          timeout: 8000,
        });
      } catch {
        // Origin is likely established even on timeout — continue
      }

      // Inject ALL of localStorage (same keys/values as the real app)
      if (storageData && typeof storageData === 'object') {
        await page.evaluate((data) => {
          for (const [key, value] of Object.entries(data)) {
            localStorage.setItem(key, value);
          }
        }, storageData);
      }

      // Load the widget HTML. Race with a fallback timer so complex widgets
      // with blocking scripts (Three.js, canvas, etc.) don't hang forever.
      await Promise.race([
        page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 }),
        new Promise((r) => setTimeout(r, 8000)),
      ]);

      // Give canvas/WebGL/Three.js/API-fetching apps time to render
      await new Promise((r) => setTimeout(r, 3000));

      const screenshotBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 85,
      });

      const base64 = 'data:image/jpeg;base64,' + screenshotBuffer.toString('base64');
      res.json({ thumbnail: base64 });
    } catch (error) {
      console.error('Error capturing widget thumbnail:', error);
      if (page) {
        try {
          const fallback = await page.screenshot({ type: 'jpeg', quality: 85 });
          const base64 = 'data:image/jpeg;base64,' + fallback.toString('base64');
          return res.json({ thumbnail: base64 });
        } catch {}
      }
      res.status(500).json({ error: 'Failed to capture thumbnail' });
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
}

export default new WidgetDefinitionService();
