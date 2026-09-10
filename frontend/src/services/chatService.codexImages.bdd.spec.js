import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from './chatService.js';
beforeEach(()=>{localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:503,statusText:'fixture stop',text:async()=>''})));});
afterEach(()=>vi.unstubAllGlobals());
describe('Feature: forward frozen subscription image intent',()=>{
 for(const multipart of [false,true]) for(const policy of ['latest','latest-fast']) {
  it(`Given ${policy}, When sending ${multipart?'multipart':'JSON'}, Then transmit consent separately from text priority`,async()=>{
   const codexImages={provider:'openai-codex-2',enabled:true,policy};
   await expect(streamChat({chatType:'orchestrator',messages:[{role:'user',content:'fixture'}],provider:'openai-codex-2',codexImages,codexPriority:true,files:multipart?[new File(['synthetic'],'fixture.txt')]:[],onEvent:()=>{}})).rejects.toThrow('fixture stop');
   const raw=fetch.mock.calls[0][1].body;
   const value=multipart?JSON.parse(raw.get('codexImages')):JSON.parse(raw).codexImages;
   expect(value).toEqual(codexImages);expect(fetch).toHaveBeenCalledTimes(1);
  });
 }
});
