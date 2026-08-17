import db from './database/index.js';

class CustomToolModel {
  static createOrUpdate(id, tool, userId) {
    return new Promise((resolve, reject) => {
      const { title, category, type, icon, description, parameters, outputs, isShareable, base, code, config } = tool;
      /**
       * UPSERT, not INSERT OR REPLACE. See AgentModel.createOrUpdate for the
       * full reasoning; this is the mildest of the three instances.
       *
       * `INSERT OR REPLACE` DELETEs the conflicting row and inserts a new one,
       * so every column this statement does not name reverted to its schema
       * DEFAULT — here that is created_at, reset to now on every edit. `tools`
       * carries no provenance flags, so nothing was disabled by it, only lost.
       *
       * created_by is deliberately absent from the SET list: an edit must not
       * transfer ownership. ToolService already forks to a new id when the
       * editor is not the creator, so that transfer was unreachable through the
       * UI — but a model should not rely on one caller's guard for a property
       * this basic, and every other caller now inherits the guarantee.
       *
       * Guarded by CustomToolModel.provenance.test.js.
       */
      db.run(
        `INSERT INTO tools (id, base, title, category, type, icon, description, config, code, parameters, outputs, created_by, is_shareable, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
             base = excluded.base,
             title = excluded.title,
             category = excluded.category,
             type = excluded.type,
             icon = excluded.icon,
             description = excluded.description,
             config = excluded.config,
             code = excluded.code,
             parameters = excluded.parameters,
             outputs = excluded.outputs,
             is_shareable = excluded.is_shareable,
             updated_at = CURRENT_TIMESTAMP`,
        [
          id,
          base || 'AI',
          title,
          category,
          type,
          icon,
          description,
          config ? JSON.stringify(config) : null,
          code || null,
          JSON.stringify(parameters),
          JSON.stringify(outputs),
          userId,
          isShareable ? 1 : 0,
        ],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        }
      );
    });
  }
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM tools WHERE id = ?', [id], (err, tool) => {
        if (err) reject(err);
        else if (tool)
          resolve({
            ...tool,
            parameters: JSON.parse(tool.parameters),
            outputs: JSON.parse(tool.outputs),
            config: tool.config ? JSON.parse(tool.config) : null,
            is_shareable: Boolean(tool.is_shareable),
          });
        else resolve(null);
      });
    });
  }
  static findAllByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM tools WHERE created_by = ? ORDER BY updated_at DESC', [userId], (err, tools) => {
        if (err) reject(err);
        else
          resolve(
            tools.map((tool) => ({
              ...tool,
              parameters: JSON.parse(tool.parameters),
              outputs: JSON.parse(tool.outputs),
              config: tool.config ? JSON.parse(tool.config) : null,
              is_shareable: Boolean(tool.is_shareable),
            }))
          );
      });
    });
  }
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM tools WHERE id = ? AND created_by = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default CustomToolModel;
