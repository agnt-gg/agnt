import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {GoalRunOwnership} from './goalRunOwnership.js';
let root,db,store;
const run=(sql,p=[])=>new Promise((resolve,reject)=>db.run(sql,p,e=>e?reject(e):resolve()));
const get=(sql,p=[])=>new Promise((resolve,reject)=>db.get(sql,p,(e,r)=>e?reject(e):resolve(r)));
beforeEach(async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'goal-owner-'));db=new sqlite3.Database(path.join(root,'test.db'));
 await run('CREATE TABLE goals(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,loop_status TEXT,deleted_at TEXT,world_state TEXT,current_iteration INTEGER)');
 await run('CREATE TABLE tasks(id TEXT PRIMARY KEY,goal_id TEXT,status TEXT,output TEXT,error TEXT,progress INTEGER,completed_at TEXT,updated_at TEXT)');
 await run("INSERT INTO goals VALUES('g','u','planning',NULL,NULL,'{}',3)");
 await run("INSERT INTO tasks(id,goal_id,status,output,error) VALUES('done','g','completed','saved evidence',NULL),('pending','g','pending',NULL,NULL)");
 store=new GoalRunOwnership(db);await store.initialize();
});
afterEach(async()=>{await new Promise(r=>db.close(r));fs.rmSync(root,{recursive:true,force:true})});
describe('Given durable goal ownership across backend lifetimes',()=>{
 it('When an expired owner completes late, Then reconciliation restores interrupted state instead of trusting terminal labels',async()=>{
  await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='validated'");
  expect(await store.reconcile(32000)).toBe(1);
  expect((await get('SELECT status FROM goals')).status).toBe('needs_review');
 });
 it('When abandoned task claims are reset to pending, Then the interruption still blocks replay',async()=>{
  const lease=await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='executing'");
  await store.checkpoint(lease,{phase:'external_work_admitted',taskId:'pending'},2000);
  await store.release(lease);await run("UPDATE goals SET status='paused'");
  await expect(store.acquire('g','u','b',3000)).rejects.toThrow(/outcome|interrupted/i);
 });
});

describe('Given durable goal ownership across backend lifetimes',()=>{
 it('When two owners start together, Then only one acquires execution',async()=>{
  const results=await Promise.allSettled([store.acquire('g','u','boot-a',1000),store.acquire('g','u','boot-b',1000)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 });
 it('When the lease expires, Then the goal is interrupted without replaying or deleting task evidence',async()=>{
  await store.acquire('g','u','boot-a',1000);await run("UPDATE goals SET status='executing'");
  await run("UPDATE tasks SET status='running' WHERE id='pending'");
  expect(await store.reconcile(32000)).toBe(1);
  expect((await get('SELECT status,loop_status FROM goals')).status).toBe('needs_review');
  expect((await get("SELECT status FROM tasks WHERE id='pending'")).status).toBe('running');
  expect((await get("SELECT output FROM tasks WHERE id='done'")).output).toBe('saved evidence');
  await expect(store.acquire('g','u','boot-b',33000)).rejects.toThrow(/outcome|interrupted/i);
 });
 it('When another owner is healthy, Then a restart does not take over its goal',async()=>{
  const lease=await store.acquire('g','u','remote-boot',1000);await run("UPDATE goals SET status='executing'");
  expect(await store.reconcile(2000)).toBe(0);expect(await store.renew(lease,2000)).toBe(true);
 });
 it('When an expired owner renews, Then it cannot revive itself',async()=>{
  const lease=await store.acquire('g','u','a',1000);expect(await store.renew(lease,32000)).toBe(false);
 });
 it('When an old owner finishes after replacement, Then it cannot release the replacement',async()=>{
  const old=await store.acquire('g','u','a',1000);await store.release(old);
  const next=await store.acquire('g','u','b',2000);expect(await store.release(old)).toBe(false);expect(await store.renew(next,2100)).toBe(true);
 });
 it('When a goal was paused, Then reconciliation preserves operator intent',async()=>{
  await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='paused'");
  await store.reconcile(32000);expect((await get('SELECT status FROM goals')).status).toBe('paused');
 });
 it('When ownerless legacy execution is encountered, Then it is classified unknown, not silently restarted',async()=>{
  await run("UPDATE goals SET status='executing'");
  await store.reconcile(1000);expect((await get('SELECT status FROM goals')).status).toBe('needs_review');
  expect((await store.inspect('g')).reason).toMatch(/owner|interrupted/i);
 });
 it('When interrupted between phases, Then checkpoint and iteration are retained',async()=>{
  const lease=await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='executing'");
  await store.checkpoint(lease,{phase:'tasks',iteration:3},2000);await store.reconcile(34000);
  const state=await store.inspect('g');expect(JSON.parse(state.checkpoint)).toEqual({phase:'tasks',iteration:3});
  expect((await get('SELECT current_iteration FROM goals')).current_iteration).toBe(3);
 });
 it('When a different user requests the run, Then ownership is denied',async()=>{
  await expect(store.acquire('g','other','a',1000)).rejects.toThrow(/owner|access/i);
 });
 it('When a real child process dies after durable acquisition, Then another process sees the interruption',async()=>{
  const script=path.join(root,'child.mjs');
  fs.writeFileSync(script,`import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(import.meta.url)});const sqlite3=require('sqlite3');const {GoalRunOwnership}=await import(${JSON.stringify(new URL('./goalRunOwnership.js',import.meta.url).href)});const db=new sqlite3.Database(${JSON.stringify(path.join(root,'test.db'))});const s=new GoalRunOwnership(db);await s.acquire('g','u','child',1000);await new Promise((r,j)=>db.run("UPDATE goals SET status='executing'",e=>e?j(e):r()));console.log('READY');setInterval(()=>{},1000);`);
  const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});
  try{await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('child startup timeout')),5000);child.stdout.on('data',d=>{text+=d;if(text.includes('READY')){clearTimeout(timer);resolve()}});child.once('exit',()=>{clearTimeout(timer);reject(Error('child exited early'))})});
   const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;
   expect(await store.reconcile(32000)).toBe(1);expect((await get('SELECT status FROM goals')).status).toBe('needs_review');
  }finally{child.kill('SIGKILL')}
 });
});

describe('Given parallel attempts and crash uncertainty',()=>{
 it('When one sibling finishes, Then another admitted attempt remains unresolved',async()=>{
  const l=await store.acquire('g','u','a',1000);
  l.attemptId=await store.beginAttempt(l,'pending',1500);
  await run("INSERT INTO tasks(id,goal_id,status,output,error) VALUES('sibling','g','pending',NULL,NULL)");await store.beginAttempt(l,'sibling',1500);
  expect(await store.commitAttempt(l,'pending',{content:'verified'},2000)).toBe(true);
  await store.release(l);await expect(store.acquire('g','u','b',3000)).rejects.toThrow(/outcome|interrupted/i);
 });
 it('When an expired owner returns results, Then no task output is committed',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  expect(await store.commitAttempt(l,'pending',{content:'late'},32000)).toBe(false);
  expect((await get("SELECT output FROM tasks WHERE id='pending'")).output).toBeNull();
 });
 it('When valid result commits, Then task result and attempt resolution are atomic and duplicate result is refused',async()=>{
  const l=await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='executing'");l.attemptId=await store.beginAttempt(l,'pending',1500);
  expect(await store.commitAttempt(l,'pending',{content:'saved'},2000)).toBe(true);
  expect(await store.commitAttempt(l,'pending',{content:'duplicate'},2100)).toBe(false);
  expect(JSON.parse((await get("SELECT output FROM tasks WHERE id='pending'")).output)).toEqual({content:'saved'});
 });
 it('When pause precedes result commit, Then result is refused',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);await run("UPDATE goals SET status='paused'");
  expect(await store.commitAttempt(l,'pending',{content:'late'},2000)).toBe(false);
 });
});

describe('Given explicit outcome reconciliation',()=>{
 it('When a known-not-executed attempt is resolved with evidence, Then safe pending work can be resumed',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);await run("UPDATE goals SET status='executing'");await store.reconcile(32000);
  await store.resolve('g','u',l.runId,{decisions:[{taskId:'pending',outcome:'not_executed',evidence:'provider operation query confirmed absent'}],evidence:'checked external outcome'},33000);
  expect((await get("SELECT status FROM tasks WHERE id='pending'")).status).toBe('pending');
  const next=await store.acquire('g','u','b',34000);expect(next.generation).toBe(l.generation+1);
 });
 it('When resolution lacks evidence or misses an attempt, Then the unknown barrier remains',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);await run("UPDATE goals SET status='executing'");await store.reconcile(32000);
  await expect(store.resolve('g','u',l.runId,{decisions:[],evidence:'checked'},33000)).rejects.toThrow();
  await expect(store.resolve('g','u',l.runId,{decisions:[{taskId:'pending',outcome:'not_executed'}]},33000)).rejects.toThrow();
  expect((await store.inspect('g')).state).toBe('interrupted');
 });
 it('When resolution comes from the wrong user or an old run, Then it is refused',async()=>{
  const l=await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='executing'");await store.reconcile(32000);
  await expect(store.resolve('g','other',l.runId,{decisions:[],evidence:'checked'},33000)).rejects.toThrow();
  await expect(store.resolve('g','u','wrong',{decisions:[],evidence:'checked'},33000)).rejects.toThrow();
 });
 it('When resolving a paused goal, Then operator pause is retained',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);await store.release(l);await run("UPDATE goals SET status='paused'");
  await store.resolve('g','u',l.runId,{decisions:[{taskId:'pending',outcome:'not_executed',evidence:'confirmed absent'}],evidence:'confirmed'},33000);
  expect((await get('SELECT status FROM goals')).status).toBe('paused');
 });
});

describe('Given task admission is an ownership boundary',()=>{
 it('When the user pauses before admission, Then no external attempt can begin',async()=>{
  const l=await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='paused'");
  expect(await store.beginAttempt(l,'pending',1500)).toBe(false);
 });
 it('When a task is deleted and recreated, Then a previous attempt cannot overwrite it',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  await run("DELETE FROM tasks WHERE id='pending'");await run("INSERT INTO tasks(id,goal_id,status,output) VALUES('pending','g','pending','replacement')");
  expect(await store.commitAttempt(l,'pending',{content:'old'},2000)).toBe(false);
 });
 it('When one task is legitimately regraded and run again, Then it gets a distinct attempt and late first results cannot commit',async()=>{
  const l=await store.acquire('g','u','a',1000);const first=l.attemptId=await store.beginAttempt(l,'pending',1500);
  expect(await store.commitAttempt({...l,attemptId:first},'pending',{content:'first'},2000)).toBe(true);
  await run("UPDATE tasks SET status='pending' WHERE id='pending'");const second=await store.beginAttempt(l,'pending',2200);
  expect(second).toBeTruthy();expect(second).not.toBe(first);
  expect(await store.commitAttempt({...l,attemptId:first},'pending',{content:'late'},2300)).toBe(false);
 });
});

describe('Given persisted operator intent and task changes',()=>{
 it('When a claim heartbeat updates only lease fields, Then valid result remains committable',async()=>{
  await run('ALTER TABLE tasks ADD COLUMN claim_expires_at INTEGER');
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  await run("UPDATE tasks SET claim_expires_at=90000 WHERE id='pending'");
  expect(await store.commitAttempt(l,'pending',{content:'result'},2000)).toBe(true);
 });
 it('When meaningful task evidence changes before commit, Then old result is refused',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  await run("UPDATE tasks SET output='new evidence' WHERE id='pending'");
  expect(await store.commitAttempt(l,'pending',{content:'stale'},2000)).toBe(false);
 });
 it('When reconciliation repeats, Then it is idempotent and preserves the original run identity',async()=>{
  const l=await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='executing'");
  expect(await store.reconcile(32000)).toBe(1);expect(await store.reconcile(33000)).toBe(0);
  expect((await store.inspect('g')).run_id).toBe(l.runId);
 });
 it('When current checkpoint is invalid JSON, Then failure does not commit a partial ownership release',async()=>{
  const l=await store.acquire('g','u','a',1000);await run("UPDATE goal_run_ownership SET checkpoint='invalid'");
  await expect(store.release(l)).rejects.toThrow();expect((await store.inspect('g')).state).toBe('running');
 });
});

describe('Given one ownership connection services concurrent operations',()=>{
 it('When renewal arrives inside an unrelated transaction that rolls back, Then renewal runs afterward and survives',async()=>{
  const l=await store.acquire('g','u','a',1000);
  let entered,release;const ready=new Promise(r=>entered=r),barrier=new Promise(r=>release=r);
  const tx=store.transaction(async()=>{entered();await barrier;throw Error('rollback fixture')}).catch(e=>e);
  await ready;let settled=false;
  const renewal=store.renew(l,2000).then(v=>{settled=true;return v});
  await new Promise(r=>setTimeout(r,25));const settledBeforeRelease=settled;
  release();await tx;expect(await renewal).toBe(true);
  expect(settledBeforeRelease).toBe(false);
  expect((await store.inspect('g')).lease_until).toBe(32000);
 });
 it('When a task has a new attempt, Then the prior attempt remains in append-only history',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  await store.commitAttempt(l,'pending',{content:'first'},2000);
  await run("UPDATE tasks SET status='pending' WHERE id='pending'");
  const second=await store.beginAttempt(l,'pending',2200);
  const rows=await store.all('SELECT attempt_id,state FROM goal_run_attempt_history ORDER BY recorded_at, rowid');
  expect(rows.some(a=>a.attempt_id===l.attemptId&&a.state==='committed')).toBe(true);
  expect(second).not.toBe(l.attemptId);
 });
 it('When external outcome is unknown at release, Then reason is explicit and malformed checkpoints fail closed',async()=>{
  const l=await store.acquire('g','u','a',1000);await store.beginAttempt(l,'pending',1500);await store.release(l);
  expect((await store.inspect('g')).reason).toBe('external_outcome_unknown');
 });
 it('When task description changes during execution, Then its stale result is refused',async()=>{
  await run('ALTER TABLE tasks ADD COLUMN description TEXT');
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  await run("UPDATE tasks SET description='new scope' WHERE id='pending'");
  expect(await store.commitAttempt(l,'pending',{content:'old scope'},2000)).toBe(false);
 });
});

describe('Given authorized safe checkpoints',()=>{
 it('When a tasks checkpoint has no admitted work, Then one replacement inherits the same iteration',async()=>{
  const l=await store.acquire('g','u','a',1000);
  await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:8,provider:'openai',model:'test'},1100);
  await store.checkpoint(l,{phase:'tasks',iteration:3},1200);await run("UPDATE goals SET status='executing'");
  await store.reconcile(32000);
  const results=await Promise.allSettled([store.recover('g','b',33000),store.recover('g','c',33000)]);
  const winners=results.filter(r=>r.status==='fulfilled'&&r.value);
  expect(winners).toHaveLength(1);expect(winners[0].value.resume).toEqual({phase:'tasks',iteration:3});
  expect((await get("SELECT output FROM tasks WHERE id='done'")).output).toBe('saved evidence');
 });
 it('When external work was admitted, Then automatic recovery never replays it',async()=>{
  const l=await store.acquire('g','u','a',1000);await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:8},1100);
  await store.checkpoint(l,{phase:'tasks',iteration:3},1200);await store.beginAttempt(l,'pending',1500);
  await run("UPDATE goals SET status='executing'");await store.reconcile(32000);
  expect(await store.recover('g','b',33000)).toBeNull();
 });
 it('When the user paused or scope changed, Then no unattended continuation is admitted',async()=>{
  const l=await store.acquire('g','u','a',1000);await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:8},1100);
  await store.checkpoint(l,{phase:'tasks',iteration:3},1200);await run("UPDATE goals SET status='paused'");
  await store.reconcile(32000);expect(await store.recover('g','b',33000)).toBeNull();
 });
 it('When no authorization or an unsupported phase is recorded, Then recovery stays blocked',async()=>{
  const l=await store.acquire('g','u','a',1000);await store.checkpoint(l,{phase:'replanning',iteration:3},1200);
  await run("UPDATE goals SET status='executing'");await store.reconcile(32000);
  expect(await store.recover('g','b',33000)).toBeNull();
 });
});

describe('Given failed external task responses',()=>{
 it('When a fenced response reports failure, Then it remains failed while the attempt is accounted for',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  expect(await store.commitAttempt(l,'pending',{content:'failed',recoveryTaskFailed:true},2000)).toBe(true);
  expect((await get("SELECT status FROM tasks WHERE id='pending'")).status).toBe('failed');
 });
});

describe('Given recovery admission must remain bounded',()=>{
 it('When task scope changes after authorization, Then recovery does not start',async()=>{
  await run('ALTER TABLE tasks ADD COLUMN description TEXT');const l=await store.acquire('g','u','a',1000);
  await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:8},1100);await store.checkpoint(l,{phase:'tasks',iteration:3},1200);
  await run("UPDATE tasks SET description='changed instructions' WHERE id='pending'");await store.reconcile(32000);
  expect(await store.recover('g','b',33000)).toBeNull();
 });
 it('When repeated crashes reach the recovery budget, Then no fourth replacement starts',async()=>{
  const l=await store.acquire('g','u','a',1000);await store.authorizeContinuation(l,{mode:'autonomous',maxIterations:8},1100);await store.checkpoint(l,{phase:'tasks',iteration:3},1200);
  for(let n=1;n<=3;n++){const now=1000+n*40000;await store.reconcile(now);expect(await store.recover('g','b'+n,now+1)).toBeTruthy()}
  await store.reconcile(170000);expect(await store.recover('g','b4',170001)).toBeNull();
 });
});

describe('Given pause can arrive from another process',()=>{
 it('When persistent state is paused, Then heartbeat cannot prolong ownership',async()=>{
  const l=await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='paused'");
  expect(await store.renew(l,2000)).toBe(false);
 });
});

describe('Given evidence resolution must affect the intended task',()=>{
 it('When an uncertain task is missing, Then resolution rolls back instead of clearing its barrier',async()=>{
  const l=await store.acquire('g','u','a',1000);await store.beginAttempt(l,'pending',1500);await store.reconcile(32000);
  await run("DELETE FROM tasks WHERE id='pending'");
  await expect(store.resolve('g','u',l.runId,{evidence:'checked absent',decisions:[{taskId:'pending',outcome:'not_executed',evidence:'confirmed'}]},33000)).rejects.toThrow();
  expect((await store.inspect('g')).state).toBe('interrupted');
 });
});

describe('Given failure can follow a successful external side effect',()=>{
 it('When failed output is saved, Then its effect remains uncertain and a new attempt is refused',async()=>{
  const l=await store.acquire('g','u','a',1000);l.attemptId=await store.beginAttempt(l,'pending',1500);
  await store.commitAttempt(l,'pending',{content:'network failed after send',recoveryTaskFailed:true},2000);
  await run("UPDATE tasks SET status='pending' WHERE id='pending'");
  expect(await store.beginAttempt(l,'pending',2500)).toBe(false);
  await store.release(l);await expect(store.acquire('g','u','b',3000)).rejects.toThrow(/outcome|interrupted/i);
 });
});

describe('Given paused goals retain intent after server death',()=>{
 it('When the paused owner lease expires, Then ownership is no longer reported running',async()=>{
  await store.acquire('g','u','a',1000);await run("UPDATE goals SET status='paused'");await store.reconcile(32000);
  expect((await store.inspect('g')).state).toBe('interrupted');expect((await get('SELECT status FROM goals')).status).toBe('paused');
 });
});

describe('Given a remote worker opts into fenced recovery',()=>{
 it('When two workers claim, Then only one receives the task with run and attempt identity',async()=>{
  await run('ALTER TABLE tasks ADD COLUMN claimed_by TEXT');await run('ALTER TABLE tasks ADD COLUMN claim_expires_at INTEGER');await run('ALTER TABLE tasks ADD COLUMN attempt_count INTEGER');await run('ALTER TABLE tasks ADD COLUMN dependencies TEXT');
  const l=await store.acquire('g','u','primary',1000);
  const claims=await Promise.all([store.claimRemote('u','node-a',1500),store.claimRemote('u','node-b',1500)]);
  expect(claims.filter(Boolean)).toHaveLength(1);expect(claims.find(Boolean).lease.runId).toBe(l.runId);expect(claims.find(Boolean).lease.attemptId).toBeTruthy();
 });
 it('When a different node or expired parent submits, Then its remote result cannot commit',async()=>{
  await run('ALTER TABLE tasks ADD COLUMN claimed_by TEXT');await run('ALTER TABLE tasks ADD COLUMN claim_expires_at INTEGER');await run('ALTER TABLE tasks ADD COLUMN attempt_count INTEGER');await run('ALTER TABLE tasks ADD COLUMN dependencies TEXT');
  await store.acquire('g','u','primary',1000);const a=await store.claimRemote('u','node-a',1500);
  expect(await store.remoteResult('u','node-b',a.lease,'pending',{content:'wrong'},2000)).toBe(false);
  expect(await store.remoteResult('u','node-a',a.lease,'pending',{content:'late'},32000)).toBe(false);
  expect((await get("SELECT output FROM tasks WHERE id='pending'")).output).toBeNull();
 });
 it('When pause occurs, Then remote renewal refuses ownership rather than extending stale work',async()=>{
  await run('ALTER TABLE tasks ADD COLUMN claimed_by TEXT');await run('ALTER TABLE tasks ADD COLUMN claim_expires_at INTEGER');await run('ALTER TABLE tasks ADD COLUMN attempt_count INTEGER');await run('ALTER TABLE tasks ADD COLUMN dependencies TEXT');
  await store.acquire('g','u','primary',1000);const a=await store.claimRemote('u','node-a',1500);await run("UPDATE goals SET status='paused'");
  expect(await store.renewRemote('u','node-a',a.lease,'pending',2000)).toBe(false);
 });
 it('When a valid remote result commits, Then duplicate submission is refused and task/attempt commit together',async()=>{
  await run('ALTER TABLE tasks ADD COLUMN claimed_by TEXT');await run('ALTER TABLE tasks ADD COLUMN claim_expires_at INTEGER');await run('ALTER TABLE tasks ADD COLUMN attempt_count INTEGER');await run('ALTER TABLE tasks ADD COLUMN dependencies TEXT');
  await store.acquire('g','u','primary',1000);const a=await store.claimRemote('u','node-a',1500);
  expect(await store.remoteResult('u','node-a',a.lease,'pending',{content:'verified'},2000)).toBe(true);
  expect(await store.remoteResult('u','node-a',a.lease,'pending',{content:'duplicate'},2100)).toBe(false);
  expect((await get("SELECT status FROM tasks WHERE id='pending'")).status).toBe('completed');
 });
});
