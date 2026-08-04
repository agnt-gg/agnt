import db from './database/index.js';

class ContentOutputModel {
  static createOrUpdate(id, userId, workflowId, toolId, content, isShareable, contentType = 'html', conversationId = null, title = null) {
    return new Promise((resolve, reject) => {
      // Use UPSERT (not INSERT OR REPLACE) so columns we don't touch — like group_id —
      // aren't wiped back to their defaults on every save.
      db.run(
        `INSERT INTO content_outputs (id, user_id, workflow_id, tool_id, content, is_shareable, content_type, conversation_id, title, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           workflow_id = excluded.workflow_id,
           tool_id = excluded.tool_id,
           content = excluded.content,
           is_shareable = excluded.is_shareable,
           content_type = excluded.content_type,
           conversation_id = excluded.conversation_id,
           title = excluded.title,
           updated_at = CURRENT_TIMESTAMP`,
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
  static findAllByUserId(userId, limit = null, offset = null, groupId = undefined) {
    return new Promise((resolve, reject) => {
      // Use a single query with COUNT() window function to avoid two round-trips
      // Exclude the large 'content' column - the list view only needs metadata
      const listColumns = 'id, user_id, workflow_id, tool_id, content_type, conversation_id, title, is_shareable, group_id, last_read_at, archived_at, created_at, updated_at';
      let where = 'user_id = ?';
      const params = [userId];

      // Filter by group: explicit id, or 'none' for ungrouped
      if (groupId === 'none') {
        where += ' AND group_id IS NULL';
      } else if (groupId) {
        where += ' AND group_id = ?';
        params.push(groupId);
      }

      let query = `SELECT ${listColumns}, COUNT(*) OVER() as _total_count FROM content_outputs WHERE ${where} ORDER BY updated_at DESC`;

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
  static moveToGroup(id, userId, groupId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE content_outputs SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [groupId || null, id, userId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  static bulkMoveToGroup(ids, userId, groupId) {
    return new Promise((resolve, reject) => {
      const placeholders = ids.map(() => '?').join(',');
      db.run(
        `UPDATE content_outputs SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND user_id = ?`,
        [groupId || null, ...ids, userId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  /**
   * Set the read watermark. `read = true` stamps last_read_at = now;
   * `read = false` clears it (manual "Mark as Unread").
   *
   * Deliberately does NOT touch updated_at — reading a conversation is not a
   * change to it, and unread is derived as updated_at > last_read_at, so
   * bumping updated_at here would immediately un-read the read.
   */
  static setReadState(id, userId, read) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE content_outputs SET last_read_at = ${read ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ? AND user_id = ?`,
        [id, userId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  /**
   * Stamp the read watermark on every unread conversation at once, optionally
   * restricted to `ids`. "Clear the Needs-you rail" is ONE user intent, so it
   * is one statement — not N round trips that can half-apply.
   *
   * The WHERE clause is the same predicate the client derives unread from
   * (frontend/src/utils/conversationAttention.js): archived rows are never
   * unread, and already-read rows are skipped, so `changes` is an honest
   * count of what was actually cleared. updated_at is untouched for the same
   * reason setReadState leaves it alone.
   *
   * `ids = null` means "every unread conversation this user owns". An EMPTY
   * array means "these zero conversations" and must never be widened into
   * that — a caller sending [] gets a no-op, not a mass update.
   */
  static markAllRead(userId, ids = null) {
    if (Array.isArray(ids) && ids.length === 0) return Promise.resolve({ changes: 0 });

    return new Promise((resolve, reject) => {
      const scoped = Array.isArray(ids);
      const scopeClause = scoped ? ` AND id IN (${ids.map(() => '?').join(',')})` : '';
      db.run(
        `UPDATE content_outputs SET last_read_at = CURRENT_TIMESTAMP
         WHERE user_id = ?
           AND archived_at IS NULL
           AND (last_read_at IS NULL OR updated_at > last_read_at)${scopeClause}`,
        scoped ? [userId, ...ids] : [userId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  /**
   * Archive / unarchive. Does NOT touch updated_at so unarchiving restores
   * the conversation's original position in the recency-sorted sidebar.
   */
  static setArchived(id, userId, archived) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE content_outputs SET archived_at = ${archived ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ? AND user_id = ?`,
        [id, userId],
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
