import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
import chat from './chat.js';
beforeEach(()=>{localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:true})})}})));});
afterEach(()=>vi.unstubAllGlobals());
describe('Feature: main chat image preferences follow its effective account',()=>{
 for(const multipart of [false,true]) {
  it(`Given conversation account2 override, When sending ${multipart?'files':'JSON'}, Then do not borrow account1 consent`,async()=>{
   const state={activeConversationId:'fixture-conv',currentConversationId:null,unreadOutputIds:{},pendingSteer:'',messages:[],conversations:{},activeSkillByConv:{},activeGoalByConv:{},aiByConv:{'fixture-conv':{provider:'openai-codex-2',model:'gpt-6-astra'}}};
   const rootState={aiProvider:{selectedProvider:'openai-codex',codexImages:{'openai-codex':{enabled:false,policy:'latest'},'openai-codex-2':{enabled:true,policy:'latest-fast'}}}};
   await chat.actions.startStreamingConversation({state,commit:(type,payload)=>chat.mutations[type]?.(state,payload),dispatch:vi.fn(async()=>{}),rootState},{userInput:'fixture',provider:'openai-codex',files:multipart?[new File(['fixture'],'fixture.txt')]:[]});
   const request=fetch.mock.calls.find(([url])=>String(url).endsWith('/orchestrator/chat'));
   expect(request).toBeTruthy();const raw=request[1].body;
   const value=multipart?JSON.parse(raw.get('codexImages')):JSON.parse(raw).codexImages;
   expect(value).toEqual({provider:'openai-codex-2',enabled:true,policy:'latest-fast'});
  });
 }
});
