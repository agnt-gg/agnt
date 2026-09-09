import { describe, expect, it } from 'vitest';
import { createLlmAdapter } from './llmAdapters.js';
import { captureComputerImages, observationImages } from '../computerUse/observationImages.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZdU0v8AAAAASUVORK5CYII=';
function contextWithToolResult(){
 const context={};const content=captureComputerImages(JSON.stringify({success:true,modelImages:observationImages(png,{pid:12,windowId:34,snapshotId:'s'})}),'computer_observe','shot',context);
 return {context,result:{role:'tool',name:'computer_observe',tool_call_id:'shot',content}};
}
const call={id:'shot',type:'function',function:{name:'computer_observe',arguments:'{}'}};
const history=[{role:'system',content:'test'},{role:'user',content:'look at window'},{role:'assistant',content:'',tool_calls:[call]}];
const anthropicHistory=[...history.slice(0,2),{role:'assistant',content:[{type:'tool_use',id:'shot',name:'computer_observe',input:{}}]}];
const geminiHistory=[...history.slice(0,2),{role:'assistant',parts:[{functionCall:{name:'computer_observe',args:{}}}]}];
const iterable=(events)=>({async *[Symbol.asyncIterator](){yield* events;}});

describe('actual next-model request carries computer pixels', {timeout:30000},()=>{
 it('Codex preflight does not tokenize base64 pixels as prose',async()=>{
  const adapter=await createLlmAdapter('openai-codex',{responses:{}},'gpt-5.2-codex');
  const estimate=data=>adapter._estimateCodexRequestTokens({input:[{type:'message',role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+data}]}]});
  expect(estimate('A'.repeat(2_000_000))).toBe(estimate('AAAA'));
  expect(estimate('AAAA')).toBeGreaterThan(16000);
 });
 it.each(['openai','openai-codex'])('%s Responses streaming',async provider=>{
  const seen=[];const client={responses:{create:async params=>{seen.push(params);return iterable([{type:'response.completed',response:{id:'r',output:[],usage:{input_tokens:1,output_tokens:1}}}]);}}};
  const adapter=await createLlmAdapter(provider,client,provider==='openai'?'gpt-5.2':'gpt-5.2-codex');
  const {context,result}=contextWithToolResult();
  await adapter.callStream([...history,...adapter.formatToolResults([result])],[],()=>{},context);
  expect(seen).toHaveLength(1);
  const payload=seen[0].input;
  expect(payload.at(-1).content).toContainEqual({type:'input_image',image_url:`data:image/png;base64,${png}`});
  expect(payload.findIndex(item=>item.type==='function_call_output')).toBeLessThan(payload.length-1);
  expect(JSON.stringify(payload).split(png)).toHaveLength(2);
 });
 it('OpenAI Responses nonstreaming',async()=>{
  const seen=[];const adapter=await createLlmAdapter('openai',{responses:{create:async params=>{seen.push(params);return {output:[],output_text:'ok'};}}},'gpt-5.2');
  const {context,result}=contextWithToolResult();await adapter.call([...history,...adapter.formatToolResults([result])],[],context);
  expect(seen[0].input.at(-1).content.some(part=>part.type==='input_image')).toBe(true);
 });
 it('Chat Completions streaming preserves tool pairing and one image',async()=>{
  const seen=[];const adapter=await createLlmAdapter('openai',{chat:{completions:{create:async params=>{seen.push(params);return iterable([{choices:[{delta:{content:'ok'},finish_reason:'stop'}]}]);}}}},'gpt-4o');
  const {context,result}=contextWithToolResult();await adapter.callStream([...history,...adapter.formatToolResults([result])],[],()=>{},context);
  expect(seen[0].messages.at(-1).content).toContainEqual({type:'image_url',image_url:{url:`data:image/png;base64,${png}`}});
  expect(seen[0].messages.at(-2).tool_call_id).toBe('shot');
 });
 it('Anthropic nonstreaming carries an image after the matching tool result',async()=>{
  const seen=[];const adapter=await createLlmAdapter('anthropic',{messages:{create:async params=>{seen.push(params);return {content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}};}}},'claude-sonnet-4-5-20250929');
  const {context,result}=contextWithToolResult();await adapter.call([...anthropicHistory,...adapter.formatToolResults([result])],[],context);
  expect(JSON.stringify(seen[0].messages)).toContain(png);
  const blocks=seen[0].messages.flatMap(message=>Array.isArray(message.content)?message.content:[]);
  expect(blocks.find(block=>block.type==='image')?.source).toEqual({type:'base64',media_type:'image/png',data:png});
  expect(blocks.some(block=>block.type==='tool_result'&&block.tool_use_id==='shot')).toBe(true);
 });
 it('Gemini nonstreaming forwards actual inlineData rather than JSON',async()=>{
  const seen=[];const adapter=await createLlmAdapter('gemini',{models:{generateContent:async params=>{seen.push(params);return {text:'ok',candidates:[{content:{parts:[{text:'ok'}]},finishReason:'STOP'}],usageMetadata:{}};}}},'gemini-2.5-pro');
  const {context,result}=contextWithToolResult();await adapter.call([...geminiHistory,...adapter.formatToolResults([result])],[],context);
  const parts=seen[0].contents.flatMap(message=>message.parts);
  expect(parts).toContainEqual({inlineData:{mimeType:'image/png',data:png}});
  expect(parts.some(part=>part.functionResponse?.name==='computer_observe')).toBe(true);
 });
});
