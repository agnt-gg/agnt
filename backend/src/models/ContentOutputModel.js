import db from './database/index.js';

class ContentOutputModel {
  static createOrUpdate(id, userId, workflowId, toolId, content, isShareable, contentType = 'html', conversationId = null, title = null) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO content_outputs (id, user_id, workflow_id, tool_id, content, is_shareable, content_type, conversation_id, title, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, userId, workflowId || null, toolId || null, content, isShareable ? 1 : 0, contentType, conversationId, title],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        }
      );
    });
  }
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });
  }
  static findAllByUserId(userId, limit = null, offset = null) {
    return new Promise((resolve, reject) => {
      // Use a single query with COUNT() window function to avoid two round-trips
      // Exclude the large 'content' column - the list view only needs metadata
      const listColumns = 'id, user_id, workflow_id, tool_id, content_type, conversation_id, title, is_shareable, created_at, updated_at';
      let query = `SELECT ${listColumns}, COUNT(*) OVER() as _total_count FROM content_outputs WHERE user_id = ? ORDER BY updated_at DESC`;
      const params = [userId];

      if (limit !== null) {
        query += ' LIMIT ?';
        params.push(limit);

        if (offset !== null) {
          query += ' OFFSET ?';
          params.push(offset);
        }
      }

      db.all(query, params, (err, outputs) => {
        if (err) {
          reject(err);
          return;
        }
        const totalCount = outputs.length > 0 ? outputs[0]._total_count : 0;
        // Strip the _total_count field from results
        const cleanOutputs = outputs.map(({ _total_count, ...rest }) => rest);
        resolve({ outputs: cleanOutputs, totalCount });
      });
    });
  }
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM content_outputs WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
  static findByWorkflowId(workflowId, userId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM content_outputs WHERE workflow_id = ? AND user_id = ? ORDER BY updated_at DESC', [workflowId, userId], (err, outputs) => {
        if (err) reject(err);
        else resolve(outputs);
      });
    });
  }
  static findByToolId(toolId, userId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM content_outputs WHERE tool_id = ? AND user_id = ? ORDER BY updated_at DESC', [toolId, userId], (err, outputs) => {
        if (err) reject(err);
        else resolve(outputs);
      });
    });
  }
  static updateTitle(id, userId, title) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE content_outputs SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [title, id, userId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }
  static findByConversationId(conversationId, userId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM content_outputs WHERE conversation_id = ? AND user_id = ?', [conversationId, userId], (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });
  }
}

export default ContentOutputModel;
