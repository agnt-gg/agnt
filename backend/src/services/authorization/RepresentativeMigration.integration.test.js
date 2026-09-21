import {it,expect} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';
import db,{dbReady} from '../../models/database/index.js';
import {databaseRepository} from './ScopeRepository.js';
import {migrateOwnership} from './OwnershipMigration.js';
import {inspectOwnershipInventory,OWNERSHIP_INVENTORY} from './OwnershipInventory.js';
import {installOwnershipTriggers} from './OwnershipTriggers.js';

/**
 * Representative existing database: the REAL consolidated schema produced by
 * models/database/index.js (every table, index, FTS mirror and migration the
 * shipping product creates), populated with multi-user rows, plus optional
 * plugin tables of both ownership kinds. A hand-built fixture would not prove
 * the migration survives the schema customers actually have.
 */
it('migrates the real initialized schema with populated multi-user and plugin rows, and restores its pre-migration backup',async()=>{
 await dbReady;const r=databaseRepository(db);
 const backup=path.join(await fs.mkdtemp(path.join(process.env.AGNT_HOME||process.env.TEMP||'.','agnt-representative-')),'pre-migration.db');

 // Two real accounts with resources across the owner-column families.
 for (const [id,name] of [['legacy-alice','Alice'],['legacy-bob','Bob']]) await r.run('INSERT INTO users(id,name) VALUES(?,?)',[id,name]);
 await r.run("INSERT INTO agents(id,name,description,status,icon,category,tools,workflows,provider,model,created_by,system_prompt,skills) VALUES('rep-agent','Agent','d','active','i','c','[]','[]','groq','m','legacy-alice','p','[]')");
 await r.run("INSERT INTO workflows(id,workflow_data,user_id) VALUES('rep-workflow','{\"nodes\":[],\"edges\":[]}','legacy-alice')");
 await r.run("INSERT INTO workflow_versions(workflow_id,version_number,workflow_state,created_by) VALUES('rep-workflow',1,'{}','legacy-alice')");
 await r.run("INSERT INTO goals(id,user_id,title,description) VALUES('rep-goal','legacy-bob','Bob goal','d')");
 await r.run("INSERT INTO tasks(id,goal_id,title,description,status) VALUES('rep-task','rep-goal','t','d','pending')");
 await r.run("INSERT INTO tools(id,base,title,category,type,icon,description,config,parameters,outputs,created_by) VALUES('rep-tool','AI','Tool','custom','t','i','d','{}','{}','{}','legacy-bob')");
 await r.run("INSERT INTO content_outputs(id,user_id,title,content,content_type) VALUES('rep-output','legacy-alice','o','c','markdown')");

 // Optional plugin schemas: one owning its own rows, one inheriting from it.
 await r.run('CREATE TABLE IF NOT EXISTS plugin_reports(id TEXT PRIMARY KEY,user_id TEXT,body TEXT)');
 await r.run('CREATE TABLE IF NOT EXISTS plugin_report_runs(id TEXT PRIMARY KEY,report_id TEXT,output TEXT)');
 await r.run("INSERT INTO plugin_reports VALUES('rep-report','legacy-bob','Plugin private body')");
 await r.run("INSERT INTO plugin_report_runs VALUES('rep-report-run','rep-report','Plugin run output')");
 const extensions=[{table:'plugin_reports',kind:'personal',ownerColumn:'user_id'},{table:'plugin_report_runs',kind:'inherited',parentTable:'plugin_reports',parentColumn:'report_id'}];

 const before=await r.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
 expect(before.length).toBeGreaterThan(60); // the real schema, not a fixture
 await r.run('VACUUM INTO ?',[backup]);

 const inventory=await inspectOwnershipInventory(r,{extensions});
 expect(inventory.tables.filter(t=>t.status!=='classified')).toEqual([]);
 const result=await migrateOwnership(r,{extensions});
 await migrateOwnership(r,{extensions}); // idempotent
 await installOwnershipTriggers(r,[...OWNERSHIP_INVENTORY,...extensions]);

 // Every owning table in the real schema now carries a resolved scope.
 for(const descriptor of inventory.tables.filter(t=>['personal','inherited'].includes(t.kind))){
  const columns=await r.all(`PRAGMA table_info("${descriptor.table}")`);
  expect(columns.some(c=>c.name==='scope_id'),descriptor.table).toBe(true);
  const orphan=await r.get(`SELECT COUNT(*) AS n FROM "${descriptor.table}" WHERE scope_id IS NULL`);
  expect(orphan.n,descriptor.table).toBe(0);
 }
 expect(result.migratedTables).toContain('plugin_report_runs');

 // Ownership is preserved per account and children inherit their parent.
 const alice=(await r.get("SELECT scope_id FROM agents WHERE id='rep-agent'")).scope_id;
 const bob=(await r.get("SELECT scope_id FROM goals WHERE id='rep-goal'")).scope_id;
 expect(alice).not.toBe(bob);
 expect((await r.get("SELECT scope_id FROM workflow_versions WHERE workflow_id='rep-workflow'")).scope_id).toBe((await r.get("SELECT scope_id FROM workflows WHERE id='rep-workflow'")).scope_id);
 expect((await r.get("SELECT scope_id FROM tasks WHERE id='rep-task'")).scope_id).toBe(bob);
 expect((await r.get("SELECT scope_id FROM plugin_report_runs WHERE id='rep-report-run'")).scope_id).toBe((await r.get("SELECT scope_id FROM plugin_reports WHERE id='rep-report'")).scope_id);
 expect((await r.get("SELECT body FROM plugin_reports WHERE id='rep-report'")).body).toBe('Plugin private body');
 expect((await r.get('PRAGMA integrity_check')).integrity_check).toBe('ok');

 // Post-migration ownership is immutable, so a later write cannot relabel rows.
 await expect(r.run("UPDATE agents SET created_by='legacy-bob' WHERE id='rep-agent'")).rejects.toThrow(/immutable/);

 // Schema-compatible rollback: the pre-migration copy has no scope columns and
 // still accepts writes from a build that predates the migration.
 const sqlite3=(await import('sqlite3')).default;
 const old=await new Promise((resolve,reject)=>{const c=new sqlite3.Database(backup,e=>e?reject(e):resolve(c));});
 const rollback=databaseRepository(old);
 try{
  expect((await rollback.all('PRAGMA table_info(agents)')).some(c=>c.name==='scope_id')).toBe(false);
  expect((await rollback.get("SELECT COUNT(*) AS n FROM agents WHERE id='rep-agent'")).n).toBe(1);
  expect((await rollback.get("SELECT body FROM plugin_reports WHERE id='rep-report'")).body).toBe('Plugin private body');
  await rollback.run("INSERT INTO workflows(id,workflow_data,user_id) VALUES('old-build-write','{}','legacy-alice')");
  expect((await rollback.get("SELECT COUNT(*) AS n FROM workflows")).n).toBe(2);
  expect((await rollback.get('PRAGMA integrity_check')).integrity_check).toBe('ok');
 }finally{await new Promise((resolve,reject)=>old.close(e=>e?reject(e):resolve()));await fs.rm(path.dirname(backup),{recursive:true,force:true});}
},120000);
