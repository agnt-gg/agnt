import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ models: ['gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst'], list:vi.fn(), generate:vi.fn(), edit:vi.fn(), variant:vi.fn(), returnedModel:undefined }));
vi.mock('openai/index.mjs',()=>{
 class FakeOpenAI { constructor(){ this.models={list:state.list};this.images={generate:state.generate,edit:state.edit,createVariation:state.variant}; } }
 return {default:FakeOpenAI,OpenAI:FakeOpenAI};
});
vi.mock('../../../services/auth/AuthManager.js',()=>({default:{getValidAccessToken:vi.fn(async()=> 'test-only')}}));
vi.mock('../../../services/execution/LedgerRecorder.js',()=>({recordLlmCall:vi.fn()}));
import tool from './generate-with-ai-llm.js';
import { TOOLS } from '../../../services/orchestrator/tools.js';
import { recordLlmCall } from '../../../services/execution/LedgerRecorder.js';
const params={mode:'Image Generation',provider:'OpenAI',imagePrompt:'synthetic icon'};
const ctx={userId:'test-user'};
beforeEach(()=>{vi.clearAllMocks();state.models=['gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst'];state.returnedModel=undefined;state.list.mockImplementation(async()=>({data:state.models.map(id=>({id}))}));const result=async()=>({model:state.returnedModel,data:[{b64_json:'AAAA'}]});state.generate.mockImplementation(result);state.edit.mockImplementation(result);state.variant.mockImplementation(result);});
describe('native image selection integration',()=>{
 it('workflow resolves the default once and records the resolved request model',async()=>{const out=await tool.execute(params,{},ctx);expect(out.error).toBeNull();expect(state.list).toHaveBeenCalledTimes(1);expect(state.generate.mock.calls[0][0].model).toBe('gpt-image-2.5-sunburst');expect(out.imageMetadata.requestedModel).toBe('latest');expect(out.imageMetadata.returnedModel).toBeNull();expect(recordLlmCall.mock.calls[0][0].model).toBe('gpt-image-2.5-sunburst');});
 it('explicit pin bypasses discovery and stays unchanged',async()=>{const out=await tool.execute({...params,model:'gpt-image-1'}, {},ctx);expect(out.error).toBeNull();expect(state.list).not.toHaveBeenCalled();expect(state.generate.mock.calls[0][0].model).toBe('gpt-image-1');});
 it('latest-fast reaches the provider as an actual model ID',async()=>{const out=await tool.execute({...params,model:'latest-fast'},{},ctx);expect(out.imageMetadata.resolvedModel).toBe('gpt-image-2.5-flare');expect(state.generate.mock.calls[0][0].model).not.toBe('latest-fast');});
 it('no generation after failed discovery and no static fallback',async()=>{state.list.mockRejectedValue(new Error('catalog unavailable'));const out=await tool.execute(params,{},ctx);expect(out.error).toContain('catalog unavailable');expect(state.list).toHaveBeenCalledTimes(1);expect(state.generate).not.toHaveBeenCalled();});
 it('next invocation advances without changing a default',async()=>{await tool.execute(params,{},ctx);state.models=['gpt-image-3'];const out=await tool.execute(params,{},ctx);expect(out.imageMetadata.resolvedModel).toBe('gpt-image-3');expect(state.list).toHaveBeenCalledTimes(2);});
 it('reports provider returned model separately',async()=>{state.returnedModel='provider-reported-engine';const out=await tool.execute(params,{},ctx);expect(out.imageMetadata.returnedModel).toBe('provider-reported-engine');expect(out.imageMetadata.resolvedModel).toBe('gpt-image-2.5-sunburst');});
 it('chat defers selection once and reports real action metadata',async()=>{const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'synthetic icon',provider:'openai'},null,ctx));expect(out.success).toBe(true);expect(out.model).toBe('gpt-image-2.5-sunburst');expect(out.requestedModel).toBe('latest');expect(out.imageMetadata.requestedModel).toBe('latest');expect(state.list).toHaveBeenCalledTimes(1);expect(state.generate).toHaveBeenCalledTimes(1);});
 it('chat preserves a dated pin without catalog list or rewriting',async()=>{const pin='gpt-image-2.5-sunburst-2026-09-08';const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'x',provider:'openai',model:pin},null,ctx));expect(out.model).toBe(pin);expect(state.list).not.toHaveBeenCalled();expect(state.generate.mock.calls[0][0].model).toBe(pin);});
 it('chat reports a discovery error and no image call',async()=>{state.list.mockResolvedValue({data:[]});const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'x',provider:'openai'},null,ctx));expect(out.success).toBe(false);expect(out.error).toContain('No compatible');expect(state.generate).not.toHaveBeenCalled();});
 it.each([['dall-e-3','Edit'],['gpt-image-2','Variation']])('rejects silent substitution %s %s',async(model,imageOperation)=>{const out=await tool.execute({...params,model,imageOperation,referenceImage:'data:image/png;base64,AAAA'}, {},ctx);expect(out.error).toMatch(/support|requires/);expect(state.generate).not.toHaveBeenCalled();expect(state.edit).not.toHaveBeenCalled();expect(state.variant).not.toHaveBeenCalled();});
});
