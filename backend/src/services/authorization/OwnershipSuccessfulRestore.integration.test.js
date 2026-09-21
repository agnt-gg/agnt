import {it,expect} from 'vitest';import sqlite3 from 'sqlite3';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {databaseRepository} from './ScopeRepository.js';import {migrateOwnership} from './OwnershipMigration.js';
const open=file=>new Promise((resolve,reject)=>{const connection=new sqlite3.Database(file,error=>error?reject(error):resolve(connection));});const close=db=>new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));
it('migrates disk-backed legacy and declared plugin rows, then restores an old-schema writable backup',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agnt-successful-migration-'));let db;
 const extensions=[{table:'plugin_notes',kind:'personal',ownerColumn:'user_id'},{table:'plugin_note_versions',kind:'inherited',parentTable:'plugin_notes',parentColumn:'note_id'}];
 try{
 const source=path.join(root,'legacy.db'),backup=path.join(root,'before.db'),restored=path.join(root,'rollback.db');db=await open(source);let r=databaseRepository(db);
 for(const sql of ['CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT)','CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT,title TEXT)','CREATE TABLE tasks(id TEXT PRIMARY KEY,goal_id TEXT)','CREATE TABLE installed_plugin_assets(id TEXT PRIMARY KEY,plugin_name TEXT)','CREATE TABLE plugin_notes(id TEXT PRIMARY KEY,user_id TEXT,content TEXT)','CREATE TABLE plugin_note_versions(id TEXT PRIMARY KEY,note_id TEXT,content TEXT)'])await r.run(sql);
 await r.run("INSERT INTO users VALUES('alice','Alice'),('bob','Bob')");await r.run("INSERT INTO goals VALUES('g','alice','Existing goal')");await r.run("INSERT INTO tasks VALUES('t','g')");await r.run("INSERT INTO installed_plugin_assets VALUES('package','notes')");await r.run("INSERT INTO plugin_notes VALUES('n','bob','Private plugin content')");await r.run("INSERT INTO plugin_note_versions VALUES('v','n','Prior version')");
 await r.run('VACUUM INTO ?',[backup]);
 const migrated=await migrateOwnership(r,{extensions});expect(migrated.migratedTables).toContain('plugin_note_versions');await migrateOwnership(r,{extensions});
 const note=await r.get('SELECT * FROM plugin_notes');const version=await r.get('SELECT * FROM plugin_note_versions');expect(note.scope_id).toBe(version.scope_id);expect(note.content).toBe('Private plugin content');expect(note.scope_id).not.toBe((await r.get('SELECT scope_id FROM goals')).scope_id);expect((await r.get('PRAGMA integrity_check')).integrity_check).toBe('ok');
 await close(db);db=null;await fs.copyFile(backup,restored);db=await open(restored);r=databaseRepository(db);
 expect((await r.all('PRAGMA table_info(plugin_notes)')).some(column=>column.name==='scope_id')).toBe(false);expect((await r.get('SELECT content FROM plugin_notes')).content).toBe('Private plugin content');
 await r.run("INSERT INTO plugin_notes VALUES('old-client-write','bob','Works with old schema')");expect((await r.get('SELECT COUNT(*) AS n FROM plugin_notes')).n).toBe(2);expect((await r.get('PRAGMA integrity_check')).integrity_check).toBe('ok');
 }finally{if(db)await close(db);await fs.rm(root,{recursive:true,force:true});}
},30000);
