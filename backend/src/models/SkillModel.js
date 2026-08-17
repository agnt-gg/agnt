import db from './database/index.js';

class SkillModel {
  static findAll(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skills WHERE user_id = ? OR is_builtin = 1 ORDER BY updated_at DESC`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM skills WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  static findBySlug(slug) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM skills WHERE slug = ?`, [slug], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  static findByIds(ids) {
    if (!ids || ids.length === 0) return Promise.resolve([]);
    const placeholders = ids.map(() => '?').join(',');
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM skills WHERE id IN (${placeholders})`,
        ids,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Normalize a value to a JSON string for DB storage.
   * Handles: objects/arrays → JSON.stringify, valid JSON strings → passthrough,
   * space-delimited strings → JSON array, empty/null → fallback.
   */
  static _normalizeJson(value, fallback = '{}', arrayMode = false) {
    if (value === null || value === undefined || value === '') return fallback;

    // Already an object or array — stringify it
    if (typeof value === 'object') return JSON.stringify(value);

    // String — check if it's already valid JSON
    if (typeof value === 'string') {
      const trimmed = value.trim();

      // Detect garbage strings from broken serialization
      if (trimmed === '[object Object]' || trimmed === 'undefined' || trimmed === 'null') {
        return fallback;
      }

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { JSON.parse(trimmed); return trimmed; } catch { return fallback; }
      }
      // Space-delimited string (e.g. "file_operations execute_shell_command") → JSON array
      if (arrayMode && trimmed.length > 0) {
        return JSON.stringify(trimmed.split(/\s+/));
      }
      // Non-JSON string in non-array mode — not valid for metadata, return fallback
      return fallback;
    }

    return fallback;
  }

  static createOrUpdate(id, skill, userId) {
    return new Promise((resolve, reject) => {
      // Accept both camelCase (JS) and snake_case (DB row spread) property names
      const name = skill.name;
      const description = skill.description;
      const instructions = skill.instructions || '';
      const license = skill.license || '';
      const compatibility = skill.compatibility || '';
      const icon = skill.icon && skill.icon.startsWith('fa') ? skill.icon : 'fas fa-puzzle-piece';
      const category = skill.category || 'general';
      const isBuiltin = skill.isBuiltin ?? skill.is_builtin ?? 0;
      const slug = skill.slug || null;

      // Normalize metadata: always store as JSON object string
      const metadata = SkillModel._normalizeJson(
        skill.metadata, '{}', false
      );

      // Normalize allowedTools: always store as JSON array string
      // Accept: allowedTools (camelCase), allowed_tools (snake_case from DB row)
      const allowedTools = SkillModel._normalizeJson(
        skill.allowedTools ?? skill.allowed_tools, '[]', true
      );

      /**
       * UPSERT, not INSERT OR REPLACE. See AgentModel.createOrUpdate for the
       * full reasoning; the same defect lived here.
       *
       * `INSERT OR REPLACE` DELETEs the conflicting row and inserts a new one,
       * so every column this statement does not name reverted to its schema
       * DEFAULT: created_at, source_plugin and is_user_modified.
       *
       * That was worse here than a lost timestamp, because of the order
       * SkillService.updateSkill uses — it sets the PRD-057 flag BEFORE it
       * saves, so the save erased the flag it had just been told to set. The
       * flag is what PluginAssetLoader._decideUpdate reads to decide whether a
       * plugin upgrade may overwrite the row, so a user's edits to a
       * plugin-installed skill were silently discarded by the next upgrade.
       *
       * user_id is deliberately absent from the SET list: an edit must not
       * transfer ownership. SkillService.updateSkill looks the row up with an
       * unscoped findById and passes the REQUESTER's id, so rewriting user_id
       * handed the row to whoever edited it. (The remaining authorization gap —
       * that a non-owner can edit the contents at all — belongs to
       * SkillService, not here.)
       *
       * Guarded by SkillModel.provenance.test.js, whose last test enumerates the
       * live schema and fails when a new column is unaccounted for.
       */
      db.run(
        `INSERT INTO skills (id, user_id, name, description, instructions, license, compatibility, metadata, allowed_tools, icon, category, is_builtin, slug, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             instructions = excluded.instructions,
             license = excluded.license,
             compatibility = excluded.compatibility,
             metadata = excluded.metadata,
             allowed_tools = excluded.allowed_tools,
             icon = excluded.icon,
             category = excluded.category,
             is_builtin = excluded.is_builtin,
             slug = excluded.slug,
             updated_at = datetime('now')`,
        [id, userId, name, description, instructions, license, compatibility, metadata, allowedTools, icon, category, isBuiltin, slug],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        }
      );
    });
  }

  /**
   * Delete a skill the caller owns.
   *
   * This has always taken (id, userId) and, until now, never used userId — the
   * statement was `DELETE FROM skills WHERE id = ?`, so it deleted anybody's
   * row. SkillService.deleteSkill reads `changes === 0` as "not yours" and
   * answers 404, which is only sound if the statement is scoped; unscoped, it
   * returned 1 for any caller and the 404 branch could only mean "no such row".
   * A hard DELETE with no soft-delete column to recover from, unlike
   * AgentModel.delete, which is both scoped and soft.
   *
   * Scoping it here makes the signature honest for every caller, present and
   * future. SkillEvolver (the only other caller) deletes a draft it created
   * itself under the same userId, so this is a no-op for it.
   */
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM skills WHERE id = ? AND user_id = ?`,
        [id, userId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

export default SkillModel;
