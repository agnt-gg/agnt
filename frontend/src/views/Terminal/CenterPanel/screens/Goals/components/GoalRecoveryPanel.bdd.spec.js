import {describe,it,expect,vi,afterEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
vi.mock('@/tt.config.js',()=>({API_CONFIG:{BASE_URL:'/api'}}));
import Panel from './GoalRecoveryPanel.vue';
let wrapper;
const state={state:'interrupted',runId:'run-1',reason:'external_outcome_unknown',checkpoint:{phase:'tasks',iteration:2},uncertainTasks:[{taskId:'t1',attemptId:'a1'}],nextAction:'Verify the external action before retrying.'};
afterEach(()=>{wrapper?.unmount();vi.unstubAllGlobals();vi.restoreAllMocks()});
function boot(){vi.stubGlobal('localStorage',{getItem:()=> 'fixture'});vi.stubGlobal('fetch',vi.fn(async(_url,o)=>({ok:true,json:async()=>o?.method==='POST'?{resolved:true,started:false}:state})));wrapper=mount(Panel,{props:{goalId:'g'}});return flushPromises()}
describe('Given a goal needs recovery',()=>{
 it('When inspected, Then its reason and uncertain attempts are visible without starting work',async()=>{await boot();expect(wrapper.text()).toContain('external_outcome_unknown');expect(wrapper.text()).toContain('t1');expect(fetch.mock.calls.every(c=>c[1]?.method!=='POST')).toBe(true)});
 it('When evidence is malformed or incomplete, Then resolution is disabled',async()=>{await boot();await wrapper.get('textarea').setValue('{bad');expect(wrapper.get('[data-test="resolve"]').attributes('disabled')).toBeDefined();await wrapper.get('textarea').setValue(JSON.stringify({runId:'run-1',evidence:'checked',decisions:[]}));expect(wrapper.get('[data-test="resolve"]').attributes('disabled')).toBeDefined()});
 it('When complete evidence is submitted and explicitly confirmed, Then only resolve is sent and no execution is started',async()=>{await boot();await wrapper.get('textarea').setValue(JSON.stringify({runId:'run-1',evidence:'Provider lookup verified',decisions:[{taskId:'t1',outcome:'not_executed',evidence:'No operation found'}]}));await wrapper.get('input[type="checkbox"]').setValue(true);await wrapper.get('[data-test="resolve"]').trigger('click');await flushPromises();const posts=fetch.mock.calls.filter(c=>c[1]?.method==='POST');expect(posts).toHaveLength(1);expect(posts[0][0]).toBe('/api/goals/g/recovery/resolve');expect(wrapper.text()).toContain('Execution was not started')});
 it('When goal changes during a request, Then the previous result is ignored',async()=>{await boot();let finish;fetch.mockImplementationOnce(()=>new Promise(r=>finish=r));const refresh=wrapper.get('[data-test="refresh"]').trigger('click');await refresh;await wrapper.setProps({goalId:'other'});await flushPromises();finish({ok:true,json:async()=>({...state,reason:'OLD_PRIVATE_REASON'})});await flushPromises();expect(wrapper.text()).not.toContain('OLD_PRIVATE_REASON')});
});

describe('Given compact recovery presentation',()=>{
 it('When no ownership record exists, Then explain that fact without claiming the goal never ran',async()=>{
  await boot();fetch.mockResolvedValue({ok:true,json:async()=>({state:'not_started'})});await wrapper.get('[data-test="refresh"]').trigger('click');await flushPromises();
  expect(wrapper.text()).toContain('No recovery record');expect(wrapper.text()).not.toContain('not_started');
  expect(wrapper.text()).toContain('Earlier work may still exist');expect(wrapper.find('textarea').exists()).toBe(false);
 });
 it('When displayed in a goal card, Then refresh is an accessible icon and raw codes are confined to technical details',async()=>{
  await boot();expect(wrapper.get('[data-test="refresh"]').attributes('aria-label')).toBe('Refresh recovery status');
  expect(wrapper.get('[data-test="refresh"]').text()).toBe('');expect(wrapper.find('strong').exists()).toBe(false);
  expect(wrapper.get('.recovery-label').text()).toBe('Recovery needs attention');
  expect(wrapper.get('.recovery-description').text()).toContain('could not be confirmed');
 });
});

describe('Given reviewed partial work',()=>{
 it('When partial evidence is complete, Then the operator can record continuation without execution',async()=>{
  await boot();const d={taskId:'t1',attemptId:'a1',outcome:'continue_partial',evidence:'Reviewed artifacts',workerStopped:true,effectsReconciled:true,remainingWork:'Finish baseline',doNotRepeat:['Preserve implementation'],artifacts:[{path:'saved.mjs',sha256:'a'.repeat(64)}]};
  await wrapper.get('textarea').setValue(JSON.stringify({runId:'run-1',evidence:'reviewed effects',decisions:[d]}));await wrapper.get('input[type="checkbox"]').setValue(true);
  expect(wrapper.get('[data-test="resolve"]').attributes('disabled')).toBeUndefined();
  await wrapper.get('[data-test="resolve"]').trigger('click');await flushPromises();expect(fetch.mock.calls.filter(c=>c[1]?.method==='POST')).toHaveLength(1);
 });
 it('When worker termination or exact attempt is not confirmed, Then partial resolution remains disabled',async()=>{
  await boot();await wrapper.get('textarea').setValue(JSON.stringify({runId:'run-1',evidence:'reviewed',decisions:[{taskId:'t1',attemptId:'wrong',outcome:'continue_partial',evidence:'reviewed',workerStopped:false}]}));await wrapper.get('input[type="checkbox"]').setValue(true);expect(wrapper.get('[data-test="resolve"]').attributes('disabled')).toBeDefined();
 });
});
