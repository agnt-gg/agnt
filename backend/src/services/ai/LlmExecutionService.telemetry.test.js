import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('./LlmService.js',()=>({createLlmClient:vi.fn(async()=>({}))}));
vi.mock('../orchestrator/llmAdapters.js',()=>({createLlmAdapter:vi.fn()}));
vi.mock('../orchestrator/tools.js',()=>({executeTool:vi.fn(),getAvailableToolSchemas:vi.fn(async()=>[])}));
vi.mock('../../utils/contextManager.js',()=>({manageContext:vi.fn(messages=>({messages})),estimateToolTokens:()=>1}));
vi.mock('../execution/LedgerRecorder.js',()=>({recordLlmCall:vi.fn(async()=>{})}));
import service from './LlmExecutionService.js';
import {createLlmAdapter} from '../orchestrator/llmAdapters.js';
import {executeTool} from '../orchestrator/tools.js';
const tool={id:'call',type:'function',function:{name:'fixture',arguments:'{}'}};
let send;
beforeEach(()=>{vi.clearAllMocks();service.cacheEnabled=false;let n=0;send=vi.fn(async()=>n++===0?{responseMessage:{role:'assistant',content:null,tool_calls:[tool]},toolCalls:[tool],usage:{prompt_tokens:10,completion_tokens:2}}:{responseMessage:{role:'assistant',content:'ok'},toolCalls:[],usage:{prompt_tokens:20,completion_tokens:3}});createLlmAdapter.mockResolvedValue({call:send,callStream:send,formatToolResults:x=>x});executeTool.mockResolvedValue('SECRET_TOOL_CONTENT');});
const run=stream=>{const c={provider:'openai',model:'fixture',userId:'u',messages:[{role:'user',content:'PRIVATE_PROMPT'}],toolSchemas:[{type:'function',function:{name:'fixture'}}]};return stream?service.executeWithToolsStreaming(c,()=>{}):service.executeWithTools(c);};
for(const stream of [false,true]){
 it(`Given ${stream?'stream':'plain'} success Then counts and usage cover actual requests`,async()=>{const r=await run(stream),t=r.executionTelemetry;expect(t.requestMetrics.requests).toHaveLength(2);expect(t.toolCalls).toEqual({started:1,finished:1,inFlight:0});expect(t.usage).toEqual({inputTokens:30,outputTokens:5,totalTokens:35});expect(t.usageCoverage).toBe('complete');expect(JSON.stringify(t)).not.toMatch(/SECRET_TOOL_CONTENT|PRIVATE_PROMPT/);});
 it(`Given ${stream?'stream':'plain'} second model call fails Then keep first usage and tool observations`,async()=>{send.mockImplementationOnce(async()=>({responseMessage:{role:'assistant',content:null,tool_calls:[tool]},toolCalls:[tool],usage:{input_tokens:10,output_tokens:2}})).mockRejectedValueOnce(Error('down'));await expect(run(stream)).rejects.toMatchObject({executionTelemetry:{outcome:'failed',usageCoverage:'partial',toolCalls:{started:1,finished:1,inFlight:0},requestMetrics:{requests:expect.arrayContaining([expect.objectContaining({requestIndex:2})])}}});});
 it(`Given ${stream?'stream':'plain'} missing usage Then unknown remains null`,async()=>{send.mockResolvedValue({responseMessage:{role:'assistant',content:'ok'},toolCalls:[]});expect((await run(stream)).executionTelemetry).toMatchObject({usage:null,usageCoverage:'unknown'});});
 it(`Given ${stream?'stream':'plain'} tool throws Then count dispatch without claiming effect success`,async()=>{executeTool.mockRejectedValue(Error('uncertain effect'));expect((await run(stream)).executionTelemetry).toMatchObject({toolCalls:{started:1,finished:1,inFlight:0},effectDisposition:'tool_calls_observed_effects_not_verified'});});
}
it('Given cancellation while tool in flight Then preserve uncertainty without awaiting/replaying the tool',async()=>{const controller=new AbortController();executeTool.mockImplementation(()=>new Promise(()=>{}));const promise=service.executeWithTools({provider:'openai',model:'fixture',userId:'u',messages:[{role:'user',content:'x'}],toolSchemas:[],signal:controller.signal});await vi.waitFor(()=>expect(executeTool).toHaveBeenCalledTimes(1));controller.abort();await expect(promise).rejects.toMatchObject({executionTelemetry:{outcome:'cancelled',toolCalls:{started:1,finished:0,inFlight:1},effectDisposition:'in_flight_or_unknown'}});});

it('Accessor on thrown exception cannot forge host measurements',async()=>{
 const {takeFailureTelemetry}=await import('./executionTelemetry.js');
 const fake=Object.assign(Error('accessor'),{});Object.defineProperty(fake,'executionTelemetry',{get:()=>({version:1,outcome:'completed',usage:null,usageCoverage:'unknown',toolCalls:{started:0,finished:0,inFlight:0}}),set:()=>{}});
 send.mockRejectedValue(fake);
 try {await run(false);throw Error('must fail');}catch(error){const t=takeFailureTelemetry(error);expect(t.outcome).toBe('failed');expect(t.requestMetrics.requests).toHaveLength(1);}
});
