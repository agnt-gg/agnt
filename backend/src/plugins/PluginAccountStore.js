import db, { dbReady } from '../models/database/index.js';

/** Installation is an account entitlement; the executable package is only a host cache.
 * Legacy ownership comes from asset rows; otherwise a pre-account package keeps the
 * visibility it already had: every account that existed when it was first seen.
 * Accounts created later never inherit it. */
export class PluginAccountStore {
  constructor(database, databaseReady = Promise.resolve()) { this.db = database; this.databaseReady = databaseReady; this.initializing = null; }
  get(sql, params = []) { return new Promise((resolve, reject) => this.db.get(sql, params, (e, row) => e ? reject(e) : resolve(row))); }
  all(sql, params = []) { return new Promise((resolve, reject) => this.db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows || []))); }
  run(sql, params = []) { return new Promise((resolve, reject) => this.db.run(sql, params, function(e) { e ? reject(e) : resolve(this.changes); })); }
  async ready() {
    if (!this.initializing) this.initializing = this.migrate().catch(error => { this.initializing = null; throw error; });
    return this.initializing;
  }
  async migrate() {
    await (typeof this.databaseReady === 'function' ? this.databaseReady() : this.databaseReady);
    await this.run(`CREATE TABLE IF NOT EXISTS plugin_account_installs (
      plugin_name TEXT NOT NULL, user_id TEXT NOT NULL, installed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(plugin_name, user_id))`);
    await this.run('CREATE TABLE IF NOT EXISTS plugin_account_legacy_seen (plugin_name TEXT PRIMARY KEY)');
    const columns = await this.all('PRAGMA table_info(installed_plugin_assets)');
    if (!columns.length || columns.some(c => c.name === 'user_id')) return;
    // One SQL transaction; old rows and keys survive any failed migration.
    await this.run('BEGIN IMMEDIATE');
    try {
      // Another process may have completed the migration while BEGIN was waiting.
      const lockedColumns = await this.all('PRAGMA table_info(installed_plugin_assets)');
      if (lockedColumns.some(c => c.name === 'user_id')) { await this.run('COMMIT'); return; }
      await this.run(`CREATE TABLE installed_plugin_assets_scoped (
        id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_name TEXT NOT NULL, plugin_version TEXT NOT NULL,
        asset_type TEXT NOT NULL, asset_slug TEXT NOT NULL, local_id TEXT NOT NULL,
        installed_at DATETIME DEFAULT CURRENT_TIMESTAMP, deprecated_at DATETIME, user_id TEXT,
        UNIQUE(plugin_name, asset_type, asset_slug, user_id))`);
      await this.run(`INSERT INTO installed_plugin_assets_scoped(id,plugin_name,plugin_version,asset_type,asset_slug,local_id,installed_at,deprecated_at)
        SELECT id,plugin_name,plugin_version,asset_type,asset_slug,local_id,installed_at,deprecated_at FROM installed_plugin_assets`);
      for (const [type, table] of Object.entries({ agent: 'agents', workflow: 'workflows', skill: 'skills', widget: 'widget_definitions' })) {
        const exists = await this.get('SELECT name FROM sqlite_master WHERE type=? AND name=?', ['table', table]);
        if (exists) {
          const fields = await this.all(`PRAGMA table_info(${table})`);
          const owner = fields.some(c => c.name === 'created_by') ? 'created_by' : 'user_id';
          await this.run(`UPDATE installed_plugin_assets_scoped SET user_id=(SELECT ${owner} FROM ${table} WHERE id=local_id) WHERE asset_type=?`, [type]);
        }
      }
      await this.run(`INSERT OR IGNORE INTO plugin_account_installs(plugin_name,user_id)
        SELECT DISTINCT plugin_name,user_id FROM installed_plugin_assets_scoped WHERE user_id IS NOT NULL`);
      await this.run(`UPDATE installed_plugin_assets_scoped SET user_id=(SELECT MIN(user_id) FROM plugin_account_installs p WHERE p.plugin_name=installed_plugin_assets_scoped.plugin_name)
        WHERE user_id IS NULL AND (SELECT COUNT(*) FROM plugin_account_installs p WHERE p.plugin_name=installed_plugin_assets_scoped.plugin_name)=1`);
      await this.run('DROP TABLE installed_plugin_assets');
      await this.run('ALTER TABLE installed_plugin_assets_scoped RENAME TO installed_plugin_assets');
      await this.run('CREATE INDEX idx_installed_plugin_assets_plugin ON installed_plugin_assets(plugin_name,user_id)');
      await this.run('CREATE INDEX idx_installed_plugin_assets_local ON installed_plugin_assets(asset_type,local_id)');
      await this.run('COMMIT');
    } catch (error) { await this.run('ROLLBACK'); throw error; }
  }
  async adoptLegacy(pluginName) {
    await this.ready();
    if (await this.get('SELECT plugin_name FROM plugin_account_legacy_seen WHERE plugin_name=?', [pluginName])) return;
    if (!(await this.owners(pluginName)).length) {
      // Before accounts, every account on this host could use every package. A migration
      // must not silently revoke that: a single-user desktop DB routinely holds stale and
      // test rows, and a "sole account" rule stranded whole plugin libraries.
      // One set-based statement: first boot adopts every package, so per-row commits are
      // a boot-time cost multiplied by plugins x accounts.
      const granted = await this.run(`INSERT OR IGNORE INTO plugin_account_installs(plugin_name,user_id)
        SELECT ?, id FROM users WHERE id IS NOT NULL`, [pluginName]);
      // No account yet: defer the decision rather than recording an ownerless verdict.
      if (!granted) return;
      if (granted === 1) await this.run(`UPDATE installed_plugin_assets SET user_id=(SELECT user_id FROM plugin_account_installs WHERE plugin_name=?)
        WHERE plugin_name=? AND user_id IS NULL`, [pluginName, pluginName]);
    }
    // Marked last, so an interrupted adoption is retried; every write above is idempotent.
    await this.run('INSERT OR IGNORE INTO plugin_account_legacy_seen(plugin_name) VALUES(?)', [pluginName]);
  }
  async owners(pluginName) { await this.ready(); return (await this.all('SELECT user_id FROM plugin_account_installs WHERE plugin_name=?', [pluginName])).map(r => r.user_id); }
  async names(userId) { await this.ready(); if (!userId) return []; return (await this.all('SELECT plugin_name FROM plugin_account_installs WHERE user_id=?', [userId])).map(r => r.plugin_name); }
  async has(pluginName, userId) { return !!userId && (await this.owners(pluginName)).includes(userId); }
  async assert(pluginName, userId) { if (!(await this.has(pluginName, userId))) { const error = new Error('Plugin is not installed for this account'); error.status = 404; throw error; } }
  async add(pluginName, userId) { await this.ready(); if (!userId) throw new Error('Plugin install requires an account'); await this.run('INSERT OR IGNORE INTO plugin_account_installs(plugin_name,user_id) VALUES(?,?)', [pluginName,userId]); }
  async remove(pluginName, userId) { await this.ready(); await this.run('DELETE FROM plugin_account_installs WHERE plugin_name=? AND user_id=?', [pluginName,userId]); }
  async filter(rows, userId, name = row => row.name) { const owned = new Set(await this.names(userId)); return rows.filter(row => owned.has(name(row))); }
}
export default new PluginAccountStore(db, () => dbReady);
