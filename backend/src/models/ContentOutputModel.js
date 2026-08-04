import db from './database/index.js';

// The metadata column set every list/meta read shares. ONE definition: the
// sidebar list, the save response, and the realtime broadcast must all carry
// the same shape, or the row a client patches in place diverges from the row
// a full fetch would have given it. Excludes the large content column.
const LIST_COLUMNS = 'id, user_id, workflow_id, tool_id, content_type, conversation_id, title, is_shareable, group_id, last_read_at, archived_at, created_at, updated_at';

class ContentOutputModel {
  /**
   * @param {{ viewing?: boolean }} [opts]
   *   viewing: the user is LOOKING AT this conversation right now (the saving
   *   client says so). The save then stamps the read watermark in the same
   *   statement as the change it writes.
   *
   *   This closes a race at its source rather than around it: a save bumps
   *   updated_at, which makes the row derived-unread until a follow-up
   *   markRead PATCH lands. During streaming a conversation autosaves every
   *   ~5s, so that window recurred forever, and any list snapshot taken
   *   inside it showed the conversation the user was READING as "needs you"
   *   — a flicker in the rail and a notification chime, every few seconds.
   *   Two writes with a gap can always be observed between them; one write
   *   has no between.
   */
  static createOrUpdate(id, userId, workflowId, toolId, content, isShareable, contentType = 'html', conversationId = null, title = null, { viewing = false } = {}) {
    return new Promise((resolve, reject) => {
      // Use UPSERT (not INSERT OR REPLACE) so columns we don't touch — like group_id —
      // aren't wiped back to their defaults on every save.
      //
      // THE last_read_at CLAUSE, non-viewing arm. Unread is derived as
      // "updated_at is later than last_read_at", which needs a watermark to
      // compare against; rows predating the column have none. Rather than a
      // one-shot mass backfill (see database/index.js for why that is a trap
      // on this table), each row acquires a watermark the first time it is
      // written, pinned one second BEFORE its pre-save updated_at.
      //
      // One second before, and not equal to: SQLite timestamps are
      // second-resolution, so pinning to the pre-save value would tie with
      // the new CURRENT_TIMESTAMP whenever two saves land in the same second
      // and the comparison would be false — the very first background change
      // to a legacy conversation would go unreported.
      //
      // COALESCE, so this is a no-op for any row that already has a
      // watermark: a background save must never mark a conversation read.
      //
      // Keep prose OUT of the SQL below. A stray backtick in a comment inside
      // a template literal silently truncates the statement, and the driver
      // fails by aborting the process rather than raising — an unreadable
      // crash a long way from the typo. Verified the hard way.
      const viewingFlag = viewing ? 1 : 0;
      db.run(
        `INSERT INTO content_outputs (id, user_id, workflow_id, tool_id, content, is_shareable, content_type, conversation_id, title, last_read_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           workflow_id = excluded.workflow_id,
           tool_id = excluded.tool_id,
           content = excluded.content,
           is_shareable = excluded.is_shareable,
           content_type = excluded.content_type,
           conversation_id = excluded.conversation_id,
           title = excluded.title,
           last_read_at = CASE WHEN ?
             THEN CURRENT_TIMESTAMP
             ELSE COALESCE(content_outputs.last_read_at, datetime(content_outputs.updated_at, '-1 second'))
           END,
           updated_at = CURRENT_TIMESTAMP`,
        [id, userId, workflowId || null, toolId || null, content, isShareable ? 1 : 0, contentType, conversationId, title, viewingFlag, viewingFlag],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        }
      );
    });
  }

  /**
   * One row's list metadata — everything the sidebar needs, WITHOUT the
   * content column (average ~0.5MB, max ~28MB on a real install). This is
   * what a save hands back to its caller and broadcasts to other tabs, so a
   * single changed conversation costs one small row, not a refetch of the
   * user's entire history. That refetch-the-world-per-save pattern is what
   * starved conversation loads while agents were streaming.
   */
  static findMetaById(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT ${LIST_COLUMNS} FROM content_outputs WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
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
      const listColumns = LIST_COLUMNS;
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
  // NOTE for the three writers below (rename, move, bulk move): each bumps
  // updated_at, and each is something the USER just did. Without carrying the
  // watermark forward, renaming your own conversation would light its own
  // "needs you" dot. They stamp last_read_at in the same statement so the
  // derived-unread relation stays false across an action you performed.
  static updateTitle(id, userId, title) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE content_outputs SET title = ?, updated_at = CURRENT_TIMESTAMP, last_read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
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
        'UPDATE content_outputs SET group_id = ?, updated_at = CURRENT_TIMESTAMP, last_read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
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
        `UPDATE content_outputs SET group_id = ?, updated_at = CURRENT_TIMESTAMP, last_read_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND user_id = ?`,
        [groupId || null, ...ids, userId],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  /**
   * Set the read watermark.
   *
   * `read = true`  -> last_read_at = now, and updated_at is NOT touched.
   *                   Reading is not a change to the conversation, and since
   *                   unread is derived as updated_at > last_read_at,
   *                   bumping updated_at here would immediately un-read the
   *                   read.
   *
   * `read = false` -> updated_at = now AND last_read_at = one second earlier.
   *
   * WHY MARK-AS-UNREAD MOVES updated_at
   * -----------------------------------
   * The sidebar orders conversations by last activity, and marking one unread
   * IS activity — the user just deliberately queued it for later. Writing
   * only the watermark left the row carrying its ORIGINAL updated_at, so the
   * conversation announced "unread" while sitting at a position that said
   * "nothing has happened here since last month". Worse, the two disagreed
   * visibly: the moment the user clicked it, the unread flag cleared and the
   * row dropped back down to wherever that stale date put it — the item
   * vanished out from under the cursor that had just reached it.
   *
   * Position and state now come from the same fact. Note this is the same
   * rule rename and move already follow (both bump updated_at because both
   * are things the user did); mark-unread is simply the case where the user's
   * action is ALSO meant to leave the conversation flagged.
   *
   * THE ONE-SECOND GAP is what keeps it derivably unread. Both values come
   * from the same statement, and SQLite evaluates CURRENT_TIMESTAMP once per
   * statement, so the gap is exactly one second — never zero. That matters
   * because these timestamps are second-resolution: writing both as plain
   * CURRENT_TIMESTAMP would tie, `updated_at > last_read_at` would be false,
   * and "Mark as Unread" would silently do nothing. Verified empirically
   * across 200 consecutive statements: zero ties.
   */
  static setReadState(id, userId, read) {
    return new Promise((resolve, reject) => {
      const sql = read
        ? 'UPDATE content_outputs SET last_read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
        : "UPDATE content_outputs SET updated_at = CURRENT_TIMESTAMP, last_read_at = datetime(CURRENT_TIMESTAMP, '-1 second') WHERE id = ? AND user_id = ?";
      db.run(sql, [id, userId], function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
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
           AND last_read_at IS NOT NULL
           AND updated_at > last_read_at${scopeClause}`,
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
