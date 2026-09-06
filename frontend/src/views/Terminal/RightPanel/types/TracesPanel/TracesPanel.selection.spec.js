import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import TracesPanel from './TracesPanel.vue';
const store=createStore({modules:{goals:{namespaced:true,getters:{isCreatingGoal:()=>false}},insights:{namespaced:true,actions:{fetchSourceInsights:()=>[]}}}});
const execution=id=>({id,workflowName:'Run '+id,status:'completed',startTime:'2026-09-01T10:00:00Z',endTime:'2026-09-01T10:01:00Z',nodeExecutions:[],log:'Completed'});
function render(props){return mount(TracesPanel,{props,global:{plugins:[store],stubs:{Tooltip:{template:'<span><slot/></span>'},ResourcesSection:true,BoundedJson:true}}});}
describe('execution detail survives lazy panel mounting',()=>{
 it('renders a result fetched before the panel mounted',()=>{const w=render({selectedExecutionId:'first',executionDetail:execution('first'),executions:[]});expect(w.find('.selected-execution-section').exists()).toBe(true);expect(w.text()).toContain('Run first');w.unmount();});
 it('updates the existing detail view without an imperative method call',async()=>{const w=render({selectedExecutionId:'first',executionDetail:execution('first')});await w.setProps({selectedExecutionId:'second',executionDetail:execution('second')});expect(w.text()).toContain('Run second');expect(w.text()).not.toContain('Run first');w.unmount();});
 it('returns to summary when source selection is cleared',async()=>{const w=render({selectedExecutionId:'first',executionDetail:execution('first')});await w.setProps({selectedExecutionId:null,executionDetail:null});expect(w.find('.selected-execution-section').exists()).toBe(false);w.unmount();});
});
