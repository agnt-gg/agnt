import {it,expect,vi} from 'vitest';import sqlite3 from 'sqlite3';
import db,{dbReady} from '../models/database/index.js';import {TeamRepository} from './TeamRepository.js';import {NativeTeamExecution,initializeNativeTeamExecution} from './NativeTeamExecution.js';import {databaseRepository,ensureSharedScope} from './authorization/ScopeRepository.js';import {migrateOwnership} from './authorization/OwnershipMigration.js';import {OWNERSHIP_INVENTORY} from './authorization/OwnershipInventory.js';import {installOwnershipTriggers} from './authorization/OwnershipTriggers.js';
const {calls}=vi.hoisted(()=>({calls:[]}));
vi.mock('./authorization/TeamBrokerClient.js',()=>({TeamBrokerClient:class{sdk(){const create=async body=>{calls.push(body);return {choices:[{message:{role:'assistant',content:'Native shared response'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:3,total_tokens:8}};};return{chat:{completions:{create}}};}}}));
it('runs real native agent, AI tool and workflow engines with only a broker SDK',async()=>{
 await dbReady;const native=databaseRepository(db);await migrateOwnership(native);await installOwnershipTriggers(native,OWNERSHIP_INVENTORY);const scope=await ensureSharedScope(native,'integration-team','w');
 const teamDb=new sqlite3.Database(':memory:');const r=new TeamRepository(teamDb);await r.ready;await initializeNativeTeamExecution(r);
 try{const team=await r.create('owner','owner@example.test','Integration');team.tenantSlug='tenant';const cloud={request:async(_token,path)=>path.endsWith('connections')?[{id:'connection',providerId:'groq'}]:{id:'principal',token:'secret'}};const service=new NativeTeamExecution(r,cloud);
 for(const [kind,definition] of [['agent',{systemPrompt:'Reply briefly'}],['tool',{base:'AI',instructions:'Reply briefly'}],['workflow',{nodes:[{id:'start',type:'generic-trigger',category:'trigger',text:'Start',parameters:{}},{id:'ai',type:'generate-with-ai-llm',category:'action',text:'AI',parameters:{prompt:'Hello'}}],edges:[{id:'edge',start:{id:'start'},end:{id:'ai'}}]}]]){
  const asset=await r.save(team.id,'owner',{name:kind,kind,content:JSON.stringify(definition)});await service.bind({...team,role:'owner'},'owner','Bearer test',asset.id,{connectionId:'connection',provider:'groq',model:'test-model',workspaceId:'w'});
  const run=await service.run(team,'owner',asset.id,'Hello',scope);expect(run.status,JSON.stringify(run)).toBe('completed');
 }
 expect(calls.length).toBeGreaterThanOrEqual(3);
 }finally{await new Promise((resolve,reject)=>teamDb.close(e=>e?reject(e):resolve()));}
},60000);
