import { describe, it, expect, vi, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'node:fs';
const database = new sqlite3.Database(':memory:');
vi.mock('../../models/database/index.js', () => ({ default: database }));
vi.mock('../../libs/agnt2.js',()=>({default:{}}));
vi.mock('../../tools/library/triggers/LocalEmailReceiver.js',()=>({default:{}}));
vi.mock('node-fetch', () => ({ default: vi.fn(() => { throw new Error('Network forbidden in memory tests'); }) }));
const run=(sql,params=[])=>new Promise((resolve,reject)=>database.run(sql,params,function(error){error?reject(error):resolve(this)}));
const all=(sql,params=[])=>new Promise((resolve,reject)=>database.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
const schema=fs.readFileSync(new URL('../../models/database/index.js',import.meta.url),'utf8');
for(const table of ['agent_memory','agent_executions','agent_tool_executions']) await run(schema.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\)`'))[0].slice(0,-1));
await run('CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,status TEXT,created_by TEXT)');
for(const column of ['content_shape TEXT','occurrence_count INTEGER DEFAULT 1','last_seen_at TEXT']) await run('ALTER TABLE agent_memory ADD COLUMN '+column);
await run('CREATE VIRTUAL TABLE agent_memory_fts USING fts5(doc_id UNINDEXED,content)');
await run('CREATE TRIGGER memory_insert AFTER INSERT ON agent_memory BEGIN INSERT INTO agent_memory_fts(doc_id,content) VALUES(new.id,new.content); END');
const { TOOLS }=await import('./tools.js');
const { injectTaskMemory }=await import('./taskMemory.js');
const { default: Executions }=await import('../../models/AgentExecutionModel.js');
const { default: MemorySearch }=await import('../MemorySearchService.js');
const { DEFAULT_TOOLS }=await import('./toolSelector.js');
const { AGENT_DEFAULT_TOOLS }=await import('./chatConfigs.js');
const context={userId:'u1',agentId:'orchestrator',executionId:'episode-1',conversationId:'conversation-1',latestUserMessage:'Check packaged native architecture.'};
for(const [id,user] of [['episode-1','u1'],['episode-2','u1'],['foreign-episode','u2']]) await run('INSERT INTO agent_executions(id,user_id,status,initial_prompt) VALUES(?,?,?,?)',[id,user,'running','Check packaged native architecture']);
const invoke=async(name,args,ctx=context)=>JSON.parse(await TOOLS[name].execute(args,'fixture',ctx));
const lesson={when:'Checking packaged native architecture',action:'Inspect CPU headers before claiming release compatibility',boundary:'This is not a launch test',evidence:'Packaged binary target differed from host'};
let memoryId;
afterAll(()=>new Promise(resolve=>database.close(resolve)));
describe('real memory tool handlers and trace receipts',()=>{
  it('registers the receipt on default chat and agent tool surfaces',()=>{
    expect(TOOLS.record_memory_use.schema.function.name).toBe('record_memory_use');
    expect(DEFAULT_TOOLS.has('record_memory_use')).toBe(true);
    expect(AGENT_DEFAULT_TOOLS.has('record_memory_use')).toBe(true);
  });
  it('retains a structured lesson once, then retrieves it in a later conversation',async()=>{
    const saved=await invoke('save_agent_memory',{memory_type:'pattern',content:'Ignored preview',lesson});
    expect(saved.success).toBe(true); memoryId=saved.id;
    for(let i=0;i<260;i++) await run('INSERT INTO agent_memory(id,agent_id,user_id,memory_type,content) VALUES(?,?,?,?,?)',['noise'+i,'orchestrator','u1','context','garden unrelated']);
    const next={...context,executionId:'episode-2',conversationId:'conversation-2',latestUserMessage:'Validate release CPU compatibility'};
    const messages=[{role:'user',content:next.latestUserMessage}];
    await injectTaskMemory(messages,next);
    expect(next.taskMemoryIds).toContain(memoryId);
    const fetched=await invoke('get_agent_memories',{memory_id:memoryId},next);
    expect(fetched.memories[0].content).toContain('Source execution: episode-1');
    expect(fetched.memories[0].content).toContain('Boundary: This is not a launch test');
    const again=await invoke('save_agent_memory',{memory_type:'pattern',content:'preview',lesson},next);
    expect(again.id).toBe(memoryId);
    expect(await all('SELECT COUNT(*) count FROM agent_memory WHERE id=?',[memoryId])).toEqual([{count:1}]);
  });
  it('searches by query and refuses ambiguous or foreign-ID fetches',async()=>{
    expect((await invoke('get_agent_memories',{query:'CPU compatibility'})).memories.map(m=>m.id)).toContain(memoryId);
    expect((await invoke('get_agent_memories',{memory_id:memoryId,query:'CPU'})).success).toBe(false);
    expect((await invoke('get_agent_memories',{memory_id:''})).success).toBe(false);
    expect((await invoke('get_agent_memories',{memory_id:memoryId},{...context,userId:'u2'})).memories).toEqual([]);
    expect((await invoke('get_agent_memories',{},{})).success).toBe(false);
  });
  it('rejects summaries, unsupported facts and lessons without executions',async()=>{
    for(const args of [{memory_type:'context',content:'Today we built X'},{memory_type:'fact',content:'User owns X',user_statement:'I own X'},{memory_type:'pattern',content:'Always use tool X'}]) expect((await invoke('save_agent_memory',args)).success).toBe(false);
    expect((await invoke('save_agent_memory',{memory_type:'pattern',content:'x',lesson},{...context,executionId:null})).success).toBe(false);
  });
  it('supports an explicit preference quoted from the real user request',async()=>{
    const result=await invoke('save_agent_memory',{memory_type:'preference',content:'User prefers compact reports',user_statement:'I prefer compact reports'},{...context,latestUserMessage:'I prefer compact reports please'});
    expect(result.success).toBe(true);
  });
  it('logs reported application using the existing real execution logger',async()=>{
    const executionId='episode-2',evidenceId='inspect-call';
    const evidenceRow=await Executions.createToolExecution(executionId,'inspect_binary',evidenceId,{target:'fixture'});
    await Executions.updateToolExecution(evidenceRow,'completed',{cpu:'x64'});
    const before=await all('SELECT COUNT(*) count, SUM(access_count) access, SUM(relevance_score) relevance FROM agent_memory');
    const args={memory_id:memoryId,application:'Inspected packaged CPU before declaring compatibility',evidence_tool_call_ids:[evidenceId]};
    const receiptRow=await Executions.createToolExecution(executionId,'record_memory_use','receipt-call',args);
    const receipt=await invoke('record_memory_use',args,{...context,executionId});
    expect(receipt.success).toBe(true);
    expect(receipt.status).toBe('reported_application');
    await Executions.updateToolExecution(receiptRow,'completed',receipt);
    const trace=await MemorySearch.getTrace({executionId,userId:'u1'});
    expect(trace.toolExecutions.find(t=>t.id===receiptRow).output.memory_id).toBe(memoryId);
    expect(await all('SELECT COUNT(*) count, SUM(access_count) access, SUM(relevance_score) relevance FROM agent_memory')).toEqual(before);
    expect(await MemorySearch.getTrace({executionId,userId:'u2'})).toBeNull();
  });
  it('refuses foreign, nonexistent, pending and self-referential evidence',async()=>{
    const id=await Executions.createToolExecution('foreign-episode','inspect_binary','foreign-call',{});
    await Executions.updateToolExecution(id,'completed',{});
    await Executions.createToolExecution('episode-2','inspect_binary','pending-call',{});
    for(const evidence of [['foreign-call'],['missing'],['pending-call'],['receipt-call']]) {
      const result=await invoke('record_memory_use',{memory_id:memoryId,application:'Used it',evidence_tool_call_ids:evidence},{...context,executionId:'episode-2'});
      expect(result.success).toBe(false);
    }
    expect((await invoke('record_memory_use',{memory_id:memoryId,application:'Used it'},{...context,executionId:'foreign-episode'})).success).toBe(false);
  });
  it('validates receipt arguments and never silently creates a missing memory',async()=>{
    for(const args of [{memory_id:'missing',application:'used'},{memory_id:memoryId,application:''},{memory_id:memoryId,application:'a'.repeat(1001)},{memory_id:memoryId,application:'used',evidence_tool_call_ids:'bad'}]) expect((await invoke('record_memory_use',args)).success).toBe(false);
  });
});
