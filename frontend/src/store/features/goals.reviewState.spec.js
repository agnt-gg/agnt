import { describe,it,expect,vi,afterEach } from 'vitest';
vi.mock('@/tt.config.js',()=>({API_CONFIG:{BASE_URL:'http://fixture/api'}}));
vi.hoisted(()=>{const data=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),clear:()=>data.clear()}});});
import { mount,flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import goals from './goals.js';
import Widget from '../../views/Terminal/CenterPanel/screens/Chat/components/GoalProgressWidget.vue';
function storeFor(status='executing') {
 return createStore({modules:{goals:{...goals,state:()=>({...goals.state,goals:status?[{id:'g',status}]:[],liveIteration:{g:{phase:'evaluating',iteration:6}},goalTaskProgress:{g:{total:4,completed:4,running:0,failed:0,tasks:{}}},requestCache:new Map(),goalStatusSubscriptions:new Map()}),actions:{...goals.actions,fetchGoals:vi.fn()}}}});
}
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
describe('Given a completed-task goal requiring review',()=>{
 it.each(['needs_review','paused','stopped','failed'])('When authoritative %s arrives Then clear stale phase without changing task counts',status=>{const s=storeFor();s.commit('goals/UPDATE_GOAL',{id:'g',status,loop_status:'stopped'});expect(s.state.goals.liveIteration.g).toBeUndefined();expect(s.state.goals.goalTaskProgress.g.completed).toBe(4);});
 it('When refreshed list includes needs_review Then clear stale live phase',()=>{const s=storeFor();s.commit('goals/SET_GOALS',[{id:'g',status:'needs_review'}]);expect(s.state.goals.liveIteration.g).toBeUndefined();});
 it('When task-status hydration returns needs_review without tasks Then still hydrate goal status',async()=>{localStorage.setItem('token','fixture');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'needs_review',allTasks:[]})})));const s=storeFor(null);await s.dispatch('goals/fetchGoalTaskProgress','g');expect(s.getters['goals/getGoalById']('g').status).toBe('needs_review');expect(s.state.goals.liveIteration.g).toBeUndefined();});
 it('When widget mounts with review state and stale evaluation Then NEEDS REVIEW overrides running and passed',async()=>{const s=storeFor('needs_review');const w=mount(Widget,{props:{goalId:'g'},global:{plugins:[s]}});await flushPromises();expect(w.find('.gpw-status-badge').text()).toBe('NEEDS REVIEW');expect(w.text()).not.toContain('Evaluating');expect(w.text()).not.toContain('PASSED');expect(w.find('.gpw-task-count').text()).toBe('4/4 tasks');w.unmount();});
 it('When page reloads and status is fetched Then widget displays review without mutation requests',async()=>{localStorage.setItem('token','fixture');const fetch=vi.fn(async()=>({ok:true,json:async()=>({status:'needs_review',allTasks:[{id:'t',status:'completed',title:'Done'}]})}));vi.stubGlobal('fetch',fetch);const s=storeFor(null);const w=mount(Widget,{props:{goalId:'g'},global:{plugins:[s]}});await flushPromises();expect(w.find('.gpw-status-badge').text()).toBe('NEEDS REVIEW');expect(fetch.mock.calls.every(([url,options])=>url.endsWith('/status')&&!options.method)).toBe(true);w.unmount();});
 it('When review update arrives during evaluation Then mounted widget stops showing live phase',async()=>{const s=storeFor();const w=mount(Widget,{props:{goalId:'g'},global:{plugins:[s]}});await flushPromises();expect(w.text()).toContain('Evaluating');s.commit('goals/UPDATE_GOAL',{id:'g',status:'needs_review',loop_status:'stopped'});await flushPromises();expect(w.find('.gpw-status-badge').text()).toBe('NEEDS REVIEW');expect(w.text()).not.toContain('Evaluating');expect(s.state.goals.liveIteration.g).toBeUndefined();w.unmount();});
 it('When goal is executing Then keep legitimate evaluation phase',()=>{const s=storeFor();s.commit('goals/UPDATE_GOAL',{id:'g',status:'executing'});expect(s.state.goals.liveIteration.g.phase).toBe('evaluating');});
});
