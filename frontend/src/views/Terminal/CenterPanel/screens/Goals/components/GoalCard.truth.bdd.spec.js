import {describe,it,expect} from 'vitest';
import {shallowMount} from '@vue/test-utils';
import {createStore} from 'vuex';
import Card from './GoalCard.vue';
describe('goal progress truth',()=>{
 it('Given terminal server counters and stale live events, Then ignore the stale event snapshot',()=>{
  const store=createStore({getters:{'schedules/schedulesForGoal':()=>()=>[], 'goals/getGoalTaskProgress':()=>()=>({total:6,completed:0,running:0,tasks:{}})}});
  const w=shallowMount(Card,{props:{goal:{id:'g',title:'G',status:'validated',task_count:6,completed_tasks:6}},global:{plugins:[store]}});
  expect(w.vm.displayProgress).toBe(100);w.unmount();
 });
 it('Given corrected paused record, Then stale completed events cannot override failed server counts',()=>{
  const store=createStore({getters:{'schedules/schedulesForGoal':()=>()=>[], 'goals/getGoalTaskProgress':()=>()=>({total:6,completed:6,running:0,tasks:{}})}});
  const w=shallowMount(Card,{props:{goal:{id:'g',title:'G',status:'paused',progress:0,task_count:6,completed_tasks:0}},global:{plugins:[store]}});
  expect(w.vm.displayProgress).toBe(0);w.unmount();
 });
});
