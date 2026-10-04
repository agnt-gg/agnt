import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import db,{dbReady} from '../../models/database/index.js';
import {getLearningCoordinator} from './LearningCoordinator.js';
import {observeExecution,reconcileLearningEvidence} from './learningRuntime.js';
import {initializeLearningSchema} from '../../models/database/learningSchema.js';
import fs from 'node:fs';import path from 'node:path';
let service;
const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
beforeAll(async()=>{await dbReady;service=await getLearningCoordinator();await run("INSERT INTO users(id,email) VALUES('learning-owner','learning@test.local'),('learning-other','other@test.local')");});
afterAll(async()=>{await new Promise(r=>service.db.close(r));await new Promise(r=>db.close(r));});
describe('production schema and evidence adapters',()=>{
 it('recovers terminal traces with content-free evidence, rejects other accounts, and deduplicates hook/scan delivery',async()=>{
   const time=new Date(Date.now()-1000).toISOString();await run("INSERT INTO agent_executions(id,user_id,status,start_time,end_time,initial_prompt) VALUES('learning-run','learning-owner','completed',?,?,?)",[time,time,'PRIVATE PROMPT']);
   await run("INSERT INTO agent_tool_executions(id,execution_id,tool_name,tool_call_id,status,start_time,end_time,input,output,error) VALUES('learning-tool','learning-run','read_file','c','failed',?,?,?,?,'timed out')",[time,time,'SECRET INPUT',JSON.stringify(JSON.stringify({success:false,error:'timed out',secret:'NEVER STORE'}))]);
   await expect(observeExecution('agent','learning-run','learning-other')).rejects.toMatchObject({code:'not_found'});await observeExecution('agent','learning-run','learning-owner');await observeExecution('agent','learning-run','learning-owner');
   const rows=await service.all("SELECT * FROM learning_events WHERE user_id='learning-owner'");expect(rows.filter(r=>r.type==='tool_outcome')).toHaveLength(1);expect(rows.find(r=>r.type==='tool_outcome').error_kind).toBe('timeout');expect(JSON.stringify(rows)).not.toContain('PRIVATE');expect(JSON.stringify(rows)).not.toContain('NEVER STORE');
 });
 it('reconciliation resumes from a persisted cursor and does not mark old history learned',async()=>{
   await reconcileLearningEvidence();await service.run("UPDATE learning_cursors SET last_seen_at='2000-01-01T00:00:00.000Z' WHERE source_type='agent'");await reconcileLearningEvidence();const cursor=await service.get("SELECT * FROM learning_cursors WHERE source_type='agent'");expect(cursor.last_id).toBe('learning-run');expect((await service.summary('learning-owner')).policies).toEqual([]);
 });
 it('additive migration has a verified no-data-loss rollback on a disposable database',async()=>{
   const sqlite3=(await import('sqlite3')).default;const connection=await new Promise((resolve,reject)=>{const c=new sqlite3.Database(':memory:',e=>e?reject(e):resolve(c));});
   const execute=sql=>new Promise((resolve,reject)=>connection.run(sql,e=>e?reject(e):resolve()));
   const get=sql=>new Promise((resolve,reject)=>connection.get(sql,(e,r)=>e?reject(e):resolve(r)));
   try{await execute('CREATE TABLE memories(id TEXT PRIMARY KEY,content TEXT)');await execute("INSERT INTO memories VALUES('m','keep')");await initializeLearningSchema(connection);
     for(const name of ['learning_events','learning_policies','learning_trials','learning_findings','learning_work','learning_settings','learning_cursors','learning_health'])await execute('DROP TABLE '+name);
     expect(await get('SELECT * FROM memories')).toEqual({id:'m',content:'keep'});expect((await get('PRAGMA integrity_check')).integrity_check).toBe('ok');await initializeLearningSchema(connection);expect(await get('SELECT COUNT(*) AS n FROM learning_events')).toEqual({n:0});
   }finally{await new Promise(r=>connection.close(r));}
 });
 it('one authority boundary gates legacy producers and writes while preserving Memory',()=>{
   const root=path.resolve(import.meta.dirname,'../../../..');const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');const triggers=fs.readFileSync(path.join(root,'backend/src/services/evolution/InsightTriggers.js'),'utf8');
   expect(triggers).not.toContain('InsightEngine.extract');expect(triggers).not.toContain('SkillForgeOrchestrator');expect(server).toContain("req.path.startsWith('/memory')");for(const route of ['experiments','skillforge','mutations','evolution'])expect(server).toContain(`app.use('/api/${route}', learningOnlyWrites,`);
 });
});
