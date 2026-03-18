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

      db.run(
        `INSERT OR REPLACE INTO skills (id, user_id, name, description, instructions, license, compatibility, metadata, allowed_tools, icon, category, is_builtin, slug, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [id, userId, name, description, instructions, license, compatibility, metadata, allowedTools, icon, category, isBuiltin, slug],
        function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM skills WHERE id = ?`,
        [id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

export default SkillModel;
