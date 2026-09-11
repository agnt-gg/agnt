import {describe,it,expect} from 'vitest';
import sqlite3 from 'sqlite3';
import {initializeGoalLifecycleVersions} from './goalLifecycleVersions.js';

describe('additive lifecycle revision migration',()=>{
 it('preserves old rows, is idempotent, observes raw writers, reparenting and ID reuse',async()=>{
  const db=await new Promise((resolve,reject)=>{const c=new sqlite3.Database(':memory:',e=>e?reject(e):resolve(c));});
  const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
  const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,row)=>e?reject(e):resolve(row)));
  const revision=async(kind,id)=>(await get('SELECT revision FROM goal_lifecycle_versions WHERE kind=? AND entity_id=?',[kind,id]))?.revision||0;
  try {
    await run('CREATE TABLE goals(id TEXT PRIMARY KEY,status TEXT)');
    await run('CREATE TABLE tasks(id TEXT PRIMARY KEY,goal_id TEXT,output TEXT)');
    await run("INSERT INTO goals VALUES('g','paused'),('other','executing')");
    await run("INSERT INTO tasks VALUES('t','g','original')");
    await initializeGoalLifecycleVersions(db);await initializeGoalLifecycleVersions(db);
    expect(await revision('goal','g')).toBe(0);expect(await get("SELECT output FROM tasks WHERE id='t'")).toEqual({output:'original'});
    await run("UPDATE tasks SET output='changed' WHERE id='t'");
    expect(await revision('task','t')).toBe(1);expect(await revision('goal','g')).toBe(1);
    await run("UPDATE tasks SET output='original' WHERE id='t'");
    expect(await revision('task','t')).toBe(2);
    await run("UPDATE tasks SET goal_id='other' WHERE id='t'");
    expect(await revision('goal','g')).toBe(3);expect(await revision('goal','other')).toBe(1);
    await run("DELETE FROM tasks WHERE id='t'");await run("INSERT INTO tasks VALUES('t','other','original')");
    expect(await revision('task','t')).toBe(5);
    await run("DELETE FROM goals WHERE id='g'");await run("INSERT INTO goals VALUES('g','paused')");
    expect(await revision('goal','g')).toBe(5);
    expect((await get("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger'")).n).toBe(6);
  } finally {await new Promise(resolve=>db.close(resolve));}
 });
});
