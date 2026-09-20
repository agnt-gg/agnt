import {it,expect} from 'vitest';import sqlite3 from 'sqlite3';
import {databaseRepository,ensureSharedScope} from './ScopeRepository.js';
import {migrateOwnership} from './OwnershipMigration.js';import {installOwnershipTriggers} from './OwnershipTriggers.js';import {OWNERSHIP_INVENTORY} from './OwnershipInventory.js';
it('assigns scopes to every model write, inherits children, and makes owners immutable',async()=>{const db=new sqlite3.Database(':memory:');const r=databaseRepository(db);try{
 await r.run('PRAGMA foreign_keys=ON');await r.run('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT)');await r.run('CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT)');await r.run('CREATE TABLE tasks(id TEXT PRIMARY KEY,goal_id TEXT)');
 await r.run("INSERT INTO users VALUES('alice','Alice')");await migrateOwnership(r);await installOwnershipTriggers(r,OWNERSHIP_INVENTORY);
 await r.run("INSERT INTO goals VALUES('g','alice',NULL)");await r.run("INSERT INTO tasks VALUES('t','g',NULL)");expect((await r.get("SELECT scope_id FROM goals WHERE id='g'")).scope_id).toBe((await r.get("SELECT scope_id FROM tasks WHERE id='t'")).scope_id);
 const scope=await ensureSharedScope(r,'team');await r.run('INSERT INTO goals(id,user_id) VALUES(?,?)',['shared',scope.resourceOwnerId]);expect((await r.get("SELECT scope_id FROM goals WHERE id='shared'")).scope_id).toBe(scope.id);
 await expect(r.run("UPDATE goals SET user_id='alice' WHERE id='shared'")).rejects.toThrow('immutable');await expect(r.run("INSERT INTO goals VALUES('spoof','alice','team:team')")).rejects.toThrow('mismatch');
 await migrateOwnership(r);
 }finally{await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}});
