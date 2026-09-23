import {beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
vi.mock('../../models/AgentModel.js',()=>({default:{findOne:vi.fn()}}));
vi.mock('./agentRuntime.js',()=>({buildAgentRuntime:vi.fn(async()=>({systemPrompt:'Fixture',toolSchemas:[{type:'function',function:{name:'fixture',parameters:{type:'object',properties:{}}}}],context:{}}))}));
vi.mock('../ai/LlmService.js',()=>({createLlmClient:vi.fn(async()=>({}))}));
vi.mock('./llmAdapters.js',()=>({createLlmAdapter:vi.fn()}));
vi.mock('./tools.js',()=>({executeTool:vi.fn(async()=>'{"ok":true}'),getAvailableToolSchemas:vi.fn(async()=>[])}));
vi.mock('../execution/LedgerRecorder.js',()=>({recordLlmCall:vi.fn(async()=>{})}));
import db,{dbReady} from '../../models/database/index.js';
import Model from '../../models/AgentExecutionModel.js';
import Agent from '../../models/AgentModel.js';
import {AGENT_TOOLS} from './agentTools.js';
import {createLlmAdapter} from './llmAdapters.js';
import service from '../ai/LlmExecutionService.js';
const run=(q,p=[])=>new Promise((r,j)=>db.run(q,p,function(e){e?j(e):r(this.changes)}));
let user;
beforeAll(async()=>{const root=fs.realpathSync(process.env.__AGNT_TEST_DATA_DIR);expect(root).toBe(fs.realpathSync(process.env.USER_DATA_PATH));await dbReady;const files=await new Promise((r,j)=>db.all('PRAGMA database_list',(e,v)=>e?j(e):r(v)));expect(fs.realpathSync(files.find(x=>x.name==='main').file)).toBe(path.join(root,'Data','agnt.db'));console.log('PHYSICAL_ISOLATION',root); user=randomUUID();await run('INSERT INTO users(id,email,name) VALUES(?,?,?)',[user,user+'@test.local','fixture']);await run('INSERT INTO agents(id,name,status,created_by) VALUES(?,?,?,?)',['fixture-agent','Fixture','active',user]);});
beforeEach(()=>{vi.clearAllMocks();service.cacheEnabled=false;Agent.findOne.mockResolvedValue({id:'fixture-agent',created_by:user,name:'Fixture',provider:'openai',model:'fixture'});});
for(const fail of [false,true])it(`Given real run_agent/task adapter/execution service/SQLite When second response ${fail?'fails':'succeeds'} Then returned and retrieved evidence agree`,async()=>{
 let n=0;const tc={id:'tc',type:'function',function:{name:'fixture',arguments:'{}'}};
 createLlmAdapter.mockResolvedValue({formatToolResults:x=>x,call:async()=>{if(n++===0)return{responseMessage:{role:'assistant',content:null,tool_calls:[tc]},toolCalls:[tc],usage:{input_tokens:10,output_tokens:2}};if(fail)throw Error('fixture outage');return{responseMessage:{role:'assistant',content:'Done'},toolCalls:[],usage:{input_tokens:20,output_tokens:3}};}});
 const r=JSON.parse(await AGENT_TOOLS.run_agent.execute({agentId:'fixture-agent',parameters:{task:'Read fixture'}},null,{userId:user}));
 const d=await Model.getExecutionDetails(r.executionId);
 {expect(d.returnedToolReceipts.receipts).toEqual([{name:'fixture',callId:'tc',input:{},output:{ok:true}}]);expect(r.receiptPersistence).toBe('recorded');expect(d.returnedToolReceipts.completeness).toBe('returned_set_complete');console.log('RECEIPT_READBACK',JSON.stringify({executionId:r.executionId,receipts:d.returnedToolReceipts}));}expect(r.success).toBe(!fail);expect(d.status).toBe(fail?'failed':'completed');expect(d.executionTelemetry).toEqual(r.executionTelemetry);
 expect(d.executionTelemetry.requestMetrics.requests).toHaveLength(2);expect(d.executionTelemetry.toolCalls.started).toBe(1);
 expect(d.executionTelemetry.usageCoverage).toBe(fail?'partial':'complete');expect(d.telemetryAvailability).toBe('available');
});

for(const name of ['AbortError','GoalCancelledError'])it('Host '+name+' after a returned tool retains native receipt and stopped outcome',async()=>{
 let n=0;const tc={id:'cancel-call',type:'function',function:{name:'fixture',arguments:'{}'}};
 createLlmAdapter.mockResolvedValue({formatToolResults:x=>x,call:async()=>{if(n++===0)return{responseMessage:{role:'assistant',content:null,tool_calls:[tc]},toolCalls:[tc]};throw Object.assign(Error('cancel'),{name});}});
 const r=JSON.parse(await AGENT_TOOLS.run_agent.execute({agentId:'fixture-agent',parameters:{task:'fixture'}},null,{userId:user}));
 const d=await Model.getExecutionDetails(r.executionId);expect(r.outcome).toBe('cancelled');expect(d.status).toBe('stopped');expect(d.returnedToolReceipts.receipts[0].callId).toBe('cancel-call');expect(r.receiptPersistence).toBe('recorded');expect(d.executionTelemetry.usage).toBeNull();
});

it('Given saved-agent dispatch Then no arbitrary request byte ceiling is supplied',async()=>{
 const spy=vi.spyOn(service,'executeWithTools');
 createLlmAdapter.mockResolvedValue({formatToolResults:x=>x,call:async()=>({responseMessage:{role:'assistant',content:'done'},toolCalls:[]})});
 try{const r=JSON.parse(await AGENT_TOOLS.run_agent.execute({agentId:'fixture-agent',parameters:{task:'fixture'}},null,{userId:user}));expect(r.success).toBe(true);expect(spy).toHaveBeenCalledTimes(1);expect(Object.hasOwn(spy.mock.calls[0][0],'requestBudgetBytes')).toBe(false);expect(r.requestMetrics.requests.length).toBe(1);}finally{spy.mockRestore();}
});
