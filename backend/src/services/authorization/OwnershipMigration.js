import {initializeOwnershipSchema} from './OwnershipSchema.js';
import {inspectOwnershipInventory} from './OwnershipInventory.js';

/**
 * Where a child row goes when its parent no longer exists.
 *
 * Real databases have them: SQLite enforces foreign keys only on connections
 * that ask, the app's never did, so deleting a goal left its evaluations, a
 * workflow its versions, and so on. Measured on the fleet: 3 of 5 tenants, and
 * 710 rows in one long-lived desktop install. Refusing to migrate them made the
 * server answer 503 forever on every such database.
 *
 * They are not deleted: most of these foreign keys are NO ACTION and other
 * tables still point at some of the rows, and a startup migration must not
 * destroy data. They are filed under a `system` scope, which
 * ResourceAuthorization refuses to every user, so they stay exactly as
 * unreachable as they already were (their parent is gone) while every row
 * still has a scope. Their own children inherit it.
 */
export const ORPHANED_SCOPE_ID = 'system:orphaned';

/** Offline-only transactional backfill. The caller must close ordinary application writers first. */
export async function migrateOwnership(repository, options = {}){
 const inventory=await inspectOwnershipInventory(repository, options);
 if(!inventory.ready)throw new Error('Ownership inventory has unclassified tables: '+inventory.tables.filter(t=>t.status!=='classified').map(t=>t.table).join(', '));
 await repository.run('BEGIN IMMEDIATE');
 try{
  await initializeOwnershipSchema(repository,inventory.tables.filter(t=>t.kind==='personal'),{withinTransaction:true});
  const inherited=inventory.tables.filter(t=>t.kind==='inherited');
  const completed=new Set(inventory.tables.filter(t=>t.kind==='personal').map(t=>t.table));
  let pending=[...inherited];
  const orphaned={};
  await repository.run("INSERT OR IGNORE INTO ownership_scopes(id,kind) VALUES(?,'system')",[ORPHANED_SCOPE_ID]);
  while(pending.length){
   const next=pending.filter(t=>completed.has(t.parentTable));
   if(!next.length)throw new Error('Unresolved ownership inheritance');
   for(const {table,parentTable,parentColumn} of next){
    const columns=await repository.all(`PRAGMA table_info("${table}")`);
    if(!columns.some(c=>c.name==='scope_id'))await repository.run(`ALTER TABLE "${table}" ADD COLUMN scope_id TEXT REFERENCES ownership_scopes(id)`);
    await repository.run(`UPDATE "${table}" SET scope_id=(SELECT scope_id FROM "${parentTable}" WHERE id="${table}"."${parentColumn}") WHERE scope_id IS NULL`);
    const [{n}]=await repository.all(`SELECT COUNT(*) AS n FROM "${table}" WHERE scope_id IS NULL`);
    if(n){await repository.run(`UPDATE "${table}" SET scope_id=? WHERE scope_id IS NULL`,[ORPHANED_SCOPE_ID]);orphaned[table]=n;}
    await repository.run(`CREATE INDEX IF NOT EXISTS "idx_${table}_scope" ON "${table}"(scope_id)`);
    completed.add(table);
   }
   pending=pending.filter(t=>!completed.has(t.table));
  }
  await repository.run('COMMIT');return{migratedTables:[...completed],orphaned};
 }catch(error){await repository.run('ROLLBACK');throw error;}
}
