import db from './database/index.js';

// The metadata column set every list/meta read shares. ONE definition: the
// sidebar list, the save response, and the realtime broadcast must all carry
// the same shape, or the row a client patches in place diverges from the row
// a full fetch would have given it. Excludes the large content column.
const LIST_COLUMNS = 'id, user_id, workflow_id, tool_id, content_type, conversation_id, title, is_shareable, group_id, last_read_at, archived_at, channel_key, created_at, updated_at';

class ContentOutputModel {
  /**
   * @param {{ channelKey?: string|null }} [opts]
   *   channelKey: this row belongs to an embedded chat channel
   *   ('workspace:<id>', 'artifact:<id>', ...) rather than to the main chat
   *   list. Sticky once set — see the COALESCE in the conflict clause.
   *
   * SAVES NEVER MARK READ — the email model. A save records that the
   * conversation CHANGED (updated_at moves); the read watermark moves only
   * when the user explicitly opens or clears the conversation (setReadState,
   * via the read PATCH). There used to be a `viewing` flag here that let the
   * client stamp the watermark atomically with a save ("I'm looking at it");
   * it meant a finished run in the selected conversation was born read — no
   * dot, no chime — even when the user was on another screen entirely.
   * Selection is not attention, so the attestation was unverifiable and
   * wrong; it is gone. Noise-control for the ~5s stream autosaves lives
   * client-side, where streaming conversations are excluded from the chime
   * until the run completes (notifiableUnreadIds).
   */
  static createOrUpdate(id, userId, workflowId, toolId, content, isShareable, contentType = 'html', conversationId = null, title = null, { channelKey = null } = {}) {
    return new Promise((resolve, reject) => {
      // Use UPSERT (not INSERT OR REPLACE) so columns we don't touch — like group_id —
      // aren't wiped back to their defaults on every save.
      //
      // THE last_read_at CLAUSE. Unread is derived as
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
      //
      // THE channel_key CLAUSE. COALESCE, so scope is STICKY: a save that does
      // not mention a channel can never silently un-scope a row and drop it
      // back into the main chat list. There is no legitimate un-scope, and the
      // failure mode of getting this wrong is the original bug returning.
      db.run(
        `INSERT INTO content_outputs (id, user_id, workflow_id, tool_id, content, is_shareable, content_type, conversation_id, title, channel_key, last_read_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           workflow_id = excluded.workflow_id,
           tool_id = excluded.tool_id,
           content = excluded.content,
           is_shareable = excluded.is_shareable,
           content_type = excluded.content_type,
           conversation_id = excluded.conversation_id,
           title = excluded.title,
           channel_key = COALESCE(excluded.channel_key, content_outputs.channel_key),
           last_read_at = COALESCE(content_outputs.last_read_at, datetime(content_outputs.updated_at, '-1 second')),
           updated_at = CURRENT_TIMESTAMP`,
        [id, userId, workflowId || null, toolId || null, content, isShareable ? 1 : 0, contentType, conversationId, title, channelKey || null],
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
      // channel_key IS NULL: the main chat list shows the user's OWN
      // conversations, not the transcripts of chats embedded in a workspace,
      // artifact, widget or workflow. Those are reachable from the surface
      // they belong to (and still searchable), but they are not items in this
      // list. Filtered in SQL so the exclusion also applies to the row COUNT
      // and to pagination — a client-side filter would silently shrink pages.
      let where = 'user_id = ? AND channel_key IS NULL';
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
   * `read = true`  -> last_read_at = now, and updated_at moves too — but ONLY
   *                   on a genuine unread→read transition. Reading a days-old
   *                   unread is the user finally getting to it, i.e. the
   *                   strongest "last activity" signal there is; leaving the
   *                   stale save date made the row teleport DOWN the
   *                   activity-sorted list the moment it was clicked —
   *                   clearing your queue demoted the very thing you just
   *                   engaged with. Opening an already-read conversation
   *                   stays a strict no-op on updated_at (the read PATCH
   *                   fires on EVERY open, and browsing must not shuffle the
   *                   list). Both columns come from the same statement's
   *                   CURRENT_TIMESTAMP, so they TIE — and a tie derives
   *                   read, because unread requires strictly greater.
   *                   (Mark-all-read follows the SAME rule — see markAllRead.)
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
      // The CASE predicate is the same unread derivation the client uses
      // (conversationAttention.js): archived or never-watermarked rows are
      // not unread, so reading them re-dates nothing.
      const sql = read
        ? `UPDATE content_outputs SET
             updated_at = CASE WHEN archived_at IS NULL AND last_read_at IS NOT NULL AND updated_at > last_read_at
               THEN CURRENT_TIMESTAMP ELSE updated_at END,
             last_read_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ?`
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
   * count of what was actually cleared. updated_at moves WITH the watermark
   * — ONE rule for every read/unread interaction: acting on a conversation
   * re-dates it. This shipped as "janitorial, so don't re-date" and Nathan
   * lost his chats within the hour: the cleared rows snapped back to their
   * stale dates and scattered down the list. Rows keeping their just-cleared
   * positions (all dated the same second, at the top) is the behaviour that
   * matches what the user's eyes were on when they pressed the button.
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
        `UPDATE content_outputs SET updated_at = CURRENT_TIMESTAMP, last_read_at = CURRENT_TIMESTAMP
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

  /**
   * Assign (or clear) a row's owning chat channel.
   *
   * Deliberately does NOT touch updated_at or last_read_at: recording who owns
   * a row is bookkeeping, not something the user did to the conversation.
   * Bumping either would reorder the sidebar and light unread dots during the
   * one-time repair sweep.
   */
  static setChannelKey(id, userId, channelKey) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE content_outputs SET channel_key = ? WHERE id = ? AND user_id = ?',
        [channelKey || null, id, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * THE CANONICAL ROW FOR A CONVERSATION.
   *
   * `conversation_id` has no unique constraint, and for most of this table's
   * life nothing enforced one row per conversation: dedupe happened only on
   * the output `id`, which lives in a single tab's memory. So a conversation
   * opened in a second browser saved itself as a SECOND row, and the sidebar
   * showed one chat three times.
   *
   * Saving now reuses this row (see RunService.saveOrUpdateContentOutput), so
   * new duplicates are not created. Rows that already exist still need a
   * deterministic WINNER, because `db.get` with no ORDER BY returns whichever
   * row SQLite happens to visit first — which is how a client could open a
   * 1KB stub of a conversation whose full 74KB transcript sat in the next row.
   *
   * Longest content wins. A transcript only grows during a conversation, so
   * the longest row is the most complete one; `updated_at` would pick the most
   * RECENTLY TOUCHED row, which can easily be a stub saved by a tab that
   * joined at the end. Recency breaks ties.
   */
  static findByConversationId(conversationId, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM content_outputs
         WHERE conversation_id = ? AND user_id = ?
         ORDER BY LENGTH(COALESCE(content, '')) DESC, updated_at DESC, id ASC
         LIMIT 1`,
        [conversationId, userId],
        (err, output) => {
          if (err) reject(err);
          else resolve(output);
        }
      );
    });
  }

  /**
   * The same canonical pick, WITHOUT the content column.
   *
   * Used on the save path purely to answer "does a row already exist, and is
   * it mine?". `findOne` selects *, so using it there read an entire
   * transcript (~0.5MB typical, ~28MB worst case on a real install) off disk
   * on every ~5s autosave just to look at two identity columns.
   */
  static findMetaByConversationId(conversationId, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT ${LIST_COLUMNS} FROM content_outputs
         WHERE conversation_id = ? AND user_id = ?
         ORDER BY LENGTH(COALESCE(content, '')) DESC, updated_at DESC, id ASC
         LIMIT 1`,
        [conversationId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /** Identity of one row — ownership check on the save path, no content read. */
  static findIdentityById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, user_id, conversation_id FROM content_outputs WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * How much transcript a row currently holds — WITHOUT transferring it.
   *
   * The save path needs to know "am I about to make this conversation
   * smaller?", and it needs to know it on every ~5s autosave. Reading the
   * content column to count messages would pull a multi-MB string off disk
   * and through the driver every time, which is exactly the cost
   * findMetaByConversationId was written to avoid.
   *
   * json_array_length() counts inside SQLite and returns one integer.
   * LENGTH() likewise. Neither materialises the blob in JS.
   *
   * Returns null message_count for anything that is not a JSON object with a
   * `messages` array (html outputs, legacy rows, corrupt content). Null means
   * UNKNOWN, and callers must treat unknown as "cannot judge" rather than as
   * zero — a guard that reads "corrupt" as "empty" would authorise the very
   * overwrite it exists to prevent.
   */
  static transcriptStatsById(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
           id,
           LENGTH(COALESCE(content, ''))                                    AS content_length,
           CASE WHEN json_valid(content)
                THEN json_array_length(json_extract(content, '$.messages'))
                ELSE NULL END                                              AS message_count
         FROM content_outputs WHERE id = ?`,
        [id],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else resolve({
            id: row.id,
            contentLength: row.content_length || 0,
            // json_array_length yields NULL when the path is absent, which the
            // driver surfaces as null/undefined — normalise both to null.
            messageCount: row.message_count === null || row.message_count === undefined
              ? null
              : Number(row.message_count),
          });
        }
      );
    });
  }
}

export default ContentOutputModel;
