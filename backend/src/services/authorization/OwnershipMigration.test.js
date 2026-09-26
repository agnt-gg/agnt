import {it,expect,describe} from 'vitest';
import sqlite3 from 'sqlite3';
import {migrateOwnership,ORPHANED_SCOPE_ID} from './OwnershipMigration.js';
import {ResourceAuthorization} from './ResourceAuthorization.js';

function open(){
 const db=new sqlite3.Database(':memory:');
 const repository={
  run:(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this)})),
  all:(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r))),
  get:(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r))),
 };
 const close=()=>new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));
 return {repository,close};
}
const scopeOf=async(r,table,id)=>(await r.get(`SELECT scope_id FROM "${table}" WHERE id=?`,[id])).scope_id;

describe('ownership migration', () => {
 it('children inherit their goal\'s scope, and a second run changes nothing', async () => {
  const {repository:r,close}=open();
  try{
   await r.run('CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT)');
   await r.run('CREATE TABLE tasks(id TEXT PRIMARY KEY,goal_id TEXT)');
   await r.run("INSERT INTO goals VALUES('g','alice')");
   await r.run("INSERT INTO tasks VALUES('t','g')");
   expect((await migrateOwnership(r)).orphaned).toEqual({});
   await migrateOwnership(r);
   expect(await scopeOf(r,'tasks','t')).toBe(await scopeOf(r,'goals','g'));
  }finally{await close();}
 });

 // Measured on the fleet 2026-09-26: alpha, charlie and goku held rows whose parent had been
 // deleted, the migration threw "Orphan resource in goal_evaluations", and each answered 503
 // until rolled back. A long-lived desktop install held 710 such rows.
 it('boots a database holding children of deleted parents, keeping every row', async () => {
  const {repository:r,close}=open();
  try{
   await r.run('CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT)');
   await r.run('CREATE TABLE tasks(id TEXT PRIMARY KEY,goal_id TEXT)');
   await r.run('CREATE TABLE task_evaluations(id TEXT PRIMARY KEY,task_id TEXT)');
   await r.run('CREATE TABLE goal_evaluations(id TEXT PRIMARY KEY,goal_id TEXT)');
   await r.run("INSERT INTO goals VALUES('g','alice')");
   await r.run("INSERT INTO tasks VALUES('t-live','g'),('t-orphan','deleted-goal')");
   await r.run("INSERT INTO task_evaluations VALUES('e-live','t-live'),('e-of-orphan','t-orphan')");
   await r.run("INSERT INTO goal_evaluations VALUES('ge-orphan','deleted-goal')");

   const result=await migrateOwnership(r);
   // The orphan task's evaluation is not counted: it has a parent, and inherits its scope.
   expect(result.orphaned).toEqual({tasks:1,goal_evaluations:1});

   // Nothing deleted, nothing unscoped.
   expect((await r.get('SELECT COUNT(*) AS n FROM tasks')).n).toBe(2);
   for(const t of ['tasks','task_evaluations','goal_evaluations'])
    expect((await r.get(`SELECT COUNT(*) AS n FROM "${t}" WHERE scope_id IS NULL`)).n,t).toBe(0);

   // Live rows keep their owner; orphans, and the orphan's own children, are filed apart.
   const alice=await scopeOf(r,'goals','g');
   expect(await scopeOf(r,'tasks','t-live')).toBe(alice);
   expect(await scopeOf(r,'task_evaluations','e-live')).toBe(alice);
   expect(await scopeOf(r,'tasks','t-orphan')).toBe(ORPHANED_SCOPE_ID);
   expect(await scopeOf(r,'task_evaluations','e-of-orphan')).toBe(ORPHANED_SCOPE_ID);
   expect(await scopeOf(r,'goal_evaluations','ge-orphan')).toBe(ORPHANED_SCOPE_ID);

   // A later boot finds nothing new to file.
   expect((await migrateOwnership(r)).orphaned).toEqual({});
  }finally{await close();}
 });

 it('an orphan is reachable by nobody, including the user who owned its deleted parent', async () => {
  const {repository:r,close}=open();
  try{
   await r.run('CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT)');
   await r.run('CREATE TABLE goal_evaluations(id TEXT PRIMARY KEY,goal_id TEXT)');
   await r.run("INSERT INTO goals VALUES('g','alice')");
   await r.run("INSERT INTO goal_evaluations VALUES('ge-orphan','deleted-goal')");
   await migrateOwnership(r);
   const scope=await r.get('SELECT * FROM ownership_scopes WHERE id=?',[ORPHANED_SCOPE_ID]);
   expect(scope).toMatchObject({kind:'system',owner_user_id:null,team_id:null});
   const authorization=new ResourceAuthorization(r);
   for(const action of ['view','edit','delete'])
    await expect(authorization.require({actorId:'alice'},action,'goal_evaluations','ge-orphan')).rejects.toMatchObject({status:403});
  }finally{await close();}
 });
});
