import {it,expect} from 'vitest';import sqlite3 from 'sqlite3';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {databaseRepository} from './ScopeRepository.js';import {migrateOwnership} from './OwnershipMigration.js';
const open=file=>new Promise((resolve,reject)=>{const db=new sqlite3.Database(file,e=>e?reject(e):resolve(db));});const close=db=>new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));
it('backs up a disk-backed legacy fixture, refuses unknown plugin schemas without partial changes, and restores old-schema compatibility',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agnt-ownership-restore-'));let db;
 try{
  const source=path.join(root,'legacy.db'),backup=path.join(root,'backup.db'),restore=path.join(root,'restored.db');db=await open(source);let r=databaseRepository(db);
  await r.run('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT)');await r.run('CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT,title TEXT)');await r.run('CREATE TABLE tasks(id TEXT PRIMARY KEY,goal_id TEXT)');await r.run('CREATE TABLE installed_plugin_assets(id TEXT PRIMARY KEY,plugin_name TEXT)');await r.run('CREATE TABLE plugin_optional_records(id TEXT PRIMARY KEY,private_content TEXT)');
  await r.run("INSERT INTO users VALUES('alice','Alice')");await r.run("INSERT INTO goals VALUES('g','alice','Keep me')");await r.run("INSERT INTO tasks VALUES('t','g')");await r.run("INSERT INTO installed_plugin_assets VALUES('asset','example-plugin')");await r.run("INSERT INTO plugin_optional_records VALUES('private','Keep plugin data')");
  await r.run('VACUUM INTO ?',[backup]);
  await expect(migrateOwnership(r)).rejects.toThrow('plugin_optional_records');expect((await r.all('PRAGMA table_info(goals)')).some(c=>c.name==='scope_id')).toBe(false);
  // Unknown plugin data is retained: migration must not classify or delete it by guesswork.
  expect((await r.get('SELECT private_content FROM plugin_optional_records')).private_content).toBe('Keep plugin data');
  await close(db);db=null;await fs.copyFile(backup,restore);db=await open(restore);r=databaseRepository(db);
  expect((await r.get('PRAGMA integrity_check')).integrity_check).toBe('ok');expect(await r.all('SELECT * FROM goals')).toEqual([{id:'g',user_id:'alice',title:'Keep me'}]);expect((await r.all('PRAGMA table_info(goals)')).some(c=>c.name==='scope_id')).toBe(false);expect((await r.get('SELECT COUNT(*) AS n FROM installed_plugin_assets')).n).toBe(1);expect((await r.get('SELECT private_content FROM plugin_optional_records')).private_content).toBe('Keep plugin data');
 }finally{if(db)await close(db);await fs.rm(root,{recursive:true,force:true});}
},30000);
