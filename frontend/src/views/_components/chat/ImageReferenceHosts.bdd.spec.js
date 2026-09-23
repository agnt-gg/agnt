import { describe,it,expect,vi,afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import Unified from './UnifiedChatContainer.vue';
import Picker from './ImageReferencePicker.vue';
import fs from 'node:fs';
vi.mock('@/services/chatChannelConfig.js',()=>({getChannelConfig:()=>null}));
const wrappers=[];
afterEach(async()=>{await flushPromises();wrappers.splice(0).forEach(w=>w.unmount());await flushPromises();localStorage.clear();});
function render(){
 const actions={initializeChannel:vi.fn(),setSuggestions:vi.fn(),sendMessage:vi.fn()};
 const store=createStore({modules:{chatUnified:{namespaced:true,state:()=>({conversations:{'channel-a':{conversationId:'conv-a',messages:[]},'channel-b':{conversationId:'conv-b',messages:[]}}}),getters:Object.fromEntries(['getFormattedMessages','getSuggestions','getRunningToolsForMessage'].map(k=>[k,()=>()=>[]]).concat(['isStreaming','isLoadingSuggestions'].map(k=>[k,()=>()=>false]),['getImageCache','getDataCache'].map(k=>[k,()=>()=>new Map()]),[['pendingSteer',()=>()=>null],['getMessageStatus',()=>()=>null]])),actions},aiProvider:{namespaced:true,state:()=>({selectedProvider:null}),actions:{setProvider:vi.fn(),setModel:vi.fn()}}}});
 const w=shallowMount(Unified,{props:{channelKey:'channel-a',chatType:'orchestrator',showVoiceInput:false},global:{plugins:[store],stubs:{ChatInputBar:{template:'<div></div>',methods:{focus(){}}}},directives:{tooltip:{},'click-outside':{}}}});wrappers.push(w);return {w,store,actions};
}
describe('Feature: reference attachments stay in their composer',()=>{
 it('Given picker selection, Then append a visible attachment without sending',async()=>{
  const {w,actions}=render();const file=new File(['fixture'],'reference.png');
  w.findComponent(Picker).vm.$emit('attach-files',[file],'channel-a:conv-a');await w.vm.$nextTick();
  expect(w.vm.selectedFiles).toEqual([file]);expect(actions.sendMessage).not.toHaveBeenCalled();
 });
 it('Given stale picker scope, Then host refuses attachment',async()=>{const {w}=render();w.findComponent(Picker).vm.$emit('attach-files',[new File(['fixture'],'ref.png')],'channel-b:conv-b');await w.vm.$nextTick();expect(w.vm.selectedFiles).toEqual([]);});
 it('Given attached image reference and ordinary file, When changing conversation, Then only the reference is removed',async()=>{
  const {w}=render();const ordinary=new File(['text'],'notes.txt'),reference=new File(['image'],'reference.png');w.vm.onAttachFiles([ordinary]);w.findComponent(Picker).vm.$emit('attach-files',[reference],'channel-a:conv-a');await w.vm.$nextTick();
  await w.setProps({channelKey:'channel-b'});expect(w.vm.selectedFiles).toEqual([ordinary]);
 });
 it('Given the main composer, Then it receives an atomic scoped collection and checks attachment scope',()=>{
  const base=fs.readFileSync('src/views/Terminal/CenterPanel/BaseScreen.vue','utf8');
  const chat=fs.readFileSync('src/views/Terminal/CenterPanel/screens/Chat/Chat.vue','utf8');
  expect(base).toContain('@attach-files="attachImageReference"');expect(base).toContain('scope !== props.conversationId');
  expect(chat).toContain(':image-reference-collection="imageReferenceCollection"');expect(chat).toContain('store.state.chat.conversations?.[scopeKey]');
  expect(base).toContain('referenceAttachments');
 });
});
