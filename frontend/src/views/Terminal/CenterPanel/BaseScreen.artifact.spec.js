import {describe,it,expect,vi,afterEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {createStore} from 'vuex';
import {ref} from 'vue';
vi.mock('@/composables/useVoiceEngines',()=>({useVoiceEngines:()=>({})}));
import BaseScreen from './BaseScreen.vue';
const wrappers=[];afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());localStorage.clear()});
function setup(){const store=createStore({state:{chat:{messages:[],isStreaming:false},agents:{agents:[]}},modules:{shell:{namespaced:true,state:()=>({inspect:null}),getters:{inspect:s=>s.inspect,jumpOpen:()=>false},mutations:{set(s,v){s.inspect=v}},actions:{clearInspect({commit}){commit('set',null)}}}},getters:{'theme/actualLeftPanelWidth':()=>280,'theme/rightPanelWidth':()=>320,'theme/mainContentWidth':()=>700,'theme/showLeftPanel':()=>false,'theme/showRightPanel':()=>true,'theme/leftPanelCollapsed':()=>true,'theme/rightPanelCollapsed':()=>true,'agents/allAgents':()=>[]}});const w=mount(BaseScreen,{props:{screenId:'ChatScreen',showInput:false},global:{plugins:[store],provide:{isMobile:ref(false)},directives:{tooltip:{}},stubs:{LeftPanel:true,RightPanel:true,RateLimitBanner:true,PopupTutorial:true,ChatProviderSelector:true,ChatToolSelector:true,CommandMenu:true}}});wrappers.push(w);return{w,store}}
describe('BaseScreen artifact inspector integration',()=>{
 it('opens the existing panel on selection and expands without navigation',async()=>{const{w,store}=setup();store.commit('shell/set',{kind:'artifact',screen:'ChatScreen',payload:{kind:'text',source:'Hi'}});await flushPromises();expect(w.vm.rightPanelCollapsed).toBe(false);expect(w.classes()).toContain('artifact-active');window.dispatchEvent(new CustomEvent('agnt:expand-artifact'));await flushPromises();expect(w.classes()).toContain('artifact-expanded');expect(w.emitted('screen-change')).toBeUndefined();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await flushPromises();expect(store.getters['shell/inspect']).toBeNull();expect(w.classes()).not.toContain('artifact-expanded')});
 it('does not open a chat panel for another screens selection',async()=>{const{w,store}=setup();store.commit('shell/set',{kind:'agent',screen:'AgentsScreen',id:'a'});await flushPromises();expect(w.vm.rightPanelCollapsed).toBe(true)});
});

describe('temporary preview layout',()=>{
 it.each([true,false])('restores prior width and collapse=%s after close',async(collapsed)=>{const {w,store}=setup();await flushPromises();w.vm.$.setupState.rightPanelWidth=347;w.vm.$.setupState.rightPanelCollapsed=collapsed;
 store.commit('shell/set',{kind:'artifact',screen:'ChatScreen',payload:{kind:'text',source:'first'}});await flushPromises();expect(w.vm.$.setupState.rightPanelWidth).not.toBe(347);expect(w.vm.rightPanelCollapsed).toBe(false);
 store.commit('shell/set',{kind:'artifact',screen:'ChatScreen',payload:{kind:'text',source:'second'}});await flushPromises();window.dispatchEvent(new CustomEvent('agnt:expand-artifact'));await flushPromises();store.commit('shell/set',null);await flushPromises();expect(w.vm.$.setupState.rightPanelWidth).toBe(347);expect(w.vm.rightPanelCollapsed).toBe(collapsed);expect(w.classes()).not.toContain('artifact-expanded');});
 it('restores layout when selection moves to another screen',async()=>{const {w,store}=setup();await flushPromises();w.vm.$.setupState.rightPanelWidth=360;w.vm.$.setupState.rightPanelCollapsed=true;store.commit('shell/set',{kind:'artifact',screen:'ChatScreen',payload:{}});await flushPromises();store.commit('shell/set',{kind:'agent',screen:'AgentsScreen',id:'a'});await flushPromises();expect(w.vm.$.setupState.rightPanelWidth).toBe(360);expect(w.vm.rightPanelCollapsed).toBe(true)});
});
