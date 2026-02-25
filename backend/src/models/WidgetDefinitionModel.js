import db from './database/index.js';

/**
 * Widget Definition Model
 * Handles database operations for custom widget definitions.
 */
class WidgetDefinitionModel {
  /**
   * Ensure the widget_definitions table exists.
   * Called during database initialization.
   */
  static async ensureTable() {
    return new Promise((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS widget_definitions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          icon TEXT DEFAULT 'fas fa-puzzle-piece',
          category TEXT DEFAULT 'custom',
          widget_type TEXT NOT NULL DEFAULT 'html',
          source_code TEXT,
          config JSON DEFAULT '{}',
          data_bindings JSON DEFAULT '[]',
          default_size JSON DEFAULT '{"cols":4,"rows":3}',
          min_size JSON DEFAULT '{"cols":2,"rows":2}',
          is_shared INTEGER DEFAULT 0,
          is_published INTEGER DEFAULT 0,
          version TEXT DEFAULT '1.0.0',
          thumbnail TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`,
        (err) => {
          if (err) {
            console.error('Error creating widget_definitions table:', err);
            reject(err);
          } else {
            // Create index
            db.run(
              `CREATE INDEX IF NOT EXISTS idx_widget_definitions_user_id ON widget_definitions(user_id)`,
              (indexErr) => {
                if (indexErr) {
                  console.error('Error creating widget_definitions index:', indexErr);
                }
                resolve();
              },
            );
          }
        },
      );
    });
  }

  static async findByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM widget_definitions WHERE user_id = ? OR is_shared = 1 ORDER BY updated_at DESC`,
        [userId],
        (err, rows) => (err ? reject(err) : resolve(rows || [])),
      );
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM widget_definitions WHERE id = ?`, [id], (err, row) =>
        err ? reject(err) : resolve(row),
      );
    });
  }
}

export default WidgetDefinitionModel;
