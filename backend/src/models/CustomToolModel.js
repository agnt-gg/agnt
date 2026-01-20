import db from './database/index.js';

class CustomToolModel {
  static createOrUpdate(id, tool, userId) {
    return new Promise((resolve, reject) => {
      const { title, category, type, icon, description, parameters, outputs, isShareable, base, code, config } = tool;
      db.run(
        `INSERT OR REPLACE INTO tools (id, base, title, category, type, icon, description, config, code, parameters, outputs, created_by, is_shareable, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
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
