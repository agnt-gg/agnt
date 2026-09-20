import {it,expect,vi} from 'vitest';import sqlite3 from 'sqlite3';
import {TeamRepository} from './TeamRepository.js';import {NativeTeamExecution,initializeNativeTeamExecution} from './NativeTeamExecution.js';
vi.mock('./ai/LlmExecutionService.js',()=>({default:{executeWithTools:vi.fn(async config=>({content:'native result',owner:config.userId}))}}));
it('executes the native LLM path with a durable approval, never a member session, and invalidates approval on edit',async()=>{
 const db=new sqlite3.Database(':memory:');const r=new TeamRepository(db);await r.ready;await initializeNativeTeamExecution(r);
 try{const team=await r.create('owner','o@example.test','Team');const invite=await r.invite(team.id,'owner','m@example.test','member');await r.accept('member','m@example.test',invite.token);
 const asset=await r.save(team.id,'owner',{name:'Agent',kind:'agent',content:JSON.stringify({systemPrompt:'Summarize'})});
 const cloud={request:vi.fn(async(_auth,path)=>path.endsWith('connections')?[{id:'c',providerId:'openai'}]:{id:'principal',token:'durable-secret'})};
 const execution=new NativeTeamExecution(r,cloud);await expect(execution.run(team,'member',asset.id,'hello',{id:'team:'+team.id,resourceOwnerId:'scope-owner'})).rejects.toMatchObject({status:409});
 await execution.bind({...team,role:'owner'},'owner','Bearer session',asset.id,{connectionId:'c',provider:'openai',model:'model-test'});
 const binding=await r.get('SELECT * FROM team_native_bindings WHERE asset_id=?',[asset.id]);expect(binding.principal_secret).not.toBe('durable-secret');expect(binding.principal_secret).not.toContain('session');
 const result=await execution.run(team,'member',asset.id,'hello',{id:'team:'+team.id,resourceOwnerId:'scope-owner'});expect(result.status).toBe('completed');expect(result.result.owner).toBe('scope-owner');expect((await r.get('SELECT * FROM team_native_runs WHERE id=?',[result.runId])).actor_id).toBe('member');
 await r.save(team.id,'member',{id:asset.id,name:'Agent',kind:'agent',content:'{}',expectedRevision:1});await expect(execution.run(team,'member',asset.id,'hello',{})).rejects.toMatchObject({status:409});
 }finally{await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
});
