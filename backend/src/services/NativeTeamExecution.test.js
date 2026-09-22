import {it,expect,vi} from 'vitest';import sqlite3 from 'sqlite3';
import {TeamRepository} from './TeamRepository.js';import {NativeTeamExecution,initializeNativeTeamExecution} from './NativeTeamExecution.js';
import service from './ai/LlmExecutionService.js';
vi.mock('./ai/LlmExecutionService.js',()=>({default:{executeWithTools:vi.fn(async config=>({content:'native result',owner:config.userId}))}}));

async function fixture(run){
 const db=new sqlite3.Database(':memory:');const r=new TeamRepository(db);await r.ready;await initializeNativeTeamExecution(r);
 try{
  const team=await r.create('owner','o@example.test','Team');team.tenantSlug='tenant';
  const invite=await r.invite(team.id,'owner','m@example.test','member');await r.accept('member','m@example.test',invite.token);
  const asset=await r.save(team.id,'owner',{name:'Agent',kind:'agent',content:JSON.stringify({systemPrompt:'Summarize'})});
  const cloud={request:vi.fn(async(_auth,path)=>path.endsWith('connections')?[{id:'c',providerId:'openai'},{id:'g',providerId:'github'}]:{id:'principal',token:'durable-secret'})};
  await run({r,team,asset,execution:new NativeTeamExecution(r,cloud)});
 }finally{await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
}
const scope={id:'workspace:w',resourceOwnerId:'scope-owner'};

it('runs only what was published, as the project owner, never a member session',()=>fixture(async({r,team,asset,execution})=>{
 await expect(execution.run(team,'member',asset.id,'hello',scope)).rejects.toMatchObject({status:409,code:'publish_required'});
 await execution.bind({...team,role:'owner'},'owner','Bearer session',asset.id,{workspaceId:'w',hints:{provider:'openai',model:'model-test'}});
 const binding=await r.get('SELECT * FROM team_native_bindings WHERE asset_id=?',[asset.id]);
 expect(binding).toMatchObject({connection_id:'c',provider:'openai',model:'model-test'});
 expect(binding.principal_secret).not.toBe('durable-secret');expect(binding.principal_secret).not.toContain('session');
 const result=await execution.run(team,'member',asset.id,'hello',scope);
 expect(result.status).toBe('completed');expect(result.result.owner).toBe('scope-owner');
 expect((await r.get('SELECT * FROM team_native_runs WHERE id=?',[result.runId])).actor_id).toBe('member');
}));

it('editing a published item makes a draft; the published version keeps running until it is published again',()=>fixture(async({r,team,asset,execution})=>{
 await execution.bind({...team,role:'owner'},'owner','Bearer session',asset.id,{workspaceId:'w',hints:{provider:'openai',model:'model-test'}});
 await r.save(team.id,'member',{id:asset.id,name:'Agent',kind:'agent',content:JSON.stringify({systemPrompt:'Edited, not yet published'}),expectedRevision:1});
 service.executeWithTools.mockClear();
 const result=await execution.run(team,'member',asset.id,'hello',scope);
 expect(result.status).toBe('completed');
 expect(service.executeWithTools).toHaveBeenCalledWith(expect.objectContaining({systemPrompt:'Summarize'}));
 await execution.bind({...team,role:'admin'},'owner','Bearer session',asset.id,{workspaceId:'w',hints:{provider:'openai',model:'model-test'}});
 await execution.run(team,'member',asset.id,'hello',scope);
 expect(service.executeWithTools).toHaveBeenLastCalledWith(expect.objectContaining({systemPrompt:'Edited, not yet published'}));
}));

it('owners and admins publish; members cannot, and a missing team connection says exactly what to connect',()=>fixture(async({team,asset,execution})=>{
 await expect(execution.bind({...team,role:'member'},'member','Bearer s',asset.id,{workspaceId:'w',hints:{provider:'openai',model:'m'}})).rejects.toMatchObject({status:403});
 await expect(execution.bind({...team,role:'owner'},'owner','Bearer s',asset.id,{workspaceId:'w',hints:{provider:'anthropic',model:'m'}})).rejects.toMatchObject({status:409,code:'connection_required',provider:'anthropic'});
 await expect(execution.bind({...team,role:'owner'},'owner','Bearer s',asset.id,{workspaceId:'w',hints:{provider:'openai'}})).rejects.toMatchObject({status:400});
 // With several connections and no provider hint, it asks rather than guessing.
 await expect(execution.bind({...team,role:'owner'},'owner','Bearer s',asset.id,{workspaceId:'w',hints:{model:'m'}})).rejects.toMatchObject({status:409,code:'connection_required'});
}));
