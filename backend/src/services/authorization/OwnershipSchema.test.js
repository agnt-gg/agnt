import {it,expect} from 'vitest';
import sqlite3 from 'sqlite3';
import {initializeOwnershipSchema,personalScopeId} from './OwnershipSchema.js';
it('migrates private ownership idempotently and rolls back unknown owners',async()=>{
 const db=new sqlite3.Database(':memory:');
 const repository={run:(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(error){error?reject(error):resolve(this)})),all:(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(error,rows)=>error?reject(error):resolve(rows)))};
 try{
 await repository.run('PRAGMA foreign_keys=ON');
 await repository.run('CREATE TABLE assets(id TEXT PRIMARY KEY,created_by TEXT)');
 await repository.run("INSERT INTO assets VALUES('a','alice'),('b','bob')");
 const descriptors=[{table:'assets',ownerColumn:'created_by'}];
 await initializeOwnershipSchema(repository,descriptors);await initializeOwnershipSchema(repository,descriptors);
 const rows=await repository.all('SELECT * FROM assets ORDER BY id');expect(rows[0].scope_id).toBe(personalScopeId('alice'));expect(rows[1].scope_id).not.toBe(rows[0].scope_id);
 expect((await repository.all('SELECT * FROM ownership_scopes')).every(row=>row.kind==='personal'&&row.team_id===null)).toBe(true);
 await repository.run('CREATE TABLE broken(id TEXT,created_by TEXT)');await repository.run("INSERT INTO broken VALUES('bad',NULL)");
 await expect(initializeOwnershipSchema(repository,[{table:'broken',ownerColumn:'created_by'}])).rejects.toThrow('Unclassified');
 expect((await repository.all('PRAGMA table_info(broken)')).some(column=>column.name==='scope_id')).toBe(false);
 await expect(initializeOwnershipSchema(repository,[{table:'assets;DROP TABLE assets',ownerColumn:'created_by'}])).rejects.toThrow('Invalid');
 }finally{await new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));}
});
