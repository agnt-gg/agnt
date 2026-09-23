import { describe, it, expect, vi, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { collectActivationMilestones, syncActivationMilestones } from './ActivationMilestoneService.js';
import { activationMilestoneHandler } from '../routes/activationMilestoneHandler.js';

const user='account_0001', start='2026-09-01T00:00:00.000Z', end='2026-09-01T00:01:00.000Z';
const databases=[];
async function fixture() {
  const db=await new Promise((resolve,reject)=>{const instance=new sqlite3.Database(':memory:',error=>error?reject(error):resolve(instance));});
  databases.push(db);
  const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(error){error?reject(error):resolve(this);}));
  const get=(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(error,row)=>error?reject(error):resolve(row)));
  await run('CREATE TABLE agent_executions(id TEXT,user_id TEXT,status TEXT,error TEXT,parent_execution_id TEXT,origin TEXT,start_time TEXT,end_time TEXT)');
  await run('CREATE TABLE workflow_executions(id TEXT,user_id TEXT,status TEXT,start_time TEXT,end_time TEXT)');
  return {db,run,get};
}
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(databases.splice(0).map(db=>new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()))));});
async function seed(f, owner=user) {
  for(const [id,u,status,error,parent,origin] of [
    ['failed',owner,'failed','error',null,'chat'],['stopped',owner,'stopped',null,null,'chat'],
    ['child',owner,'completed',null,'parent','chat'],['test',owner,'completed',null,null,'test'],
    ['foreign','someone_else','completed',null,null,'chat'],['successful',owner,'completed',null,null,'chat'],
  ]) await f.run('INSERT INTO agent_executions VALUES(?,?,?,?,?,?,?,?)',[id,u,status,error,parent,origin,start,end]);
  await f.run('INSERT INTO workflow_executions VALUES(?,?,?,?,?)',['workflow',owner,'completed',start,'2026-09-01T00:02:00.000Z']);
}
describe('activation milestones',()=>{
  it('selects actual successful roots by owner, not failed or child runs',async()=>{
    const f=await fixture();await seed(f);
    const rows=await collectActivationMilestones(f.db,user);
    expect(rows.map(r=>r.name)).toEqual(['first_agent_completed','first_workflow_completed','first_run_completed']);
    expect(rows[0].execution_id).toBe('successful');expect(rows[2].occurred_at).toBe(end);
  });
  it('does not count compression, experiment, evaluation or unknown origins as agent activation',async()=>{
    const f=await fixture();await seed(f);
    for(const origin of ['compaction','experiment','experiment_subject','fixture','goal_eval','system','insight','unknown']) {
      await f.run('INSERT INTO agent_executions VALUES(?,?,?,?,?,?,?,?)',['synthetic-'+origin,user,'completed',null,null,origin,start,'2026-09-01T00:00:20Z']);
    }
    const rows=await collectActivationMilestones(f.db,user);
    expect(rows[0].execution_id).toBe('successful');
  });
  it('durable retry preserves original timestamps and acknowledged events do not resend',async()=>{
    const f=await fixture();await seed(f);let time=Date.parse('2026-09-07T00:00:00Z');
    const fetchImpl=vi.fn().mockResolvedValueOnce({ok:false,status:503}).mockResolvedValue({ok:true,json:async()=>({success:true})});
    const options={db:f.db,userId:user,token:'fixture',appVersion:'0.6.6',enabled:true,now:()=>time,fetchImpl};
    await expect(syncActivationMilestones(options)).rejects.toThrow('HTTP 503');
    time+=61000;expect((await syncActivationMilestones(options)).sent).toBe(3);
    expect((await syncActivationMilestones(options)).sent).toBe(0);expect(fetchImpl).toHaveBeenCalledTimes(4);
    for(const [,request]of fetchImpl.mock.calls){const body=JSON.parse(request.body);expect(body.occurred_at.startsWith('2026-09-01')).toBe(true);expect(body).not.toHaveProperty('user_id');expect(Object.keys(body.meta).sort()).toEqual(['app_version','execution_id','source_event_id']);}
    expect((await f.get('SELECT COUNT(*) n FROM activation_milestone_outbox WHERE acknowledged_at IS NOT NULL')).n).toBe(3);
  });
  it('disabled telemetry reads no execution data and sends nothing',async()=>{
    const fetchImpl=vi.fn();expect(await syncActivationMilestones({db:null,userId:user,token:'fixture',enabled:false,fetchImpl})).toEqual({enabled:false,sent:0});
    vi.stubEnv('AGNT_DISABLE_TELEMETRY','1');expect(await syncActivationMilestones({db:null,userId:user,token:'fixture',enabled:true,fetchImpl})).toEqual({enabled:false,sent:0});expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('single-flights simultaneous delivery for an account',async()=>{
    const f=await fixture();await seed(f,'singleflight');const fetchImpl=vi.fn().mockResolvedValue({ok:true,json:async()=>({success:true})});
    const options={db:f.db,userId:'singleflight',token:'fixture',enabled:true,fetchImpl};await Promise.all([syncActivationMilestones(options),syncActivationMilestones(options)]);expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('HTTP handler rejects anonymous callers, respects DNT, and ignores body ownership',async()=>{
    const sync=vi.fn().mockResolvedValue({sent:1});const handler=activationMilestoneHandler({db:{},appVersion:'fixture',sync});
    const res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
    await handler({user:{},headers:{},body:{}},res);expect(res.status).toHaveBeenCalledWith(401);
    await handler({user:{userId:user,isAuthenticated:true},headers:{authorization:'Bearer fixture',dnt:'1'},body:{enabled:true}},res);expect(sync).not.toHaveBeenCalled();
    await handler({user:{userId:user,isAuthenticated:true},headers:{authorization:'Bearer fixture'},body:{enabled:true,userId:'forged'}},res);expect(sync.mock.calls[0][0].userId).toBe(user);
  });
});
