import {initializeOwnershipSchema} from './OwnershipSchema.js';
import {inspectOwnershipInventory} from './OwnershipInventory.js';
/** Offline-only transactional backfill. The caller must close ordinary application writers first. */
export async function migrateOwnership(repository){
 const inventory=await inspectOwnershipInventory(repository);
 if(!inventory.ready)throw new Error('Ownership inventory has unclassified tables: '+inventory.tables.filter(t=>t.status!=='classified').map(t=>t.table).join(', '));
 await repository.run('BEGIN IMMEDIATE');
 try{
  await initializeOwnershipSchema(repository,inventory.tables.filter(t=>t.kind==='personal'),{withinTransaction:true});
  const inherited=inventory.tables.filter(t=>t.kind==='inherited');
  const completed=new Set(inventory.tables.filter(t=>t.kind==='personal').map(t=>t.table));
  let pending=[...inherited];
  while(pending.length){
   const next=pending.filter(t=>completed.has(t.parentTable));
   if(!next.length)throw new Error('Unresolved ownership inheritance');
   for(const {table,parentTable,parentColumn} of next){
    const columns=await repository.all(`PRAGMA table_info("${table}")`);
    if(!columns.some(c=>c.name==='scope_id'))await repository.run(`ALTER TABLE "${table}" ADD COLUMN scope_id TEXT REFERENCES ownership_scopes(id)`);
    await repository.run(`UPDATE "${table}" SET scope_id=(SELECT scope_id FROM "${parentTable}" WHERE id="${table}"."${parentColumn}") WHERE scope_id IS NULL`);
    const missing=await repository.all(`SELECT 1 FROM "${table}" WHERE scope_id IS NULL LIMIT 1`);if(missing.length)throw new Error('Orphan resource in '+table);
    await repository.run(`CREATE INDEX IF NOT EXISTS "idx_${table}_scope" ON "${table}"(scope_id)`);
    completed.add(table);
   }
   pending=pending.filter(t=>!completed.has(t.table));
  }
  await repository.run('COMMIT');return{migratedTables:[...completed]};
 }catch(error){await repository.run('ROLLBACK');throw error;}
}
