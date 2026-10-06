import db, { dbReady } from '../models/database/index.js';
import { tenantOwnerId } from './auth/tenantOwnership.js';

/**
 * WHO MAY SEE A SKILL THAT LIVES IN A FOLDER.
 *
 * Database skills carry a user_id and were always scoped. Folder skills —
 * ~/.agnt/skills, ~/.claude/skills, ~/.hermes/skills, a project's .agents/ —
 * are read once per process by SkillDiscoveryService and had no owner at all,
 * so every account on an install listed, searched and activated every one of
 * them. The folders belong to the machine's owner, not to whoever signs in.
 *
 * Rule: AGNT's shipped built-ins are shared (decided by SkillDiscoveryService,
 * which knows where a skill came from). Every other folder skill is visible
 * only to the accounts granted it here.
 *
 * Grants come from two places:
 *   - Writers that put a skill on disk FOR an account (the harness importer)
 *     grant that account before the files land, and mark the name seen.
 *   - Anything else is adopted the first time it is seen: to the accounts that
 *     already own a database skill of that name (the importer always wrote
 *     one), otherwise to the instance's owner. Accounts created later never
 *     inherit a folder skill; they import their own.
 *
 * Unlike PluginAccountStore, legacy skills are NOT spread to every existing
 * account. A desktop users table holds stale, id-less and test rows next to
 * the real one (26 rows, one person, on the machine this was written on), and
 * "everyone who existed" is exactly the leak this closes.
 */
export class SkillFolderAccess {
  constructor(database, databaseReady = Promise.resolve(), { ownerFromEnv = tenantOwnerId } = {}) {
    this.db = database;
    this.databaseReady = databaseReady;
    this.ownerFromEnv = ownerFromEnv;
    this.initializing = null;
    this.seen = null; // Set of adopted names, loaded once, then kept in step with writes.
    this.adoption = Promise.resolve();
  }

  get(sql, params = []) { return new Promise((resolve, reject) => this.db.get(sql, params, (e, row) => e ? reject(e) : resolve(row))); }
  all(sql, params = []) { return new Promise((resolve, reject) => this.db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows || []))); }
  run(sql, params = []) { return new Promise((resolve, reject) => this.db.run(sql, params, function(e) { e ? reject(e) : resolve(this.changes); })); }

  async ready() {
    if (!this.initializing) this.initializing = this.migrate().catch((error) => { this.initializing = null; throw error; });
    return this.initializing;
  }

  async migrate() {
    await (typeof this.databaseReady === 'function' ? this.databaseReady() : this.databaseReady);
    await this.run(`CREATE TABLE IF NOT EXISTS skill_folder_access (
      skill_name TEXT NOT NULL, user_id TEXT NOT NULL, granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(skill_name, user_id))`);
    await this.run('CREATE INDEX IF NOT EXISTS idx_skill_folder_access_user ON skill_folder_access(user_id)');
    await this.run('CREATE TABLE IF NOT EXISTS skill_folder_seen (skill_name TEXT PRIMARY KEY)');
    this.seen = new Set((await this.all('SELECT skill_name FROM skill_folder_seen')).map((r) => r.skill_name));
  }

  /**
   * The account a folder on this machine belongs to.
   * Hosted and self-hosted instances name it (AGNT_TENANT_OWNER, an id or a
   * login email). A desktop has no such setting; its owner is the account that
   * has actually built skills here, oldest first on a tie — not the first row
   * in a table full of test accounts.
   */
  async homeOwner() {
    const configured = String(this.ownerFromEnv() || '').trim();
    if (configured) {
      if (!configured.includes('@')) return configured;
      const row = await this.get('SELECT id FROM users WHERE id IS NOT NULL AND lower(email) = lower(?) LIMIT 1', [configured]);
      return row?.id || null;
    }
    const builder = await this.get(`SELECT s.user_id AS id FROM skills s JOIN users u ON u.id = s.user_id
      WHERE s.user_id IS NOT NULL GROUP BY s.user_id ORDER BY COUNT(*) DESC, MIN(u.created_at) ASC LIMIT 1`).catch(() => null);
    if (builder?.id) return builder.id;
    const oldest = await this.get('SELECT id FROM users WHERE id IS NOT NULL ORDER BY created_at ASC LIMIT 1');
    return oldest?.id || null;
  }

  /** Give every never-seen name its owners. Serialized so concurrent readers adopt once. */
  adoptUnseen(names) {
    this.adoption = this.adoption.catch(() => {}).then(() => this._adoptUnseen(names));
    return this.adoption;
  }

  async _adoptUnseen(names) {
    await this.ready();
    const unseen = [...new Set(names)].filter((name) => name && !this.seen.has(name));
    if (!unseen.length) return;
    let homeOwner;
    for (const name of unseen) {
      const evidence = await this.all(
        // slug only: it is the folder name the importer wrote; display names are free text.
        'SELECT DISTINCT user_id FROM skills WHERE user_id IS NOT NULL AND slug = ?', [name]
      ).catch(() => []);
      let owners = evidence.map((r) => r.user_id);
      if (!owners.length) {
        if (homeOwner === undefined) homeOwner = await this.homeOwner();
        // No account yet: defer rather than record an ownerless verdict.
        if (!homeOwner) continue;
        owners = [homeOwner];
      }
      for (const userId of owners) {
        await this.run('INSERT OR IGNORE INTO skill_folder_access(skill_name, user_id) VALUES(?, ?)', [name, userId]);
      }
      // Marked last, so an interrupted adoption is retried; every write above is idempotent.
      await this.run('INSERT OR IGNORE INTO skill_folder_seen(skill_name) VALUES(?)', [name]);
      this.seen.add(name);
    }
  }

  /** A writer is putting this skill on disk for this account. Seen, so adoption cannot hand it to anyone else. */
  async grant(name, userId) {
    if (!name) throw new Error('A skill grant needs a name');
    if (!userId) throw new Error('A skill grant needs an account');
    await this.ready();
    await this.run('INSERT OR IGNORE INTO skill_folder_access(skill_name, user_id) VALUES(?, ?)', [name, userId]);
    await this.run('INSERT OR IGNORE INTO skill_folder_seen(skill_name) VALUES(?)', [name]);
    this.seen.add(name);
  }

  async revoke(name, userId) {
    await this.ready();
    await this.run('DELETE FROM skill_folder_access WHERE skill_name = ? AND user_id = ?', [name, userId]);
  }

  async owners(name) {
    await this.ready();
    return (await this.all('SELECT user_id FROM skill_folder_access WHERE skill_name = ?', [name])).map((r) => r.user_id);
  }

  /** Every folder skill name this account may see. */
  async namesFor(userId) {
    await this.ready();
    if (!userId) return new Set();
    return new Set((await this.all('SELECT skill_name FROM skill_folder_access WHERE user_id = ?', [userId])).map((r) => r.skill_name));
  }

  async isHomeOwner(userId) {
    await this.ready();
    return !!userId && (await this.homeOwner()) === userId;
  }
}

export default new SkillFolderAccess(db, () => dbReady);
