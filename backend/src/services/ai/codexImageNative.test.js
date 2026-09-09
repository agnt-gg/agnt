import { beforeAll, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({ generate:vi.fn(), createClient:vi.fn(), ledger:vi.fn() }));
vi.mock('./codexImageTransport.js',()=>({generateCodexImage:state.generate}));
vi.mock('./LlmService.js',()=>({createLlmClient:state.createClient}));
vi.mock('../execution/LedgerRecorder.js',()=>({recordLlmCall:state.ledger}));
let registry, tool, TOOLS;
beforeAll(async()=>{
 vi.stubEnv('AGNT_CODEX_IMAGE_ENABLED','true');
 registry=await import('./ProviderRegistry.js');
 tool=(await import('../../tools/library/actions/generate-with-ai-llm.js')).default;
 TOOLS=(await import('../orchestrator/tools.js')).TOOLS;
});
describe('opt-in native Codex image integration',()=>{
 it('advertises only configured Codex accounts with a matching native route',()=>{const cls=Object.getPrototypeOf(tool).constructor;expect(registry.supportsImageGeneration('openai-codex')).toBe(true);expect(registry.getDefaultImageModel('openai-codex')).toBe('provider-default');expect(cls.IMAGE_ROUTES['openai-codex']).toBe('generateImageWithCodex');expect(TOOLS.generate_image.schema.function.parameters.properties.provider.enum).toContain('openai-codex');});
 it('workflow forwards selected provider/signal without pre-reading credentials or fabricated ledger entry',async()=>{state.generate.mockResolvedValue({generatedImages:['data:image/png;base64,AAAA'],imageMetadata:{resolvedModel:null,returnedModel:null,usage:null}});const c=new AbortController();const out=await tool.execute({mode:'Image Generation',provider:'openai-codex',imagePrompt:'synthetic'},{},{userId:'fixture',signal:c.signal});expect(out.error).toBeNull();expect(state.generate.mock.calls.at(-1)[1]).toMatchObject({createClient:state.createClient,userId:'fixture',signal:c.signal});expect(state.ledger).not.toHaveBeenCalled();});
 it('chat keeps unknown engine null and forwards edit references/signal',async()=>{const c=new AbortController();state.generate.mockResolvedValue({generatedImages:['data:image/png;base64,AAAA'],imageMetadata:{requestedModel:'provider-default',resolvedModel:null,returnedModel:null,selectionMode:'provider-selected'}});const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'edit synthetic',provider:'openai-codex',operation:'edit',referenceImages:['data:image/png;base64,AAAA']},null,{userId:'fixture',signal:c.signal}));expect(out.success).toBe(true);expect(out.model).toBeNull();expect(out.requestedModel).toBe('provider-default');expect(out.message).toContain('identity unknown');expect(state.generate.mock.calls.at(-1)[0]).toMatchObject({imageOperation:'Edit',referenceImages:['data:image/png;base64,AAAA']});expect(state.generate.mock.calls.at(-1)[1].signal).toBe(c.signal);});
 it('rejects unsupported aspect ratio without discarding it',async()=>{state.generate.mockClear();const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'x',provider:'openai-codex',aspectRatio:'16:9'},null,{userId:'fixture'}));expect(out.success).toBe(false);expect(out.error).toContain('aspectRatio');expect(state.generate).not.toHaveBeenCalled();});
 it('does not claim success without a persisted output',async()=>{state.generate.mockClear();state.generate.mockResolvedValue({generatedImages:['invalid-output'],imageMetadata:{returnedModel:null}});const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'x',provider:'openai-codex'},null,{userId:'fixture'}));expect(out.success).toBe(false);expect(out.error).toContain('persistence failed');expect(state.generate).toHaveBeenCalledTimes(1);});
 it('chat refuses an unverifiable latest policy before adapter dispatch',async()=>{state.generate.mockClear();const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'x',provider:'openai-codex',model:'latest'},null,{userId:'fixture'}));expect(out.success).toBe(false);expect(state.generate).not.toHaveBeenCalled();});
});
