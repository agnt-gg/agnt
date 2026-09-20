import {personalScopeId} from './OwnershipSchema.js';
/** Keep scope assignment in SQLite so HTTP, jobs, plugins and direct model calls agree. */
export async function installOwnershipTriggers(repository, inventory){
 await repository.run('CREATE TABLE IF NOT EXISTS scope_resource_owners(scope_id TEXT PRIMARY KEY REFERENCES ownership_scopes(id),user_id TEXT UNIQUE NOT NULL REFERENCES users(id))');
 await repository.run('CREATE TABLE IF NOT EXISTS scope_api_audit(id INTEGER PRIMARY KEY,scope_id TEXT,actor_id TEXT,action TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 await repository.run("INSERT OR IGNORE INTO ownership_scopes(id,kind) VALUES('system:builtins','system')");
 const users=await repository.all('SELECT id FROM users');
 for(const {id} of users)await repository.run("INSERT OR IGNORE INTO ownership_scopes(id,kind,owner_user_id) VALUES(?,'personal',?)",[personalScopeId(id),id]);
 // New personal users use an equally unique, non-hashed scope; existing backfilled scopes stay stable.
 await repository.run(`CREATE TRIGGER IF NOT EXISTS ownership_new_user AFTER INSERT ON users BEGIN
 INSERT OR IGNORE INTO ownership_scopes(id,kind,owner_user_id) VALUES('user:'||NEW.id,'personal',NEW.id); END`);
 for(const descriptor of inventory.filter(d=>['personal','inherited'].includes(d.kind))){
  const {table,ownerColumn,parentColumn,parentTable}=descriptor;
  const columns=await repository.all(`PRAGMA table_info("${table}")`);
  if(!columns.some(c=>c.name==='scope_id'))continue;
  const inherited=descriptor.kind==='inherited';
  const assignment=inherited?`(SELECT scope_id FROM "${parentTable}" WHERE id=NEW."${parentColumn}")`:
   `COALESCE((SELECT scope_id FROM scope_resource_owners WHERE user_id=NEW."${ownerColumn}"),(SELECT id FROM ownership_scopes WHERE kind='personal' AND owner_user_id=NEW."${ownerColumn}" LIMIT 1),CASE WHEN NEW."${ownerColumn}" IS NULL THEN 'system:builtins' END)`;
  if(inherited)await repository.run(`CREATE TRIGGER IF NOT EXISTS "scope_parent_${table}" BEFORE UPDATE OF "${parentColumn}" ON "${table}" WHEN OLD."${parentColumn}" IS NOT NEW."${parentColumn}" BEGIN SELECT RAISE(ABORT,'Resource parent is immutable'); END`);
  if(!inherited)await repository.run(`CREATE TRIGGER IF NOT EXISTS "scope_owner_${table}" BEFORE UPDATE OF "${ownerColumn}" ON "${table}" WHEN OLD."${ownerColumn}" IS NOT NEW."${ownerColumn}" BEGIN SELECT RAISE(ABORT,'Resource owner is immutable'); END`);
  await repository.run(`CREATE TRIGGER IF NOT EXISTS "scope_insert_${table}" AFTER INSERT ON "${table}" BEGIN
    SELECT CASE WHEN NEW.scope_id IS NOT NULL AND NEW.scope_id IS NOT ${assignment} THEN RAISE(ABORT,'Resource scope mismatch') END;
    UPDATE "${table}" SET scope_id=${assignment} WHERE rowid=NEW.rowid AND scope_id IS NULL;
    SELECT CASE WHEN (SELECT scope_id FROM "${table}" WHERE rowid=NEW.rowid) IS NULL THEN RAISE(ABORT,'Resource scope unresolved') END; END`);
  await repository.run(`CREATE TRIGGER IF NOT EXISTS "scope_update_${table}" BEFORE UPDATE OF scope_id ON "${table}" WHEN OLD.scope_id IS NOT NULL AND OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Resource scope is immutable'); END`);
 }
}
