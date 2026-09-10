import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { png, uri } from './codexImageTestFixture.js';
const state = vi.hoisted(() => ({ post: vi.fn(), factory: vi.fn(), api: vi.fn() }));
vi.mock('./LlmService.js', () => ({ createLlmClient: state.factory }));
vi.mock('../auth/AuthManager.js', () => ({ default: { getValidAccessToken: state.api } }));
let TOOLS, bindCodexImageIntent;
beforeAll(async () => {
 vi.stubEnv('AGNT_CODEX_IMAGE_ENABLED','true');
 ({ TOOLS } = await import('../orchestrator/tools.js'));
 ({ bindCodexImageIntent } = await import('./codexImageIntent.js'));
});
beforeEach(() => {
 vi.clearAllMocks();
 state.api.mockImplementation(() => { throw new Error('API-key decoy must not be used'); });
 state.post.mockImplementation(() => ({ asResponse: async () => new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}],quality:'medium',size:'1x1',usage:{total_tokens:12}})) }));
 state.factory.mockImplementation(async () => ({baseURL:'https://chatgpt.com/backend-api/codex',post:state.post}));
});
const expected = {'latest':'gpt-image-2.5-sunburst','latest-fast':'gpt-image-2.5-flare'};
async function run(policy, operation='generate', overrides={}) {
 const context={userId:'fixture',codexImageIntent:bindCodexImageIntent({enabled:true,policy,provider:'openai-codex'},'openai-codex'),codexImageScope:'scope',codexImageReferences:{scope:'scope',entries:{'upload:0':uri}}};
 return JSON.parse(await TOOLS.generate_image.execute({prompt:'fixture',operation,...(operation==='edit'?{referenceHandles:['upload:0']} : {}),...overrides},null,context));
}
describe('Feature: experimental image choices alter actual native subscription requests', () => {
 for(const policy of Object.keys(expected)) for(const operation of ['generate','edit']) {
  it(`Given ${policy}, When native ${operation} runs, Then send its exact candidate, not default or API`,async()=>{
   const out=await run(policy,operation);
   expect(out.success).toBe(true);
   expect(state.factory).toHaveBeenCalledOnce();expect(state.factory.mock.calls[0].slice(0,2)).toEqual(['openai-codex','fixture']);
   expect(state.post).toHaveBeenCalledOnce();
   const [ep,opts]=state.post.mock.calls[0];expect(ep).toBe(operation==='edit'?'/images/edits':'/images/generations');
   expect(opts.body.model).toBe(expected[policy]);expect(opts.maxRetries).toBe(0);expect(opts.fetchOptions.redirect).toBe('error');
   if(operation==='edit')expect(opts.body.images).toEqual([{image_url:uri}]);
   expect(out.imageMetadata).toMatchObject({requestedModel:policy,resolvedModel:expected[policy],selectionMode:'experimental-request',returnedModel:null,modelSelectionVerified:false,latestVerified:false});
   expect(out.imageMetadata.providerReported).toMatchObject({quality:'medium',size:'1x1'});
   expect(out.model).toBeNull();expect(out.savedImageIds).toHaveLength(1);expect(state.api).not.toHaveBeenCalled();
  });
 }
 it.each([400,401,403,429,500])('Given HTTP %s, Then no retry/account/API substitution',async status=>{
  state.post.mockImplementation(()=>({asResponse:async()=>{throw Object.assign(new Error('private'),{status});}}));
  const out=await run('latest-fast');expect(out.success).toBe(false);expect(out.retryable).toBe(false);expect(state.post).toHaveBeenCalledOnce();expect(state.factory).toHaveBeenCalledOnce();expect(state.api).not.toHaveBeenCalled();
 });
 it.each([{provider:'openai'},{provider:'openai-codex-2'},{model:'provider-default'},{model:'latest-fast'}])('Given pinned user intent, When overridden %j, Then fail before clients',async override=>{
  const out=await run('latest','generate',override);expect(out.success).toBe(false);expect(out.retryable).toBe(false);expect(state.factory).not.toHaveBeenCalled();expect(state.api).not.toHaveBeenCalled();
 });
 it('Given concurrent choices, Then initialization latency cannot swap selectors',async()=>{
  let release;state.factory.mockImplementationOnce(()=>new Promise(r=>{release=()=>r({baseURL:'https://chatgpt.com/backend-api/codex',post:state.post});}));
  const a=run('latest');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const b=await run('latest-fast');release();const first=await a;
  expect([first.imageMetadata.resolvedModel,b.imageMetadata.resolvedModel]).toEqual([expected.latest,expected['latest-fast']]);
  expect(state.post.mock.calls.map(c=>c[1].body.model)).toEqual([expected['latest-fast'],expected.latest]);
 });
});
