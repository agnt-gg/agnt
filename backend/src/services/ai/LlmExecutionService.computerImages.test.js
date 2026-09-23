import { beforeEach, describe, expect, it, vi } from 'vitest';
import { observationImages } from '../computerUse/observationImages.js';
const mocks=vi.hoisted(()=>({adapter:{call:vi.fn(),callStream:vi.fn(),formatToolResults:results=>results},execute:vi.fn()}));
vi.mock('./LlmService.js',()=>({createLlmClient:async()=>({})}));
vi.mock('../orchestrator/llmAdapters.js',()=>({createLlmAdapter:async()=>mocks.adapter}));
vi.mock('../orchestrator/tools.js',()=>({executeTool:(...args)=>mocks.execute(...args)}));
vi.mock('../execution/LedgerRecorder.js',()=>({recordLlmCall:vi.fn()}));
import service from './LlmExecutionService.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZdU0v8AAAAASUVORK5CYII=';
const tool={id:'shot',type:'function',function:{name:'computer_observe',arguments:'{}'}};
beforeEach(()=>vi.clearAllMocks());
describe('workflow/goal loop delivers observation pixels',()=>{
 it.each([false,true])('streaming=%s uses the same typed image context',async streaming=>{
  const captured=[];let requests=0;
  const respond=async(messages,schemas,context)=>{
   captured.push(JSON.parse(JSON.stringify({messages,images:context?.computerImages})));
   return requests++===0 ? {responseMessage:{role:'assistant',content:'',tool_calls:[tool]},toolCalls:[tool]} : {responseMessage:{role:'assistant',content:'done'},toolCalls:[]};
  };
  mocks.adapter.call.mockImplementation(respond);
  mocks.adapter.callStream.mockImplementation((messages,schemas,onChunk,context)=>respond(messages,schemas,context));
  mocks.execute.mockResolvedValue(JSON.stringify({success:true,modelImages:observationImages(png),imageHtml:`<img src="data:image/png;base64,${png}">`}));
  const config={provider:'openai',model:'gpt-4o',userId:'fixture',messages:[{role:'user',content:'observe'}],toolSchemas:[{type:'function',function:{name:'computer_observe',parameters:{type:'object',properties:{}}}}],maxToolRounds:2};
  if(streaming)await service.executeWithToolsStreaming(config,()=>{});else await service.executeWithTools(config);
  expect(captured).toHaveLength(2);
  expect(captured[1].images).toHaveLength(1);
  expect(captured[1].images[0].data).toBe(png);
  expect(JSON.stringify(captured[1].messages)).not.toContain(png);
 });
});
