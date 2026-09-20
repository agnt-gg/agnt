import { createHash } from 'node:crypto';
export const personalScopeId = userId => 'personal:' + createHash('sha256').update(userId).digest('hex');
/** Run on a dedicated connection during migration, before accepting application writes. */
export async function initializeOwnershipSchema(repository, resources, { withinTransaction = false } = {}) {
  const identifiers = /^[a-z][a-z0-9_]*$/;
  for (const resource of resources) {
    if (!identifiers.test(resource.table) || !identifiers.test(resource.ownerColumn)) throw new TypeError('Invalid ownership descriptor');
  }
  if (!withinTransaction) await repository.run('BEGIN IMMEDIATE');
  try {
    await repository.run(`CREATE TABLE IF NOT EXISTS ownership_scopes(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('personal','team','workspace','system')),
      owner_user_id TEXT, team_id TEXT, parent_scope_id TEXT REFERENCES ownership_scopes(id),
      CHECK((kind='personal' AND owner_user_id IS NOT NULL AND team_id IS NULL) OR
            (kind IN ('team','workspace') AND owner_user_id IS NULL AND team_id IS NOT NULL) OR
            (kind='system' AND owner_user_id IS NULL AND team_id IS NULL)))`);
    await repository.run(`CREATE TABLE IF NOT EXISTS ownership_resource_types(
      table_name TEXT PRIMARY KEY, owner_column TEXT NOT NULL, migration_complete INTEGER NOT NULL DEFAULT 0)`);
    for (const {table,ownerColumn} of resources) {
      const columns = await repository.all(`PRAGMA table_info("${table}")`);
      if (!columns.some(column=>column.name===ownerColumn)) throw new Error(`Missing ownership column: ${table}.${ownerColumn}`);
      if (!columns.some(column=>column.name==='scope_id')) await repository.run(`ALTER TABLE "${table}" ADD COLUMN scope_id TEXT REFERENCES ownership_scopes(id)`);
      const owners = await repository.all(`SELECT DISTINCT "${ownerColumn}" AS owner FROM "${table}" WHERE scope_id IS NULL`);
      for (const {owner} of owners) {
        // Unknown owners must be explicitly classified; never silently make them team-visible.
        if (owner === null && table === 'skills') {await repository.run("INSERT OR IGNORE INTO ownership_scopes(id,kind) VALUES('system:builtins','system')");await repository.run("UPDATE skills SET scope_id='system:builtins' WHERE user_id IS NULL AND scope_id IS NULL");continue;}
        if (typeof owner !== 'string' || !owner) throw new Error(`Unclassified owner in ${table}`);
        const scopeId=personalScopeId(owner);
        await repository.run("INSERT OR IGNORE INTO ownership_scopes(id,kind,owner_user_id) VALUES(?,'personal',?)",[scopeId,owner]);
        await repository.run(`UPDATE "${table}" SET scope_id=? WHERE "${ownerColumn}"=? AND scope_id IS NULL`,[scopeId,owner]);
      }
      await repository.run(`CREATE INDEX IF NOT EXISTS "idx_${table}_scope" ON "${table}"(scope_id)`);
      await repository.run('INSERT INTO ownership_resource_types(table_name,owner_column,migration_complete) VALUES(?,?,1) ON CONFLICT(table_name) DO UPDATE SET migration_complete=1',[table,ownerColumn]);
    }
    if (!withinTransaction) await repository.run('COMMIT');
  } catch(error) { if (!withinTransaction) await repository.run('ROLLBACK'); throw error; }
}
