import {describe,it,expect,vi,afterEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import {createStore} from 'vuex';
import TeamWorkspace from './TeamWorkspace.vue';
const wrappers=[];afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());vi.unstubAllGlobals()});
function setup(role='owner'){
 const calls=[];vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{calls.push({url,options});let body=[];if(url.endsWith('/teams'))body=[{id:'t',name:'Engineering',role,tenantUrl:window.location.origin,entitlement:{collaborationAllowed:true},capabilities:{manageMembers:role==='owner'},seats:{used:2,total:3}}];else if(url.endsWith('/assets'))body=[{id:'a',name:'Brief',kind:'markdown',revision:2}];else if(url.endsWith('/assets/a'))body={id:'a',name:'Brief',kind:'markdown',content:'# v2',revision:2};else if(url.includes('?revision=1'))body={id:'a',name:'Brief',kind:'markdown',content:'# v1',revision:1};return{ok:true,json:async()=>body}}));
 const w=mount(TeamWorkspace,{global:{plugins:[createStore({state:{userAuth:{token:'u1'}},getters:{'agents/allAgents':()=>[],'workflows/allWorkflows':()=>[],'skills/allSkills':()=>[]}})],directives:{tooltip:{}}}});wrappers.push(w);return{w,calls}
}
async function selectTeam(w){await flushPromises();await w.findComponent({name:'CustomSelect'}).vm.$emit('update:modelValue','t');await flushPromises()}
describe('TeamWorkspace uses authenticated shared state',()=>{
 it('starts Personal and loads only explicitly selected team data',async()=>{const{w,calls}=setup();await flushPromises();expect(w.text()).toContain('Personal workspace');expect(calls.map(c=>c.url.split('/api')[1])).toEqual(['/teams','/tenants']);await selectTeam(w);expect(w.find('.asset-list').text()).toContain('Brief');expect(calls.every(c=>'Authorization' in c.options.headers)).toBe(true)});
 it('viewers can inspect/download but cannot mutate or invite',async()=>{const{w}=setup('viewer');await selectTeam(w);await w.find('.asset-list button').trigger('click');await flushPromises();expect(w.find('.asset-detail textarea').attributes('readonly')).toBeDefined();expect(w.text()).not.toContain('Save new version');expect(w.text()).not.toContain('New shared asset');await w.findAll('nav button')[1].trigger('click');expect(w.text()).not.toContain('Create invitation')});
 it('retains the edit draft on revision conflict',async()=>{const{w}=setup();await selectTeam(w);await w.find('.asset-list button').trigger('click');await flushPromises();await w.find('.asset-detail textarea').setValue('new draft');global.fetch.mockImplementationOnce(async()=>({ok:false,json:async()=>({error:'This asset changed. Reload before saving'})}));await w.findAll('.asset-detail button').find(b=>b.text()==='Save new version').trigger('click');await flushPromises();expect(w.find('[role=alert]').text()).toContain('changed');expect(w.find('.asset-detail textarea').element.value).toBe('new draft')});
 it('no simulated membership or content in the initial state',async()=>{const{w}=setup();await flushPromises();expect(w.text()).not.toContain('Release brief');expect(w.findAll('.asset')).toHaveLength(0)});
});
