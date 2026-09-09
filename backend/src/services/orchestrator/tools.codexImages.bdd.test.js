import { describe,it,expect,vi } from 'vitest';
const state=vi.hoisted(()=>({api:vi.fn(()=>{throw new Error('API decoy touched');}),action:vi.fn(()=>{throw new Error('unexpected dispatch');})}));
vi.mock('../auth/AuthManager.js',()=>({default:{getValidAccessToken:state.api}}));
vi.mock('../../tools/library/actions/generate-with-ai-llm.js',()=>({default:{execute:state.action}}));
import { TOOLS,executeTool } from './tools.js';
describe('Feature: subscription image intent at native dispatch boundary',()=>{
 for(const policy of ['latest','latest-fast']) for(const provider of [undefined,'openai','openai-codex','openai-codex-2']) {
  it(`Given ${policy} on account1, When model asks ${provider||'omitted'}, Then no API or image dispatch`,async()=>{
   vi.clearAllMocks();const context={userId:'fixture',toolRunId:crypto.randomUUID(),codexImageIntent:Object.freeze({provider:'openai-codex',enabled:true,policy})};
   const out=JSON.parse(await TOOLS.generate_image.execute({prompt:'fixture',provider},null,context));
   expect(out.success).toBe(false);expect(out.code).toMatch(/^CODEX_IMAGE_/);expect(out.retryable).toBe(false);
   expect(state.api).not.toHaveBeenCalled();expect(state.action).not.toHaveBeenCalled();
  });
 }
 it('Given image off, When executing the real dispatch wrapper repeatedly, Then no fallback or action call',async()=>{
  vi.clearAllMocks();const context={userId:'fixture',toolRunId:crypto.randomUUID(),codexImageIntent:{provider:'openai-codex',enabled:false,policy:'latest'}};
  for(let i=0;i<2;i++){const out=JSON.parse(await executeTool('generate_image',{prompt:'fixture',provider:'openai'},null,context));expect(out.success).toBe(false);}
  expect(state.api).not.toHaveBeenCalled();expect(state.action).not.toHaveBeenCalled();
 });
});
