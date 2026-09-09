import {describe,it,expect,vi} from 'vitest';
const decoy=vi.hoisted(()=>({auth:vi.fn(()=>{throw new Error('API decoy accessed');}),transport:vi.fn(()=>{throw new Error('transport accessed');})}));
vi.mock('../../../services/auth/AuthManager.js',()=>({default:{getValidAccessToken:decoy.auth}}));
vi.mock('../../../services/ai/codexImageTransport.js',()=>({generateCodexImage:decoy.transport}));
import tool from './generate-with-ai-llm.js';
describe('Feature: workflow respects subscription image intent',()=>{
 it.each(['openai','openai-codex-2'])('Given bound account1 intent, When workflow asks %s, Then no auth or generation',async provider=>{
  vi.clearAllMocks();const out=await tool.execute({mode:'Image Generation',provider,model:'latest',imagePrompt:'fixture'},{},{userId:'fixture',codexImageIntent:{provider:'openai-codex',enabled:true,policy:'latest'}});
  expect(out.error).toMatch(/substitution|unverified/);expect(decoy.auth).not.toHaveBeenCalled();expect(decoy.transport).not.toHaveBeenCalled();
 });
});
