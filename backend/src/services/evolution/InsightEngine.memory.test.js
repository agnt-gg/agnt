import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../models/database/index.js',()=>({default:{get:vi.fn((sql,params,cb)=>cb(null,sql.includes('agent_executions')?{id:params[0]}:null)),all:vi.fn((sql,params,cb)=>cb(null,[]))}}));
vi.mock('../../models/AgentExecutionModel.js',()=>({default:{getExecutionDetails:vi.fn()}}));
vi.mock('../../models/AgentMemoryModel.js',()=>({default:{searchRelevant:vi.fn(),create:vi.fn()}}));
vi.mock('../../models/InsightModel.js',()=>({default:{findDuplicate:vi.fn(),create:vi.fn(),updateStatus:vi.fn()}}));
vi.mock('../ai/LlmService.js',()=>({createLlmClient:vi.fn(()=>{throw new Error('No LLM network in test')})}));
vi.mock('../goal/TraceAnalyzer.js',()=>({default:{analyzeTrace:vi.fn()}}));
vi.mock('./ContractsService.js',()=>({default:{mineForTool:vi.fn(async()=>[])}}));
vi.mock('./ExtractionGate.js',()=>({shouldExtract:vi.fn(async()=>({extract:true})),workflowSignature:vi.fn(()=> 'shape')}));
const {default:Engine}=await import('./InsightEngine.js');
const {default:Memory}=await import('../../models/AgentMemoryModel.js');
const {default:Executions}=await import('../../models/AgentExecutionModel.js');
const {default:Insights}=await import('../../models/InsightModel.js');
const {default:Trace}=await import('../goal/TraceAnalyzer.js');
const {default:db}=await import('../../models/database/index.js');
const lesson={when:'native release',action:'Inspect architecture',boundary:'Not launch proof',evidence:'Packaged CPU differed'};
const raw=(extra={})=>({category:'tool_preference',title:'Observation',description:'Evidence of behavior',...extra});
let extracted;
beforeEach(()=>{
  vi.restoreAllMocks(); vi.clearAllMocks();
  db.get.mockImplementation((sql,params,cb)=>cb(null,sql.includes('agent_executions')?{id:params[0]}:null));
  db.all.mockImplementation((sql,params,cb)=>cb(null,[]));
  Executions.getExecutionDetails.mockResolvedValue({id:'run1',initialPrompt:'I prefer compact reports',finalResponse:'A completed investigation and demonstrated output '.repeat(5),toolExecutions:[]});
  Memory.searchRelevant.mockResolvedValue([]); Memory.create.mockResolvedValue('lesson1');
  Insights.findDuplicate.mockResolvedValue(null); Insights.create.mockResolvedValue('insight1'); Insights.updateStatus.mockResolvedValue(1);
  extracted=vi.spyOn(Engine,'_llmExtractChatInsights');
});
describe('one durable lesson or nothing',()=>{
  it('preserves five ordinary insights while writing no memories',async()=>{
    extracted.mockResolvedValue(Array.from({length:5},()=>raw()));
    expect(await Engine._extractFromChat('run1','u1',{})).toHaveLength(5);
    expect(Insights.create).toHaveBeenCalledTimes(5); expect(Memory.create).not.toHaveBeenCalled();
  });
  it('returns no lesson for an empty extraction',async()=>{
    extracted.mockResolvedValue([]);
    expect(await Engine._extractFromChat('run1','u1',{})).toEqual([]);
    expect(Memory.create).not.toHaveBeenCalled();
  });
  it('retains at most one valid lesson with the source execution',async()=>{
    extracted.mockResolvedValue([raw({lesson}),raw({lesson:{...lesson,action:'Other behavior'}})]);
    await Engine._extractFromChat('run1','u1',{});
    expect(Memory.create).toHaveBeenCalledOnce();
    expect(Memory.create.mock.calls[0][0]).toMatchObject({userId:'u1',memoryType:'pattern'});
    expect(Memory.create.mock.calls[0][0].content).toContain('Source execution: run1');
  });
  it('does not let a malformed candidate block a later valid lesson',async()=>{
    extracted.mockResolvedValue([null,raw({lesson:{when:'missing'}}),raw({lesson})]);
    await Engine._extractFromChat('run1','u1',{});
    expect(Memory.create).toHaveBeenCalledOnce();
  });
  it('passes existing memories to the same extraction call without adding inference',async()=>{
    Memory.searchRelevant.mockResolvedValue([{id:'old',content:'Known lesson'}]);
    extracted.mockResolvedValue([]);
    await Engine._extractFromChat('run1','u1',{});
    expect(extracted).toHaveBeenCalledOnce();
    expect(extracted.mock.calls[0][4]).toEqual([{id:'old',content:'Known lesson'}]);
  });
  it('supports facts only with actual user wording and records disposition',async()=>{
    extracted.mockResolvedValue([raw({category:'memory',memoryType:'preference',memoryContent:'Compact reports',userStatement:'I prefer compact reports'})]);
    await Engine._extractFromChat('run1','u1',{});
    expect(Memory.create).toHaveBeenCalledOnce();
    expect(Insights.updateStatus).toHaveBeenCalledWith('insight1','applied',{type:'memory_stored',memoryId:'lesson1'});
    Memory.create.mockClear();
    extracted.mockResolvedValue([raw({category:'memory',memoryType:'fact',memoryContent:'Invented',userStatement:'I own a boat'})]);
    await Engine._extractFromChat('run1','u1',{});
    expect(Memory.create).not.toHaveBeenCalled();
    expect(Insights.updateStatus).toHaveBeenLastCalledWith('insight1','rejected',{type:'memory_not_retained',memoryId:null});
  });
  it('uses full server request rather than the truncated execution preview',async()=>{
    const full='Please investigate '.repeat(100)+'I prefer detailed receipts';
    extracted.mockResolvedValue([raw({category:'memory',memoryType:'preference',memoryContent:'Detailed receipts',userStatement:'I prefer detailed receipts'})]);
    await Engine._extractFromChat('run1','u1',{latestUserMessage:full});
    expect(Memory.create).toHaveBeenCalledOnce();
    expect(extracted.mock.calls[0][0]).toContain('I prefer detailed receipts');
  });
  it('refuses foreign execution before reading details or calling inference',async()=>{
    db.get.mockImplementation((sql,params,cb)=>cb(null,null));
    expect(await Engine._extractFromChat('foreign','u1',{})).toEqual([]);
    expect(Executions.getExecutionDetails).not.toHaveBeenCalled(); expect(extracted).not.toHaveBeenCalled();
  });
  it('keeps goal patterns as insights without promoting free-form memory',async()=>{
    Trace.analyzeTrace.mockResolvedValue({patterns:[{name:'P',description:'pattern'}],antipatterns:[{name:'A',description:'avoid'}],insights:['observation']});
    expect(await Engine._extractFromGoal('goal','u1',{})).toHaveLength(3);
    expect(Memory.create).not.toHaveBeenCalled();
  });
  it('keeps workflow insights without memory writes',async()=>{
    db.get.mockImplementation((sql,params,cb)=>cb(null,{id:'wf-run',workflow_id:'wf'}));
    db.all.mockImplementation((sql,params,cb)=>cb(null,[{node_id:'a'},{node_id:'b'}]));
    vi.spyOn(Engine,'_llmExtractWorkflowInsights').mockResolvedValue([raw()]);
    expect(await Engine._extractFromWorkflow('wf-run','u1',{})).toHaveLength(1);
    expect(Memory.create).not.toHaveBeenCalled();
  });
  it('keeps aggregate tool bottlenecks as insights without memory writes',async()=>{
    db.all.mockImplementation((sql,params,cb)=>cb(null,[{tool_name:'fixture',call_count:20,fail_count:15,success_count:5,avg_duration_sec:5}]));
    expect(await Engine._extractFromToolUsage('aggregate','u1',{})).toHaveLength(1);
    expect(Memory.create).not.toHaveBeenCalled();
  });
  it('retains observations when a memory write fails',async()=>{
    extracted.mockResolvedValue([raw({lesson})]);Memory.create.mockRejectedValueOnce(new Error('disk fixture'));
    expect(await Engine._extractFromChat('run1','u1',{})).toHaveLength(1);
  });
});
